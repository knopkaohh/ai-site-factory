import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { validateCrawlSettingsPatch } from '../../../../shared/src/index';
import { changeCrawlPageLimit, readCrawlSettings } from '../../crawl/service';
import { HttpError, asyncHandler } from '../errors';

export function createSettingsRouter(database: DatabaseSync): Router {
  const router = Router();

  router.get(
    '/crawl',
    asyncHandler(async (_request, response) => {
      response.json({ data: readCrawlSettings(database) });
    }),
  );

  router.patch(
    '/crawl',
    asyncHandler(async (request, response) => {
      const parsed = validateCrawlSettingsPatch(request.body);
      if (!parsed.ok) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Проверьте настройки сбора', parsed.errors);
      }
      response.json({ data: changeCrawlPageLimit(database, parsed.value.pageLimit) });
    }),
  );

  return router;
}
