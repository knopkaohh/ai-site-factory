import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { DatabaseSync } from 'node:sqlite';
import { STAGE_CATALOG, type ProjectDetail, type ProjectList } from '../../shared/src/index';
import { startStage } from '../src/automation/runner';
import { createApp } from '../src/app';
import { openDatabase, withTransaction } from '../src/db/database';
import { createProject } from '../src/services/projectService';

interface ErrorBody {
  error: { code: string; message: string; details?: { field: string; message: string }[] };
}

function payload(name = 'Кафе Север', domain = 'https://Cafe.Example/menu') {
  return {
    name,
    sourceDomain: domain,
    brief: 'Сделать понятную витрину и сохранить тексты меню.',
    requirements: 'Не менять доменные адреса страниц.',
    mode: 'stage_approval',
  };
}

describe('база и транзакции', () => {
  it('откатывает транзакцию, если работа внутри не завершилась', () => {
    const database = openDatabase(':memory:');
    database.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY)');
    assert.throws(() => {
      withTransaction(database, () => {
        database.prepare('INSERT INTO probe (id) VALUES (?)').run(1);
        throw new Error('сбой');
      });
    });
    const row = database.prepare('SELECT COUNT(*) AS count FROM probe').get() as { count: number };
    assert.equal(Number(row.count), 0);
    database.close();
  });

  it('сохраняет проект после закрытия и повторного открытия файла', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'sf-persist-'));
    const databasePath = path.join(directory, 'app.db');
    const database = openDatabase(databasePath);
    const created = createProject(database, {
      name: 'Мастерская',
      sourceDomain: 'workshop.example',
      sourceUrl: 'https://workshop.example/',
      brief: 'Обновить каталог изделий.',
      requirements: null,
      mode: 'autopilot',
    });
    database.close();

    const reopened = openDatabase(databasePath);
    const row = reopened.prepare('SELECT name, source_domain FROM projects WHERE id = ?').get(created.project.id) as
      | { name: string; source_domain: string }
      | undefined;
    const stages = reopened.prepare('SELECT COUNT(*) AS count FROM project_stages WHERE project_id = ?').get(
      created.project.id,
    ) as { count: number };
    assert.equal(row?.name, 'Мастерская');
    assert.equal(row?.source_domain, 'workshop.example');
    assert.equal(Number(stages.count), 7);
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  });
});

