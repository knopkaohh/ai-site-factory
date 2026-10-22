import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  PROJECT_EVENT_TYPES,
  type CrawlPageDetail,
  type CrawlPageStatus,
  type CrawlPageSummary,
  type CrawlRun,
  type CrawlSettings,
  type CrawlSummary,
} from '../../../shared/src/index';
import { withTransaction } from '../db/database';
import {
  applyProjectStage,
  findProject,
  insertEvent,
  listStages,
  resetCollectStageIfRunning,
} from '../repositories/projectRepository';
import { executeCrawl } from './engine';
import {
  ensureCrawlSettings,
  failInterruptedRun,
  findActiveCrawlRun,
  findCrawlRun,
  findStoredImage,
  getCrawlPage,
  getCrawlSummary,
  insertCrawlRun,
  listCrawlPages,
  listCrawlRuns,
  listInterruptedCrawlRuns,
  markCrawlCancelled,
  saveCrawlPageLimit,
} from './repository';
import { crawlRuntime } from './runtime';
import { crawlRunDirectory, storedFilePath } from './storage';

const activeProjects = new Set<string>();
const controllers = new Map<string, AbortController>();

export class CrawlConflictError extends Error {
  readonly code = 'CRAWL_ACTIVE';

  constructor() {
    super('Сбор для этого проекта уже выполняется');
    this.name = 'CrawlConflictError';
  }
}

export class CrawlNotActiveError extends Error {
  readonly code = 'CRAWL_NOT_ACTIVE';

  constructor() {
    super('Этот запуск уже завершён');
    this.name = 'CrawlNotActiveError';
  }
}

const RESTART_MESSAGE =
  'Запуск прерван перезапуском сервера. Уже сохранённые страницы остались в истории, сбор можно запустить снова.';

export function readCrawlSettings(database: DatabaseSync): CrawlSettings {
  return ensureCrawlSettings(database);
}

export function changeCrawlPageLimit(database: DatabaseSync, pageLimit: number): CrawlSettings {
  return saveCrawlPageLimit(database, pageLimit);
}

export function startProjectCrawl(database: DatabaseSync, projectId: string): CrawlRun {
  const project = findProject(database, projectId);
  if (!project) {
    throw new Error('PROJECT_NOT_FOUND');
  }
  if (activeProjects.has(projectId) || findActiveCrawlRun(database, projectId)) {
    throw new CrawlConflictError();
  }

  const settings = ensureCrawlSettings(database);
  const now = new Date().toISOString();
  const id = randomUUID();
  activeProjects.add(projectId);
  try {
    withTransaction(database, () => {
      insertCrawlRun(database, {
        id,
        projectId,
        startUrl: project.sourceUrl,
        pageLimit: settings.pageLimit,
        createdAt: now,
      });
      applyProjectStage(
        database,
        projectId,
        'collect',
        { status: 'in_progress', startedAt: now, completedAt: null, errorMessage: null },
        'in_progress',
        now,
      );
      insertEvent(database, {
        id: randomUUID(),
        projectId,
        eventType: PROJECT_EVENT_TYPES.crawlStarted,
        message: `Запущен сбор исходного сайта: ${project.sourceUrl}. Лимит страниц: ${settings.pageLimit}.`,
        createdAt: now,
      });
    });
  } catch (error) {
    activeProjects.delete(projectId);
    if (isUniqueConstraint(error)) {
      throw new CrawlConflictError();
    }
    throw error;
  }

  const controller = new AbortController();
  controllers.set(id, controller);
  const runtime = crawlRuntime();
  setImmediate(() => {
    void runCrawl(database, projectId, id, controller.signal, runtime.fetcher, runtime.storageRoot, runtime.delayMs)
      .catch((error: unknown) => {
        console.error('Сбор завершился с внутренней ошибкой', error);
      })
      .finally(() => {
        activeProjects.delete(projectId);
        controllers.delete(id);
      });
  });

  const created = findCrawlRun(database, id);
  if (!created) {
    activeProjects.delete(projectId);
    controllers.delete(id);
    throw new Error('Запуск не найден сразу после создания');
  }
  return created;
}

export function listProjectCrawls(database: DatabaseSync, projectId: string): CrawlRun[] | null {
  if (!findProject(database, projectId)) {
    return null;
  }
  return listCrawlRuns(database, projectId);
}

export function getProjectCrawl(database: DatabaseSync, projectId: string, runId: string): CrawlRun | null {
  const run = findCrawlRun(database, runId);
  if (!run || run.projectId !== projectId) {
    return null;
  }
  return run;
}

export function summarizeProjectCrawl(database: DatabaseSync, projectId: string, runId: string): CrawlSummary | null {
  const run = getProjectCrawl(database, projectId, runId);
  return run ? getCrawlSummary(database, run) : null;
}

export function listProjectCrawlPages(
  database: DatabaseSync,
  projectId: string,
  runId: string,
  filter: { query?: string; status?: CrawlPageStatus },
): CrawlPageSummary[] | null {
  if (!getProjectCrawl(database, projectId, runId)) {
    return null;
  }
  return listCrawlPages(database, runId, filter);
}

export function getProjectCrawlPage(
  database: DatabaseSync,
  projectId: string,
  runId: string,
  pageId: string,
): CrawlPageDetail | null {
  if (!getProjectCrawl(database, projectId, runId)) {
    return null;
  }
  return getCrawlPage(database, runId, pageId, projectId);
}

