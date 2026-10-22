import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import type { CrawlLinkRelation, CrawlSettings } from '../../../shared/src/index';
import { withTransaction } from '../db/database';
import { decodeHtml, excerpt, extractPage, looksLikeHtml } from './extract';
import { CRAWLER_USER_AGENT, CrawlRequestError, imageExtension, type CrawlFetcher } from './fetcher';
import { CRAWL_MAX_IMAGE_ROWS, CRAWL_MAX_LINKS, CRAWL_MAX_SITEMAPS } from './limits';
import { resolveCrawlUrl, shouldQueue, type ResolvedCrawlUrl } from './policy';
import {
  ensureCrawlSettings,
  findCrawlRun,
  finishCrawlRun,
  insertCrawlImage,
  insertCrawlLink,
  insertCrawlPage,
  markCrawlCancelled,
  markCrawlRunning,
  updateCancelledProgress,
  updateCrawlImage,
  updateCrawlProgress,
  type CrawlProgressPatch,
} from './repository';
import { extractSitemapLocs, isAllowedByRobots, parseRobots, robotsPath } from './robots';
import { ensureCrawlDirectory, storedFilePath } from './storage';

export type CrawlEngineResult =
  | { kind: 'cancelled'; claimed: boolean }
  | {
      kind: 'finished';
      status: 'completed' | 'completed_with_errors' | 'failed';
      message: string | null;
    };

interface EngineOptions {
  database: DatabaseSync;
  fetcher: CrawlFetcher;
  storageRoot: string;
  runId: string;
  signal: AbortSignal;
  delayMs: number;
}

interface SavedPage {
  url: string;
  finalUrl: string | null;
  status: 'fetched' | 'skipped' | 'error';
  httpStatus: number | null;
  title: string | null;
  description: string | null;
  text: string | null;
  errorMessage: string | null;
  skipReason: string | null;
}

interface SavedImage {
  id: string;
  sourceUrl: string;
  alt: string | null;
}

