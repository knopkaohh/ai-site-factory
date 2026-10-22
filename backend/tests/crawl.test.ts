import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { DatabaseSync } from 'node:sqlite';
import type { CrawlPageDetail, CrawlRun, CrawlSummary, ProjectDetail } from '../../shared/src/index';
import { createApp } from '../src/app';
import { decodeHtml, extractPage } from '../src/crawl/extract';
import { CrawlRequestError, createSafeFetcher, type CrawlFetcher } from '../src/crawl/fetcher';
import { isBlockedIp, resolveCrawlUrl, shouldQueue } from '../src/crawl/policy';
import { isAllowedByRobots } from '../src/crawl/robots';
import { findCrawlRun } from '../src/crawl/repository';
import { recoverInterruptedCrawls } from '../src/crawl/service';
import { storedFilePath } from '../src/crawl/storage';
import { openDatabase } from '../src/db/database';
import { createProject } from '../src/services/projectService';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function htmlResult(url: string, html: string, status = 200) {
  return { finalUrl: url, status, contentType: 'text/html; charset=utf-8', body: Buffer.from(html) };
}

function shopHtml(pathname: string): { status: number; contentType: string; body: Buffer } | null {
  if (pathname === '/robots.txt') {
    return {
      status: 200,
      contentType: 'text/plain',
      body: Buffer.from('User-agent: *\nDisallow: /private\nAllow: /private/public\nSitemap: https://shop.example/sitemap.xml\n'),
    };
  }
  if (pathname === '/sitemap.xml') {
    return {
      status: 200,
      contentType: 'application/xml',
      body: Buffer.from(
        '<?xml version="1.0"?><urlset><url><loc>https://shop.example/from-sitemap.htm</loc></url><url><loc>https://evil.example/nope.htm</loc></url></urlset>',
      ),
    };
  }
  if (pathname === '/') {
    return {
      status: 200,
      contentType: 'text/html',
      body: Buffer.from(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Мастерская</title>
        <meta name="description" content="Каталог изделий"></head>
        <frameset cols="200,*"><frame src="frame.htm"><frame src="about.htm"></frameset>
        <noframes><a href="about.htm">О нас</a></noframes></html>`),
    };
  }
  if (pathname === '/frame.htm') {
    return { status: 200, contentType: 'text/html', body: Buffer.from('<html><head><title>Меню</title></head><body><a href="contacts.htm">Контакты</a></body></html>') };
  }
  if (pathname === '/about.htm') {
    return {
      status: 200,
      contentType: 'text/html',
      body: Buffer.from(`<html><head><title>О нас</title><base href="https://shop.example/"></head><body>
        <p>Добро пожаловать в мастерскую</p>
        <a href="/catalog">Каталог</a>
        <a href="/private/secret.htm">Секрет</a>
        <a href="https://external.example/promo">Внешняя</a>
        <a href="http://127.0.0.1/admin">Админ</a>
        <a href="https://shop.example.evil.com/steal">Похожий домен</a>
        <a href="mailto:hello@shop.example">Почта</a>
        <img src="logo.png" alt="Логотип мастерской">
        <img src="https://cdn.example/pic.png" alt="Внешнее фото">
        </body></html>`),
    };
  }
  if (pathname === '/contacts.htm') {
    return { status: 200, contentType: 'text/html', body: Buffer.from('<html><head><title>Контакты</title></head><body>Телефон мастерской</body></html>') };
  }
  if (pathname === '/from-sitemap.htm') {
    return { status: 200, contentType: 'text/html', body: Buffer.from('<html><head><title>Из карты</title></head><body>Адрес из sitemap</body></html>') };
  }
  if (pathname === '/catalog') {
    return { status: 500, contentType: 'text/html', body: Buffer.from('сбой') };
  }
  if (pathname === '/logo.png') {
    return { status: 200, contentType: 'image/png', body: PNG };
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('правила адреса и разбор страницы', () => {
  it('блокирует частные, локальные и служебные адреса без сетевого запроса', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.16.0.1', '169.254.169.254', '0.0.0.0', '100.64.1.1', '255.255.255.255', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      assert.equal(isBlockedIp(address), true, address);
    }
    assert.equal(isBlockedIp('93.184.216.34'), false);
  });

  it('оставляет внутренние ссылки и отбрасывает внешние, localhost и чужой суффикс', () => {
    const base = 'https://shop.example/frame.htm';
    const internal = resolveCrawlUrl('contacts.htm', base, 'shop.example');
    const external = resolveCrawlUrl('https://external.example/promo', base, 'shop.example');
    const lookalike = resolveCrawlUrl('https://shop.example.evil.com/steal', base, 'shop.example');
    const local = resolveCrawlUrl('http://127.0.0.1/admin', base, 'shop.example');
    const localhost = resolveCrawlUrl('http://localhost/admin', base, 'shop.example');
    const userinfo = resolveCrawlUrl('https://user:pass@shop.example/', base, 'shop.example');
    assert.equal(internal?.url.href, 'https://shop.example/contacts.htm');
    assert.equal(internal ? shouldQueue(internal, false) : false, true);
    assert.equal(external?.sameSite, false);
    assert.equal(external ? shouldQueue(external, false) : true, false);
    assert.equal(lookalike?.sameSite, false);
    assert.equal(local?.sameSite, false);
    assert.equal(localhost, null);
    assert.equal(userinfo, null);
  });

  it('находит ссылки frameset, относительные адреса и описание изображения', () => {
    const page = extractPage(
      `<html><head><base href="https://shop.example/catalog/"><title>Каталог</title></head>
       <body><a href="item.htm">Товар</a><a href="https://other.example/x">Чужой</a>
       <iframe src="/about.htm"></iframe><img src="../logo.png" alt="Логотип"></body></html>`,
      'https://shop.example/catalog/index.htm',
      'shop.example',
    );
    assert.equal(page.title, 'Каталог');
    assert.ok(page.links.some((link) => link.target?.url.href === 'https://shop.example/catalog/item.htm'));
    assert.ok(page.links.some((link) => link.target?.url.href === 'https://shop.example/about.htm' && link.fromFrame));
    assert.ok(page.links.some((link) => link.target?.sameSite === false));
    assert.equal(page.images[0]?.target?.url.href, 'https://shop.example/logo.png');
    assert.equal(page.images[0]?.alt, 'Логотип');
  });

  it('читает windows-1251 из meta charset', () => {
    const word = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
    const html = Buffer.concat([
      Buffer.from('<html><head><meta charset="windows-1251"><title>'),
      word,
      Buffer.from('</title></head><body>'),
      word,
      Buffer.from('</body></html>'),
    ]);
    const text = decodeHtml(html, null);
    const page = extractPage(text, 'https://shop.example/', 'shop.example');
    assert.equal(page.title, 'Привет');
    assert.match(page.text, /Привет/);
  });

  it('уважает robots.txt и не считает пустой Disallow запретом', () => {
    const robots = 'User-agent: *\nDisallow:\n\nUser-agent: AI-Site-Factory\nDisallow: /private\nAllow: /private/public\n';
    assert.equal(isAllowedByRobots(robots, '/private/secret', 'AI-Site-Factory/0.2'), false);
    assert.equal(isAllowedByRobots(robots, '/private/public', 'AI-Site-Factory/0.2'), true);
    assert.equal(isAllowedByRobots(robots, '/about', 'other-bot'), true);
  });

  it('не принимает путь хранилища вне каталога запуска', () => {
    assert.throws(() => storedFilePath('/tmp/crawl-run', 'pages', '../secret.html'));
    assert.throws(() => storedFilePath('/tmp/crawl-run', 'images', 'not-a-uuid.png'));
  });
});

describe('безопасная загрузка', () => {
  it('не соединяется с адресом, если DNS указывает на закрытую сеть', async () => {
    let fetches = 0;
    const fetcher = createSafeFetcher({
      lookup: async () => ['10.0.0.8'],
      fetchImpl: async () => {
        fetches += 1;
        return new Response('no');
      },
    });
    await assert.rejects(
      () => fetcher.fetch('https://public.example/page', { signal: AbortSignal.timeout(1000), maxBytes: 1000, timeoutMs: 1000 }),
      (error: unknown) => error instanceof CrawlRequestError && /недопустимую сеть/u.test(error.message),
    );
    assert.equal(fetches, 0);
  });

  it('проверяет каждый редирект и не открывает закрытый адрес', async () => {
    const calls: string[] = [];
    const fetcher = createSafeFetcher({
      lookup: async (host) => (host === '127.0.0.1' ? ['127.0.0.1'] : ['93.184.216.34']),
      fetchImpl: async (url) => {
        calls.push(url);
        return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } });
      },
    });
    await assert.rejects(
      () => fetcher.fetch('https://public.example/start', { signal: AbortSignal.timeout(1000), maxBytes: 1000, timeoutMs: 1000 }),
      /Недопустимый сетевой адрес|недопустимую сеть/u,
    );
    assert.deepEqual(calls, ['https://public.example/start']);
  });

  it('останавливает редирект на другой сайт', async () => {
    const calls: string[] = [];
    const fetcher = createSafeFetcher({
      lookup: async () => ['93.184.216.34'],
      fetchImpl: async (url) => {
        calls.push(url);
        return new Response(null, { status: 302, headers: { location: 'https://evil.example/phish' } });
      },
    });
    await assert.rejects(
      () =>
        fetcher.fetch('https://public.example/start', {
          signal: AbortSignal.timeout(1000),
          maxBytes: 1000,
          timeoutMs: 1000,
          allowedHost: 'public.example',
        }),
      /пределы разрешённого сайта/u,
    );
    assert.deepEqual(calls, ['https://public.example/start']);
  });

  it('обрывает ответ больше лимита и слишком долгий ответ', async () => {
    const large = createSafeFetcher({
      lookup: async () => ['93.184.216.34'],
      fetchImpl: async () => new Response(Buffer.alloc(500, 1)),
    });
    await assert.rejects(
      () => large.fetch('https://public.example/big', { signal: AbortSignal.timeout(1000), maxBytes: 100, timeoutMs: 1000 }),
      /размера/u,
    );

    const slow = createSafeFetcher({
      lookup: async () => ['93.184.216.34'],
      fetchImpl: (_url, init) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve(new Response('late')), 2000);
          init.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        }),
    });
    await assert.rejects(
      () => slow.fetch('https://public.example/slow', { signal: new AbortController().signal, maxBytes: 1000, timeoutMs: 40 }),
      /время/u,
    );
  });
});

describe('HTTP API сбора', () => {
  let directory = '';
  let storageRoot = '';
  let databasePath = '';
  let database: DatabaseSync;
  let server: Server;
  let base = '';
  let releaseSlow: (() => void) | null = null;
  let slowStarted = false;
  const requested: string[] = [];

  const fetcher: CrawlFetcher = {
    async fetch(url, options) {
      requested.push(url);
      const parsed = new URL(url);
      if (options.signal.aborted) {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }
      if (parsed.hostname === 'solo.example') {
        if (parsed.pathname === '/robots.txt' || parsed.pathname === '/sitemap.xml') {
          return { finalUrl: url, status: 404, contentType: 'text/plain', body: Buffer.from('') };
        }
        return htmlResult(url, '<html><head><title>Одна страница</title></head><body><p>Только эта страница</p></body></html>');
      }
      if (parsed.hostname === 'limit.example') {
        if (parsed.pathname === '/robots.txt' || parsed.pathname === '/sitemap.xml') {
          return { finalUrl: url, status: 404, contentType: 'text/plain', body: Buffer.from('') };
        }
        const match = parsed.pathname.match(/^\/p\/(\d+)$/u);
        const number = match?.[1] ? Number(match[1]) : 1;
        const next = number < 5 ? `<a href="/p/${number + 1}">дальше</a>` : '';
        return htmlResult(url, `<html><head><title>Страница ${number}</title></head><body>${next}</body></html>`);
      }
      if (parsed.hostname === 'slow.example') {
        if (parsed.pathname === '/robots.txt' || parsed.pathname === '/sitemap.xml') {
          return { finalUrl: url, status: 404, contentType: 'text/plain', body: Buffer.from('') };
        }
        slowStarted = true;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 5000);
          releaseSlow = () => {
            clearTimeout(timer);
            resolve();
          };
          options.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        });
        return htmlResult(url, '<html><title>Поздно</title></html>');
      }
      if (parsed.hostname !== 'shop.example') {
        throw new Error(`запрос к чужому адресу ${url}`);
      }
      const page = shopHtml(parsed.pathname);
      if (!page) {
        return { finalUrl: url, status: 404, contentType: 'text/html', body: Buffer.from('нет') };
      }
      return { finalUrl: url, status: page.status, contentType: page.contentType, body: page.body };
    },
  };

  before(async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'sf-crawl-'));
    storageRoot = path.join(directory, 'crawls');
    databasePath = path.join(directory, 'app.db');
    database = openDatabase(databasePath);
    const app = createApp({
      database,
      version: '0.2.0',
      databaseLocation: 'backend/data/app.db',
      crawl: { fetcher, storageRoot, delayMs: 0 },
    });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    base = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    releaseSlow?.();
    server.close();
    await once(server, 'close');
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  async function send(urlPath: string, init?: RequestInit): Promise<{ status: number; body: unknown; bytes?: Buffer }> {
    const response = await fetch(`${base}${urlPath}`, init);
    if (urlPath.includes('/images/')) {
      const bytes = Buffer.from(await response.arrayBuffer());
      return { status: response.status, body: null, bytes };
    }
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
  }

  async function create(domain: string, name: string): Promise<ProjectDetail> {
    const response = await send('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        sourceDomain: domain,
        brief: 'Собрать страницы исходного сайта для проверки.',
        requirements: null,
        mode: 'stage_approval',
      }),
    });
    assert.equal(response.status, 201);
    return (response.body as { data: ProjectDetail }).data;
  }

  async function waitRun(projectId: string, runId: string): Promise<CrawlRun> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await send(`/api/projects/${projectId}/crawls/${runId}`);
      const run = (response.body as { data: CrawlRun }).data;
      if (run.status !== 'queued' && run.status !== 'running') {
        await sleep(30);
        return run;
      }
      await sleep(20);
    }
    throw new Error('сбор не завершился');
  }

  async function waitStage(projectId: string, status: string): Promise<ProjectDetail> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const response = await send(`/api/projects/${projectId}`);
      const detail = (response.body as { data: ProjectDetail }).data;
      if (detail.stages.find((stage) => stage.stageKey === 'collect')?.status === status) {
        return detail;
      }
      await sleep(20);
    }
    throw new Error(`этап сбора не перешёл в ${status}`);
  }

  it('сохраняет страницы, ссылки и изображение и не обходит внешние адреса', async () => {
    const detail = await create('https://shop.example/', 'Мастерская');
    const started = await send(`/api/projects/${detail.project.id}/crawls`, { method: 'POST' });
    assert.equal(started.status, 202);
    const run = (started.body as { data: CrawlRun }).data;
    assert.equal(run.status, 'queued');

    const finished = await waitRun(detail.project.id, run.id);
    assert.equal(finished.status, 'completed_with_errors');
    assert.ok(finished.pagesProcessed >= 4);
    assert.ok(finished.pagesFailed >= 1);
    const project = await waitStage(detail.project.id, 'error');
    assert.equal(project.project.status, 'error');
    assert.equal(project.stages.find((stage) => stage.stageKey === 'collect')?.status, 'error');
    assert.notEqual(project.project.progress, 100);

    const pages = await send(`/api/projects/${detail.project.id}/crawls/${run.id}/pages`);
    const list = (pages.body as { data: { id: string; url: string; status: string; title: string | null }[] }).data;
    const urls = list.map((item) => item.url);
    assert.ok(urls.includes('https://shop.example/'));
    assert.ok(urls.includes('https://shop.example/about.htm'));
    assert.ok(urls.includes('https://shop.example/contacts.htm'));
    assert.ok(urls.includes('https://shop.example/from-sitemap.htm'));
    assert.ok(urls.includes('https://shop.example/private/secret.htm'));
    assert.equal(list.find((item) => item.url === 'https://shop.example/catalog')?.status, 'error');
    assert.equal(list.find((item) => item.url === 'https://shop.example/private/secret.htm')?.status, 'skipped');
    assert.ok(!requested.some((url) => url.includes('127.0.0.1') || url.includes('external.example') || url.includes('evil.example') || url.includes('cdn.example') || url.includes('/private/')));

    const about = list.find((item) => item.url === 'https://shop.example/about.htm');
    assert.ok(about);
    const pageResponse = await send(`/api/projects/${detail.project.id}/crawls/${run.id}/pages/${about.id}`);
    const page = (pageResponse.body as { data: CrawlPageDetail }).data;
    assert.match(page.text ?? '', /Добро пожаловать в мастерскую/);
    assert.ok(page.links.some((link) => link.relation === 'external' && link.href.includes('external.example')));
    assert.ok(page.links.some((link) => link.relation === 'skipped'));
    const logo = page.images.find((image) => image.alt === 'Логотип мастерской');
    const externalImage = page.images.find((image) => image.alt === 'Внешнее фото');
    assert.equal(logo?.stored, true);
    assert.equal(externalImage?.stored, false);
    assert.ok(logo?.downloadUrl?.startsWith('/api/projects/'));
    const payload = JSON.stringify(pageResponse.body);
    assert.equal(payload.includes(storageRoot), false);
    assert.equal(payload.includes('stored_name'), false);
    const image = await send(logo?.downloadUrl ?? '');
    assert.equal(image.status, 200);
    assert.equal(image.bytes?.equals(PNG), true);

    const summary = await send(`/api/projects/${detail.project.id}/crawls/${run.id}/summary`);
    const summaryBody = (summary.body as { data: CrawlSummary }).data;
    assert.ok(summaryBody.errors.some((item) => item.url.endsWith('/catalog')));
    assert.ok(summaryBody.skipped.some((item) => item.url.includes('/private/')));

    const filtered = await send(`/api/projects/${detail.project.id}/crawls/${run.id}/pages?q=${encodeURIComponent('мастер')}&status=fetched`);
    const filteredPages = (filtered.body as { data: { title: string | null }[] }).data;
    assert.ok(filteredPages.some((item) => item.title === 'Мастерская'));

    const htmlFile = path.join(storageRoot, detail.project.id, run.id, 'pages', `${page.id}.html`);
    assert.equal(existsSync(htmlFile), true);
    const reopened = openDatabase(databasePath);
    const stored = reopened.prepare('SELECT title, text_content FROM crawl_pages WHERE id = ?').get(page.id) as
      | { title: string; text_content: string }
      | undefined;
    assert.equal(stored?.title, 'О нас');
    assert.match(stored?.text_content ?? '', /мастерскую/);
    reopened.close();
  });

  it('считает одностраничный сайт завершённым и позволяет повторить сбор', async () => {
    const detail = await create('https://solo.example/', 'Одна страница');
    const first = await send(`/api/projects/${detail.project.id}/crawls`, { method: 'POST' });
    const firstRun = (first.body as { data: CrawlRun }).data;
    const finished = await waitRun(detail.project.id, firstRun.id);
    assert.equal(finished.status, 'completed');
    assert.equal(finished.pagesProcessed, 1);
    assert.equal(finished.pagesFailed, 0);
    const project = await waitStage(detail.project.id, 'completed');
    assert.equal(project.project.status, 'awaiting_review');
    assert.equal(project.project.currentStage, 'analyze');
    assert.equal(project.project.progress, 14);
    assert.match(project.events[0]?.message ?? '', /не подключены/);

    const second = await send(`/api/projects/${detail.project.id}/crawls`, { method: 'POST' });
    assert.equal(second.status, 202);
    const secondRun = (second.body as { data: CrawlRun }).data;
    assert.notEqual(secondRun.id, firstRun.id);
    const repeated = await waitRun(detail.project.id, secondRun.id);
    assert.equal(repeated.status, 'completed');
    const history = await send(`/api/projects/${detail.project.id}/crawls`);
    assert.equal((history.body as { data: CrawlRun[] }).data.length, 2);
  });

  it('отменяет запущенный сбор и не оставляет этап в работе', async () => {
    slowStarted = false;
    const detail = await create('https://slow.example/start.htm', 'Медленный');
    const started = await send(`/api/projects/${detail.project.id}/crawls`, { method: 'POST' });
    const run = (started.body as { data: CrawlRun }).data;
    for (let attempt = 0; attempt < 50 && !slowStarted; attempt += 1) {
      await sleep(20);
    }
    assert.equal(slowStarted, true);
    const duplicate = await send(`/api/projects/${detail.project.id}/crawls`, { method: 'POST' });
    assert.equal(duplicate.status, 409);
    const cancelled = await send(`/api/projects/${detail.project.id}/crawls/${run.id}/cancel`, { method: 'POST' });
    assert.equal(cancelled.status, 200);
    assert.equal((cancelled.body as { data: CrawlRun }).data.status, 'cancelled');
    const finished = await waitRun(detail.project.id, run.id);
    assert.equal(finished.status, 'cancelled');
    const project = await waitStage(detail.project.id, 'pending');
    assert.equal(project.project.status, 'created');
    const again = await send(`/api/projects/${detail.project.id}/crawls/${run.id}/cancel`, { method: 'POST' });
    assert.equal(again.status, 409);
    releaseSlow?.();
  });

  it('помечает усечённый по лимиту сбор как неполный', async () => {
    const settings = await send('/api/settings/crawl');
    assert.equal((settings.body as { data: { pageLimit: number } }).data.pageLimit, 100);
    const updated = await send('/api/settings/crawl', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageLimit: 2 }),
    });
    assert.equal(updated.status, 200);
    const invalid = await send('/api/settings/crawl', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageLimit: 0 }),
    });
    assert.equal(invalid.status, 400);

    const detail = await create('https://limit.example/p/1', 'Цепочка');
    const started = await send(`/api/projects/${detail.project.id}/crawls`, { method: 'POST' });
    const run = await waitRun(detail.project.id, (started.body as { data: CrawlRun }).data.id);
    assert.equal(run.truncated, true);
    assert.equal(run.status, 'completed_with_errors');
    assert.ok(run.pagesProcessed <= 2);
    const project = await waitStage(detail.project.id, 'error');
    assert.notEqual(project.stages.find((stage) => stage.stageKey === 'collect')?.status, 'completed');
    await send('/api/settings/crawl', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageLimit: 100 }),
    });
  });

  it('останавливает запуск по общему лимиту времени', async () => {
    database.prepare('UPDATE crawl_settings SET run_timeout_ms = 0 WHERE id = 1').run();
    const detail = await create('https://shop.example/timeout', 'Таймаут');
    const started = await send(`/api/projects/${detail.project.id}/crawls`, { method: 'POST' });
    const run = await waitRun(detail.project.id, (started.body as { data: CrawlRun }).data.id);
    assert.equal(run.status, 'failed');
    assert.equal(run.pagesProcessed, 0);
    const project = await waitStage(detail.project.id, 'error');
    assert.match(project.stages.find((stage) => stage.stageKey === 'collect')?.errorMessage ?? '', /время/u);
    database.prepare('UPDATE crawl_settings SET run_timeout_ms = 480000 WHERE id = 1').run();
  });
});

describe('восстановление после перезапуска', () => {
  it('не оставляет незавершённый запуск в статусе выполнения', () => {
    const database = openDatabase(':memory:');
    const detail = createProject(database, {
      name: 'Обрыв',
      sourceDomain: 'shop.example',
      sourceUrl: 'https://shop.example/',
      brief: 'Проверить восстановление запуска.',
      requirements: null,
      mode: 'autopilot',
    });
    const now = new Date().toISOString();
    const runId = randomUUID();
    database
      .prepare(
        `
          INSERT INTO crawl_runs (
            id, project_id, status, start_url, pages_found, pages_processed, pages_skipped, pages_failed,
            truncated, page_limit, created_at, updated_at, started_at
          ) VALUES (?, ?, 'running', 'https://shop.example/', 1, 0, 0, 0, 0, 100, ?, ?, ?)
        `,
      )
      .run(runId, detail.project.id, now, now, now);
    database
      .prepare(`UPDATE project_stages SET status = 'in_progress', started_at = ? WHERE project_id = ? AND stage_key = 'collect'`)
      .run(now, detail.project.id);
    database.prepare(`UPDATE projects SET status = 'in_progress' WHERE id = ?`).run(detail.project.id);

    assert.equal(recoverInterruptedCrawls(database), 1);
    assert.equal(recoverInterruptedCrawls(database), 0);
    const run = findCrawlRun(database, runId);
    assert.equal(run?.status, 'failed');
    assert.match(run?.errorMessage ?? '', /перезапуском/u);
    const stage = database
      .prepare(`SELECT status, error_message FROM project_stages WHERE project_id = ? AND stage_key = 'collect'`)
      .get(detail.project.id) as { status: string; error_message: string };
    assert.equal(stage.status, 'error');
    assert.match(stage.error_message, /перезапуском/u);
    const project = database.prepare('SELECT status FROM projects WHERE id = ?').get(detail.project.id) as { status: string };
    assert.equal(project.status, 'error');
    database.close();
  });
});
