import { readFileSync } from 'node:fs';
import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { SEARCH_MAX_LENGTH, isCrawlPageStatus } from '../../../../shared/src/index';
import {
  CrawlConflictError,
  CrawlNotActiveError,
  cancelProjectCrawl,
  getProjectCrawl,
  getProjectCrawlPage,
  listProjectCrawlPages,
  listProjectCrawls,
  readCrawlImage,
  startProjectCrawl,
  summarizeProjectCrawl,
} from '../../crawl/service';
import { HttpError, asyncHandler } from '../errors';

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireId(value: unknown): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new HttpError(404, 'NOT_FOUND', 'Запись не найдена');
  }
  return value;
}

function readQuery(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value) || typeof value !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Проверьте параметры запроса', [
      { field, message: 'Ожидалась одна строка' },
    ]);
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function createCrawlRouter(database: DatabaseSync): Router {
  const router = Router({ mergeParams: true });

  router.post(
    '/',
    asyncHandler(async (request, response) => {
      const projectId = requireId(request.params.id);
      try {
        const run = startProjectCrawl(database, projectId);
        response.status(202).json({ data: run });
      } catch (error) {
        if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') {
          throw new HttpError(404, 'NOT_FOUND', 'Проект не найден');
        }
        if (error instanceof CrawlConflictError) {
          throw new HttpError(409, error.code, error.message);
        }
        throw error;
      }
    }),
  );

  router.get(
    '/',
    asyncHandler(async (request, response) => {
      const projectId = requireId(request.params.id);
      const runs = listProjectCrawls(database, projectId);
      if (!runs) {
        throw new HttpError(404, 'NOT_FOUND', 'Проект не найден');
      }
      response.json({ data: runs });
    }),
  );

  router.get(
    '/:runId',
    asyncHandler(async (request, response) => {
      const run = getProjectCrawl(database, requireId(request.params.id), requireId(request.params.runId));
      if (!run) {
        throw new HttpError(404, 'NOT_FOUND', 'Запуск не найден');
      }
      response.json({ data: run });
    }),
  );

  router.get(
    '/:runId/summary',
    asyncHandler(async (request, response) => {
      const summary = summarizeProjectCrawl(database, requireId(request.params.id), requireId(request.params.runId));
      if (!summary) {
        throw new HttpError(404, 'NOT_FOUND', 'Запуск не найден');
      }
      response.json({ data: summary });
    }),
  );

  router.get(
    '/:runId/pages',
    asyncHandler(async (request, response) => {
      const projectId = requireId(request.params.id);
      const runId = requireId(request.params.runId);
      const query = readQuery(request.query.q, 'q');
      if (query && query.length > SEARCH_MAX_LENGTH) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Проверьте параметры запроса', [
          { field: 'q', message: `Поиск не длиннее ${SEARCH_MAX_LENGTH} символов` },
        ]);
      }
      const statusText = readQuery(request.query.status, 'status');
      if (statusText && !isCrawlPageStatus(statusText)) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Проверьте параметры запроса', [
          { field: 'status', message: 'Неизвестный статус страницы' },
        ]);
      }
      const pages = listProjectCrawlPages(database, projectId, runId, {
        ...(query ? { query } : {}),
        ...(statusText && isCrawlPageStatus(statusText) ? { status: statusText } : {}),
      });
      if (!pages) {
        throw new HttpError(404, 'NOT_FOUND', 'Запуск не найден');
      }
      response.json({ data: pages });
    }),
  );

  router.get(
    '/:runId/pages/:pageId',
    asyncHandler(async (request, response) => {
      const page = getProjectCrawlPage(
        database,
        requireId(request.params.id),
        requireId(request.params.runId),
        requireId(request.params.pageId),
      );
      if (!page) {
        throw new HttpError(404, 'NOT_FOUND', 'Страница не найдена');
      }
      response.json({ data: page });
    }),
  );

  router.get(
    '/:runId/images/:imageId',
    asyncHandler(async (request, response) => {
      const image = readCrawlImage(
        database,
        requireId(request.params.id),
        requireId(request.params.runId),
        requireId(request.params.imageId),
      );
      if (!image) {
        throw new HttpError(404, 'NOT_FOUND', 'Изображение не найдено');
      }
      let body: Buffer;
      try {
        body = readFileSync(image.filePath);
      } catch {
        throw new HttpError(404, 'NOT_FOUND', 'Изображение не найдено');
      }
      response.setHeader('Content-Type', image.contentType);
      response.setHeader('Content-Length', String(body.length));
      response.setHeader('Cache-Control', 'private, max-age=3600');
      response.send(body);
    }),
  );

  router.post(
    '/:runId/cancel',
    asyncHandler(async (request, response) => {
      try {
        const run = cancelProjectCrawl(database, requireId(request.params.id), requireId(request.params.runId));
        if (!run) {
          throw new HttpError(404, 'NOT_FOUND', 'Запуск не найден');
        }
        response.json({ data: run });
      } catch (error) {
        if (error instanceof CrawlNotActiveError) {
          throw new HttpError(409, error.code, error.message);
        }
        throw error;
      }
    }),
  );

  return router;
}