export async function executeCrawl(options: EngineOptions): Promise<CrawlEngineResult> {
  const run = findCrawlRun(options.database, options.runId);
  if (!run) {
    return { kind: 'cancelled', claimed: false };
  }
  if (!markCrawlRunning(options.database, run.id, new Date().toISOString())) {
    return { kind: 'cancelled', claimed: false };
  }

  const settings = ensureCrawlSettings(options.database);
  const allowedHost = new URL(run.startUrl).hostname.toLowerCase();
  const directory = ensureCrawlDirectory(options.storageRoot, run.projectId, run.id);
  const deadline = Date.now() + settings.runTimeoutMs;
  const seen = new Set<string>();
  const queue: string[] = [];
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let truncated = false;
  let timedOut = false;
  let robotsText: string | null = null;

  const counts = (): CrawlProgressPatch => ({
    pagesFound: processed + skipped + failed + queue.length,
    pagesProcessed: processed,
    pagesSkipped: skipped,
    pagesFailed: failed,
    currentUrl: null,
    truncated,
  });

  const publish = (currentUrl: string | null) => {
    if (options.signal.aborted) {
      return;
    }
    updateCrawlProgress(options.database, run.id, { ...counts(), currentUrl }, new Date().toISOString());
  };

  const savePage = (
    pageId: string,
    page: SavedPage,
    links: { href: string; text: string; relation: CrawlLinkRelation }[] = [],
    images: SavedImage[] = [],
  ) => {
    withTransaction(options.database, () => {
      insertCrawlPage(options.database, {
        id: pageId,
        runId: run.id,
        projectId: run.projectId,
        url: page.url,
        finalUrl: page.finalUrl,
        status: page.status,
        httpStatus: page.httpStatus,
        title: page.title,
        description: page.description,
        text: page.text,
        excerpt: page.text ? excerpt(page.text) : null,
        errorMessage: page.errorMessage,
        skipReason: page.skipReason,
        fetchedAt: new Date().toISOString(),
      });
      for (const link of links) {
        insertCrawlLink(options.database, {
          pageId,
          href: link.href,
          text: link.text || null,
          relation: link.relation,
        });
      }
      for (const image of images) {
        insertCrawlImage(options.database, { id: image.id, pageId, sourceUrl: image.sourceUrl, alt: image.alt });
      }
    });
  };

  const consider = (target: ResolvedCrawlUrl, fromFrame: boolean) => {
    if (!shouldQueue(target, fromFrame)) {
      return;
    }
    const href = target.url.href;
    if (href.length > 2000 || seen.has(href)) {
      return;
    }
    if (seen.size >= run.pageLimit) {
      truncated = true;
      return;
    }
    seen.add(href);
    if (robotsText !== null && !isAllowedByRobots(robotsText, robotsPath(target.url), CRAWLER_USER_AGENT)) {
      savePage(randomUUID(), {
        url: href,
        finalUrl: null,
        status: 'skipped',
        httpStatus: null,
        title: null,
        description: null,
        text: null,
        errorMessage: null,
        skipReason: 'Запрещено robots.txt',
      });
      skipped += 1;
      publish(null);
      return;
    }
    queue.push(href);
    publish(null);
  };

  const remember = (href: string) => {
    seen.add(href);
    const index = queue.indexOf(href);
    if (index >= 0) {
      queue.splice(index, 1);
    }
  };

  const drain = (reason: string) => {
    while (queue.length > 0) {
      const url = queue.shift();
      if (!url) {
        break;
      }
      savePage(randomUUID(), {
        url,
        finalUrl: null,
        status: 'skipped',
        httpStatus: null,
        title: null,
        description: null,
        text: null,
        errorMessage: null,
        skipReason: reason,
      });
      skipped += 1;
    }
  };

  const finish = (): CrawlEngineResult => {
    const current = findCrawlRun(options.database, run.id);
    const now = new Date().toISOString();
    const patch = counts();
    if (options.signal.aborted || current?.status === 'cancelled') {
      const claimed = markCrawlCancelled(options.database, run.id, now);
      updateCancelledProgress(options.database, run.id, patch, now);
      return { kind: 'cancelled', claimed };
    }

    let status: 'completed' | 'completed_with_errors' | 'failed';
    let message: string | null;
    if (processed === 0) {
      status = 'failed';
      message = timedOut
        ? 'Истекло время запуска, ни одна страница не собрана.'
        : 'Не удалось собрать ни одной страницы.';
    } else if (failed > 0 || truncated || timedOut) {
      status = 'completed_with_errors';
      message = timedOut
        ? 'Истекло время запуска. Сохранена только часть страниц, этап не завершён.'
        : truncated
          ? `Достигнут лимит ${run.pageLimit} страниц. Часть найденных адресов не обработана, этап не завершён.`
          : 'Часть страниц не собрана. Результат неполный, этап не завершён.';
    } else {
      status = 'completed';
      message = null;
    }
    const wrote = finishCrawlRun(options.database, run.id, {
      status,
      patch,
      errorMessage: message,
      finishedAt: now,
    });
    if (!wrote) {
      updateCancelledProgress(options.database, run.id, patch, now);
      return { kind: 'cancelled', claimed: false };
    }
    return { kind: 'finished', status, message };
  };

  try {
    robotsText = await readOptional(options, new URL('/robots.txt', run.startUrl).href, allowedHost, settings);
    if (options.signal.aborted) {
      return finish();
    }

    const start = resolveCrawlUrl(run.startUrl, run.startUrl, allowedHost);
    if (!start?.sameSite) {
      savePage(randomUUID(), {
        url: run.startUrl,
        finalUrl: null,
        status: 'error',
        httpStatus: null,
        title: null,
        description: null,
        text: null,
        errorMessage: 'Стартовый адрес не прошёл проверку',
        skipReason: null,
      });
      failed += 1;
      return finish();
    }
    consider(start, false);

    const sitemapUrls = sitemapSeeds(run.startUrl, robotsText);
    let fetchedSitemaps = 0;
    while (sitemapUrls.length > 0 && fetchedSitemaps < CRAWL_MAX_SITEMAPS && !options.signal.aborted && Date.now() < deadline) {
      const sitemapUrl = sitemapUrls.shift();
      if (!sitemapUrl) {
        break;
      }
      fetchedSitemaps += 1;
      const xml = await readOptional(options, sitemapUrl, allowedHost, settings);
      if (!xml) {
        continue;
      }
      for (const loc of extractSitemapLocs(xml)) {
        const resolved = resolveCrawlUrl(loc, sitemapUrl, allowedHost);
        if (!resolved?.sameSite) {
          continue;
        }
        if (resolved.url.pathname.toLowerCase().endsWith('.xml')) {
          if (!sitemapUrls.includes(resolved.url.href)) {
            sitemapUrls.push(resolved.url.href);
          }
          continue;
        }
        consider(resolved, false);
      }
    }

    while (queue.length > 0) {
      if (options.signal.aborted) {
        break;
      }
      if (Date.now() >= deadline) {
        timedOut = true;
        truncated = true;
        break;
      }
      const url = queue.shift();
      if (!url) {
        break;
      }
      publish(url);
      const outcome = await crawlPage({
        options,
        directory,
        url,
        allowedHost,
        settings,
        savePage,
        consider,
        remember,
      });
      if (outcome === 'requeue') {
        queue.unshift(url);
        break;
      }
      if (outcome === 'fetched') {
        processed += 1;
      } else if (outcome === 'skipped') {
        skipped += 1;
      } else if (outcome === 'error') {
        failed += 1;
      }
      publish(null);
      await pause(options.delayMs, options.signal);
    }

    if (options.signal.aborted) {
      drain('Запуск отменён до загрузки');
    } else if (timedOut) {
      drain('Истекло общее время запуска');
    }
    return finish();
  } catch (error) {
    if (options.signal.aborted) {
      drain('Запуск отменён до загрузки');
      return finish();
    }
    throw error;
  }
}