export function readCrawlImage(
  database: DatabaseSync,
  projectId: string,
  runId: string,
  imageId: string,
): { filePath: string; contentType: string } | null {
  if (!getProjectCrawl(database, projectId, runId)) {
    return null;
  }
  const image = findStoredImage(database, runId, imageId);
  if (!image || !image.contentType.startsWith('image/')) {
    return null;
  }
  const filePath = storedFilePath(crawlRunDirectory(crawlRuntime().storageRoot, projectId, runId), 'images', image.storedName);
  return { filePath, contentType: image.contentType };
}

export function cancelProjectCrawl(database: DatabaseSync, projectId: string, runId: string): CrawlRun | null {
  const run = getProjectCrawl(database, projectId, runId);
  if (!run) {
    return null;
  }
  if (run.status !== 'queued' && run.status !== 'running') {
    throw new CrawlNotActiveError();
  }
  controllers.get(runId)?.abort();
  const now = new Date().toISOString();
  const claimed = markCrawlCancelled(database, runId, now);
  if (claimed) {
    resetCollectStageIfRunning(database, projectId, now);
    insertEvent(database, {
      id: randomUUID(),
      projectId,
      eventType: PROJECT_EVENT_TYPES.crawlCancelled,
      message: 'Сбор отменён. Уже сохранённые страницы остались в истории запуска.',
      createdAt: now,
    });
  }
  return findCrawlRun(database, runId);
}

export function recoverInterruptedCrawls(database: DatabaseSync): number {
  const runs = listInterruptedCrawlRuns(database);
  const now = new Date().toISOString();
  let recovered = 0;
  for (const run of runs) {
    if (!failInterruptedRun(database, run.id, now, RESTART_MESSAGE)) {
      continue;
    }
    recovered += 1;
    const collect = listStages(database, run.projectId).find((stage) => stage.stageKey === 'collect');
    if (collect?.status === 'in_progress') {
      applyProjectStage(
        database,
        run.projectId,
        'collect',
        {
          status: 'error',
          startedAt: collect.startedAt,
          completedAt: null,
          errorMessage: RESTART_MESSAGE,
        },
        'error',
        now,
      );
    }
    insertEvent(database, {
      id: randomUUID(),
      projectId: run.projectId,
      eventType: PROJECT_EVENT_TYPES.crawlFailed,
      message: RESTART_MESSAGE,
      createdAt: now,
    });
  }
  return recovered;
}

async function runCrawl(
  database: DatabaseSync,
  projectId: string,
  runId: string,
  signal: AbortSignal,
  fetcher: ReturnType<typeof crawlRuntime>['fetcher'],
  storageRoot: string,
  delayMs: number,
): Promise<void> {
  try {
    const result = await executeCrawl({ database, fetcher, storageRoot, runId, signal, delayMs });
    const now = new Date().toISOString();
    if (result.kind === 'cancelled') {
      if (result.claimed) {
        resetCollectStageIfRunning(database, projectId, now);
        insertEvent(database, {
          id: randomUUID(),
          projectId,
          eventType: PROJECT_EVENT_TYPES.crawlCancelled,
          message: 'Сбор отменён. Уже сохранённые страницы остались в истории запуска.',
          createdAt: now,
        });
      }
      return;
    }

    const run = findCrawlRun(database, runId);
    const collect = listStages(database, projectId).find((stage) => stage.stageKey === 'collect');
    const startedAt = collect?.startedAt ?? run?.startedAt ?? now;
    if (result.status === 'completed') {
      const processed = run?.pagesProcessed ?? 0;
      applyProjectStage(
        database,
        projectId,
        'collect',
        { status: 'completed', startedAt, completedAt: now, errorMessage: null },
        'awaiting_review',
        now,
      );
      insertEvent(database, {
        id: randomUUID(),
        projectId,
        eventType: PROJECT_EVENT_TYPES.crawlFinished,
        message: `Сбор завершён: собрано страниц — ${processed}. Анализ и паспорт сайта не подключены, следующий этап не запускался.`,
        createdAt: now,
      });
      return;
    }

    const message = result.message ?? 'Сбор завершился с ошибками';
    applyProjectStage(
      database,
      projectId,
      'collect',
      { status: 'error', startedAt, completedAt: null, errorMessage: message },
      'error',
      now,
    );
    insertEvent(database, {
      id: randomUUID(),
      projectId,
      eventType: result.status === 'failed' ? PROJECT_EVENT_TYPES.crawlFailed : PROJECT_EVENT_TYPES.crawlFinished,
      message: message,
      createdAt: now,
    });
  } catch (error) {
    console.error('Сбор остановился с внутренней ошибкой', error);
    const now = new Date().toISOString();
    const message = 'Сбор остановился из-за внутренней ошибки. Повторите запуск.';
    const run = findCrawlRun(database, runId);
    if (run && (run.status === 'queued' || run.status === 'running')) {
      failInterruptedRun(database, runId, now, message);
    }
    const collect = listStages(database, projectId).find((stage) => stage.stageKey === 'collect');
    if (collect?.status === 'in_progress') {
      applyProjectStage(
        database,
        projectId,
        'collect',
        { status: 'error', startedAt: collect.startedAt, completedAt: null, errorMessage: message },
        'error',
        now,
      );
    }
    insertEvent(database, {
      id: randomUUID(),
      projectId,
      eventType: PROJECT_EVENT_TYPES.crawlFailed,
      message,
      createdAt: now,
    });
  }
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && /UNIQUE/u.test(error.message);
}