describe('HTTP API проектов', () => {
  let directory = '';
  let database: DatabaseSync;
  let server: Server;
  let base = '';

  before(async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'sf-api-'));
    database = openDatabase(path.join(directory, 'app.db'));
    const app = createApp({
      database,
      version: '0.1.0',
      databaseLocation: 'backend/data/app.db',
    });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    base = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    server.close();
    await once(server, 'close');
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  async function send(urlPath: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${base}${urlPath}`, init);
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  it('сообщает состояние сервера и не помечает неподключённые интеграции как готовые', async () => {
    const { status, body } = await send('/api/health');
    const data = (body as { data: { status: string; database: { status: string; location: string }; integrations: { id: string; state: string }[] } }).data;
    assert.equal(status, 200);
    assert.equal(data.status, 'ok');
    assert.equal(data.database.status, 'ok');
    assert.equal(data.database.location, 'backend/data/app.db');
    assert.equal(data.integrations.find((item) => item.id === 'crawler')?.state, 'ok');
    assert.ok(data.integrations.filter((item) => item.id !== 'crawler').every((item) => item.state !== 'ok'));
  });

  it('начинает с пустого списка и нулевых счётчиков', async () => {
    const { status, body } = await send('/api/projects');
    const data = (body as { data: ProjectList }).data;
    assert.equal(status, 200);
    assert.deepEqual(data.projects, []);
    assert.deepEqual(data.summary, { total: 0, inProgress: 0, demoReady: 0 });
  });

  it('создаёт проект, семь ожидающих этапов и запись истории', async () => {
    const { status, body } = await send('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload()),
    });
    const detail = (body as { data: ProjectDetail }).data;
    assert.equal(status, 201);
    assert.equal(detail.project.name, 'Кафе Север');
    assert.equal(detail.project.sourceDomain, 'cafe.example');
    assert.equal(detail.project.sourceUrl, 'https://cafe.example/menu');
    assert.equal(detail.project.status, 'created');
    assert.equal(detail.project.currentStage, 'collect');
    assert.equal(detail.project.progress, 0);
    assert.equal(detail.project.mode, 'stage_approval');
    assert.equal(detail.project.requirements, 'Не менять доменные адреса страниц.');
    assert.equal(detail.stages.length, STAGE_CATALOG.length);
    assert.deepEqual(
      detail.stages.map((stage) => stage.title),
      STAGE_CATALOG.map((stage) => stage.title),
    );
    assert.ok(detail.stages.every((stage) => stage.status === 'pending' && stage.startedAt === null && stage.completedAt === null));
    assert.equal(detail.events.length, 1);
    assert.equal(detail.events[0]?.eventType, 'project.created');
    assert.match(detail.events[0]?.message ?? '', /cafe\.example/);
  });

  it('отклоняет неполные данные на сервере', async () => {
    const { status, body } = await send('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Без домена' }),
    });
    const error = (body as ErrorBody).error;
    assert.equal(status, 400);
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.ok(error.details?.some((detail) => detail.field === 'sourceDomain'));
  });

  it('ищет по названию без учёта регистра и фильтрует по статусу, не искажая сводку', async () => {
    const listed = await send('/api/projects?q=' + encodeURIComponent('КАФЕ'));
    const data = (listed.body as { data: ProjectList }).data;
    assert.equal(listed.status, 200);
    assert.equal(data.projects.length, 1);
    assert.equal(data.summary.total, 1);
    assert.equal(data.summary.inProgress, 0);
    assert.equal(data.summary.demoReady, 0);

    const byDomain = await send('/api/projects?q=cafe.example');
    assert.equal((byDomain.body as { data: ProjectList }).data.projects.length, 1);

    const filtered = await send('/api/projects?status=in_progress');
    const filteredData = (filtered.body as { data: ProjectList }).data;
    assert.equal(filteredData.projects.length, 0);
    assert.equal(filteredData.summary.total, 1);

    const injected = await send('/api/projects?q=' + encodeURIComponent("' OR '1'='1"));
    assert.equal((injected.body as { data: ProjectList }).data.projects.length, 0);

    const wildcard = await send('/api/projects?q=' + encodeURIComponent('%'));
    assert.equal((wildcard.body as { data: ProjectList }).data.projects.length, 0);
  });

  it('возвращает 404 для отсутствующего проекта и неизвестного метода', async () => {
    const missing = await send('/api/projects/11111111-1111-4111-8111-111111111111');
    assert.equal(missing.status, 404);
    assert.equal((missing.body as ErrorBody).error.code, 'NOT_FOUND');
    const unknown = await send('/api/missing');
    assert.equal(unknown.status, 404);
  });

  it('обновляет разрешённые поля и пишет историю, но не даёт подделать прогресс', async () => {
    const listed = await send('/api/projects');
    const id = (listed.body as { data: ProjectList }).data.projects[0]?.id;
    assert.ok(id);

    const blocked = await send(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Кафе Север 2', status: 'demo_ready', progress: 100 }),
    });
    assert.equal(blocked.status, 400);

    const updated = await send(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Кафе Север 2',
        sourceDomain: 'http://new.cafe.example/path',
        requirements: '',
        mode: 'autopilot',
      }),
    });
    const detail = (updated.body as { data: ProjectDetail }).data;
    assert.equal(updated.status, 200);
    assert.equal(detail.project.name, 'Кафе Север 2');
    assert.equal(detail.project.sourceDomain, 'new.cafe.example');
    assert.equal(detail.project.sourceUrl, 'http://new.cafe.example/path');
    assert.equal(detail.project.requirements, null);
    assert.equal(detail.project.mode, 'autopilot');
    assert.equal(detail.project.status, 'created');
    assert.equal(detail.project.progress, 0);
    assert.equal(detail.events.length, 2);
    assert.equal(detail.events[0]?.eventType, 'project.updated');
    assert.match(detail.events[0]?.message ?? '', /Автопилот/);
  });

  it('не меняет этапы при попытке запуска неподключённого сервиса', async () => {
    const listed = await send('/api/projects');
    const id = (listed.body as { data: ProjectList }).data.projects[0]?.id;
    assert.ok(id);
    assert.throws(() => startStage(database, id, 'analyze'), /не подключён/);
    const loaded = await send(`/api/projects/${id}`);
    const detail = (loaded.body as { data: ProjectDetail }).data;
    assert.ok(detail.stages.every((stage) => stage.status === 'pending'));
    assert.equal(detail.events.length, 2);
  });

  it('удаляет проект вместе с этапами и событиями', async () => {
    const listed = await send('/api/projects');
    const id = (listed.body as { data: ProjectList }).data.projects[0]?.id;
    assert.ok(id);
    const removed = await send(`/api/projects/${id}`, { method: 'DELETE' });
    assert.equal(removed.status, 204);
    assert.equal(removed.body, null);
    const missing = await send(`/api/projects/${id}`);
    assert.equal(missing.status, 404);
    const stages = database.prepare('SELECT COUNT(*) AS count FROM project_stages WHERE project_id = ?').get(id) as {
      count: number;
    };
    const events = database.prepare('SELECT COUNT(*) AS count FROM project_events WHERE project_id = ?').get(id) as {
      count: number;
    };
    assert.equal(Number(stages.count), 0);
    assert.equal(Number(events.count), 0);
    const afterDelete = await send('/api/projects');
    assert.equal((afterDelete.body as { data: ProjectList }).data.summary.total, 0);
  });

  it('отклоняет некорректный JSON', async () => {
    const { status, body } = await send('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    assert.equal(status, 400);
    assert.equal((body as ErrorBody).error.code, 'BAD_JSON');
  });
});

describe('health при недоступной базе', () => {
  it('возвращает 503 и честный статус базы', async () => {
    const database = openDatabase(':memory:');
    const app = createApp({ database, version: '0.1.0', databaseLocation: ':memory:' });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    database.close();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
    const body = (await response.json()) as { data: { status: string; database: { status: string; message?: string } } };
    assert.equal(response.status, 503);
    assert.equal(body.data.status, 'degraded');
    assert.equal(body.data.database.status, 'error');
    assert.equal(body.data.database.message, 'База данных недоступна');
    server.close();
    await once(server, 'close');
  });
});