async function readOptional(
  options: EngineOptions,
  url: string,
  allowedHost: string,
  settings: CrawlSettings,
): Promise<string | null> {
  try {
    const result = await options.fetcher.fetch(url, {
      signal: options.signal,
      maxBytes: settings.maxResponseBytes,
      timeoutMs: settings.requestTimeoutMs,
      allowedHost,
    });
    if (result.status !== 200) {
      return null;
    }
    return decodeHtml(result.body, result.contentType);
  } catch {
    return null;
  }
}

function sitemapSeeds(startUrl: string, robotsBody: string | null): string[] {
  const seeds = [new URL('/sitemap.xml', startUrl).href];
  if (!robotsBody) {
    return seeds;
  }
  const allowedHost = new URL(startUrl).hostname;
  for (const sitemap of parseRobots(robotsBody).sitemaps) {
    const resolved = resolveCrawlUrl(sitemap, startUrl, allowedHost);
    if (resolved?.sameSite) {
      seeds.push(resolved.url.href);
    }
  }
  return [...new Set(seeds)];
}

type PageOutcome = 'fetched' | 'skipped' | 'error' | 'requeue';

async function crawlPage(input: {
  options: EngineOptions;
  directory: string;
  url: string;
  allowedHost: string;
  settings: CrawlSettings;
  savePage: (pageId: string, page: SavedPage, links?: { href: string; text: string; relation: CrawlLinkRelation }[], images?: SavedImage[]) => void;
  consider: (target: ResolvedCrawlUrl, fromFrame: boolean) => void;
  remember: (href: string) => void;
}): Promise<PageOutcome> {
  const { options, url, allowedHost } = input;
  let result;
  try {
    result = await options.fetcher.fetch(url, {
      signal: options.signal,
      maxBytes: input.settings.maxResponseBytes,
      timeoutMs: input.settings.requestTimeoutMs,
      allowedHost,
    });
  } catch (error) {
    if (options.signal.aborted) {
      return 'requeue';
    }
    input.savePage(randomUUID(), {
      url,
      finalUrl: null,
      status: 'error',
      httpStatus: null,
      title: null,
      description: null,
      text: null,
      errorMessage: error instanceof CrawlRequestError ? error.message : 'Не удалось загрузить страницу',
      skipReason: null,
    });
    return 'error';
  }

  if (options.signal.aborted) {
    return 'requeue';
  }

  input.remember(result.finalUrl);
  if (result.status === 401 || result.status === 403) {
    input.savePage(randomUUID(), {
      url,
      finalUrl: result.finalUrl,
      status: 'error',
      httpStatus: result.status,
      title: null,
      description: null,
      text: null,
      errorMessage: 'Доступ ограничен. Обход авторизации и других защит не выполняется.',
      skipReason: null,
    });
    return 'error';
  }
  if (result.status < 200 || result.status >= 300) {
    input.savePage(randomUUID(), {
      url,
      finalUrl: result.finalUrl,
      status: 'error',
      httpStatus: result.status,
      title: null,
      description: null,
      text: null,
      errorMessage: `Страница ответила кодом ${result.status}`,
      skipReason: null,
    });
    return 'error';
  }
  if (!looksLikeHtml(result.contentType, result.body)) {
    input.savePage(randomUUID(), {
      url,
      finalUrl: result.finalUrl,
      status: 'skipped',
      httpStatus: result.status,
      title: null,
      description: null,
      text: null,
      errorMessage: null,
      skipReason: 'Ответ не является HTML-страницей',
    });
    return 'skipped';
  }

  const html = decodeHtml(result.body, result.contentType);
  const extracted = extractPage(html, result.finalUrl, allowedHost);
  const pageId = randomUUID();
  const links = extracted.links.slice(0, CRAWL_MAX_LINKS).map((link) => ({
    href: link.target?.url.href ?? link.href,
    text: link.text,
    relation: relationOf(link.target),
  }));
  const images = extracted.images.slice(0, CRAWL_MAX_IMAGE_ROWS).map((image) => ({
    id: randomUUID(),
    sourceUrl: image.target?.url.href ?? image.src,
    alt: image.alt || null,
    target: image.target,
  }));

  try {
    const htmlName = `${pageId}.html`;
    writeFileSync(storedFilePath(input.directory, 'pages', htmlName), html, 'utf8');
    input.savePage(
      pageId,
      {
        url,
        finalUrl: result.finalUrl,
        status: 'fetched',
        httpStatus: result.status,
        title: clip(extracted.title, 300),
        description: clip(extracted.description, 500),
        text: extracted.text,
        errorMessage: null,
        skipReason: null,
      },
      links,
      images.map(({ id, sourceUrl, alt }) => ({ id, sourceUrl, alt })),
    );
  } catch (error) {
    console.error('Не удалось сохранить страницу', error);
    input.savePage(randomUUID(), {
      url,
      finalUrl: result.finalUrl,
      status: 'error',
      httpStatus: result.status,
      title: null,
      description: null,
      text: null,
      errorMessage: 'Не удалось сохранить страницу',
      skipReason: null,
    });
    return 'error';
  }

  for (const link of extracted.links) {
    if (link.target) {
      input.consider(link.target, link.fromFrame);
    }
  }
  await storeImages(options, input.directory, input.settings, allowedHost, images);
  return 'fetched';
}

