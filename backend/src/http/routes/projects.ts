import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import {
  SEARCH_MAX_LENGTH,
  isProjectStatus,
  validateProjectInput,
  validateProjectPatch,
} from '../../../../shared/src/index';
import {
  createProject,
  getProjectDetail,
  listProjectPage,
  removeProject,
  updateProject,
} from '../../services/projectService';
import { HttpError, asyncHandler } from '../errors';

const PROJECT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readQueryValue(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Проверьте параметры запроса', [
      { field, message: 'Ожидалась одна строка' },
    ]);
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function createProjectRouter(database: DatabaseSync): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (request, response) => {
      const query = readQueryValue(request.query.q, 'q');
      if (query && query.length > SEARCH_MAX_LENGTH) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Проверьте параметры запроса', [
          { field: 'q', message: `Поиск не длиннее ${SEARCH_MAX_LENGTH} символов` },
        ]);
      }
      const statusText = readQueryValue(request.query.status, 'status');
      if (statusText && !isProjectStatus(statusText)) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Проверьте параметры запроса', [
          { field: 'status', message: 'Неизвестный статус проекта' },
        ]);
      }
      response.json({
        data: listProjectPage(database, {
          ...(query ? { query } : {}),
          ...(statusText && isProjectStatus(statusText) ? { status: statusText } : {}),
        }),
      });
    }),
  );

  router.post(
    '/',
    asyncHandler(async (request, response) => {
      const parsed = validateProjectInput(request.body);
      if (!parsed.ok) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Проверьте поля формы', parsed.errors);
      }
      const detail = createProject(database, parsed.value);
      response.status(201).json({ data: detail });
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (request, response) => {
      const id = request.params.id;
      if (typeof id !== 'string' || !PROJECT_ID_PATTERN.test(id)) {
        throw new HttpError(404, 'NOT_FOUND', 'Проект не найден');
      }
      const detail = getProjectDetail(database, id);
      if (!detail) {
        throw new HttpError(404, 'NOT_FOUND', 'Проект не найден');
      }
      response.json({ data: detail });
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (request, response) => {
      const id = request.params.id;
      if (typeof id !== 'string' || !PROJECT_ID_PATTERN.test(id)) {
        throw new HttpError(404, 'NOT_FOUND', 'Проект не найден');
      }
      const parsed = validateProjectPatch(request.body);
      if (!parsed.ok) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Проверьте поля формы', parsed.errors);
      }
      const detail = updateProject(database, id, parsed.value);
      if (!detail) {
        throw new HttpError(404, 'NOT_FOUND', 'Проект не найден');
      }
      response.json({ data: detail });
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (request, response) => {
      const id = request.params.id;
      if (typeof id !== 'string' || !PROJECT_ID_PATTERN.test(id)) {
        throw new HttpError(404, 'NOT_FOUND', 'Проект не найден');
      }
      const removed = removeProject(database, id);
      if (!removed) {
        throw new HttpError(404, 'NOT_FOUND', 'Проект не найден');
      }
      response.status(204).send();
    }),
  );

  return router;
}