function relationOf(target: ResolvedCrawlUrl | null): CrawlLinkRelation {
  if (!target) {
    return 'skipped';
  }
  return target.sameSite ? 'internal' : 'external';
}

function clip(value: string | null, limit: number): string | null {
  if (!value) {
    return null;
  }
  return value.length > limit ? value.slice(0, limit) : value;
}

async function storeImages(
  options: EngineOptions,
  directory: string,
  settings: CrawlSettings,
  allowedHost: string,
  images: { id: string; sourceUrl: string; target: ResolvedCrawlUrl | null }[],
): Promise<void> {
  let downloads = 0;
  for (const image of images) {
    if (options.signal.aborted) {
      return;
    }
    if (!image.target?.sameSite) {
      continue;
    }
    if (!canRequestImage(image.target.url.pathname)) {
      updateCrawlImage(options.database, {
        id: image.id,
        storedName: null,
        contentType: null,
        byteSize: null,
        errorMessage: 'Тип файла не скачивается',
      });
      continue;
    }
    if (downloads >= settings.maxImagesPerPage) {
      updateCrawlImage(options.database, {
        id: image.id,
        storedName: null,
        contentType: null,
        byteSize: null,
        errorMessage: 'Превышен лимит изображений на страницу',
      });
      continue;
    }
    downloads += 1;
    try {
      const result = await options.fetcher.fetch(image.target.url.href, {
        signal: options.signal,
        maxBytes: settings.maxImageBytes,
        timeoutMs: settings.requestTimeoutMs,
        allowedHost,
      });
      const extension = imageExtension(result.contentType, result.body);
      if (result.status !== 200 || !extension) {
        updateCrawlImage(options.database, {
          id: image.id,
          storedName: null,
          contentType: null,
          byteSize: null,
          errorMessage: 'Изображение недоступно или тип файла не поддерживается',
        });
        continue;
      }
      const storedName = `${image.id}.${extension}`;
      writeFileSync(storedFilePath(directory, 'images', storedName), result.body);
      updateCrawlImage(options.database, {
        id: image.id,
        storedName,
        contentType: extension === 'jpg' ? 'image/jpeg' : `image/${extension}`,
        byteSize: result.body.length,
        errorMessage: null,
      });
    } catch (error) {
      if (options.signal.aborted) {
        return;
      }
      updateCrawlImage(options.database, {
        id: image.id,
        storedName: null,
        contentType: null,
        byteSize: null,
        errorMessage: error instanceof CrawlRequestError ? error.message : 'Не удалось скачать изображение',
      });
    }
  }
}

function canRequestImage(pathname: string): boolean {
  const last = pathname.split('/').pop() ?? '';
  if (!last.includes('.')) {
    return true;
  }
  const extension = last.split('.').pop()?.toLowerCase() ?? '';
  return extension === 'png' || extension === 'jpg' || extension === 'jpeg' || extension === 'gif' || extension === 'webp';
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
