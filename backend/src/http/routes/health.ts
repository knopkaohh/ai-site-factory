import type { DatabaseSync } from 'node:sqlite';
import type { Request, Response } from 'express';
import type { HealthReport } from '../../../../shared/src/index';
import { integrationStatuses } from '../../automation/registry';

export function readHealth(database: DatabaseSync, version: string, databaseLocation: string): HealthReport {
  const checkedAt = new Date().toISOString();
  try {
    const row = database.prepare('SELECT 1 AS ok').get() as { ok?: number } | undefined;
    if (Number(row?.ok) !== 1) {
      throw new Error('empty');
    }
    return {
      status: 'ok',
      version,
      time: checkedAt,
      database: { status: 'ok', engine: 'sqlite', location: databaseLocation },
      integrations: integrationStatuses(),
    };
  } catch (error) {
    console.error('Проверка базы данных не удалась', error);
    return {
      status: 'degraded',
      version,
      time: checkedAt,
      database: {
        status: 'error',
        engine: 'sqlite',
        location: databaseLocation,
        message: 'База данных недоступна',
      },
      integrations: integrationStatuses(),
    };
  }
}

export function healthHandler(
  database: DatabaseSync,
  version: string,
  databaseLocation: string,
  _request: Request,
  response: Response,
): void {
  const report = readHealth(database, version, databaseLocation);
  response.status(report.status === 'ok' ? 200 : 503).json({ data: report });
}
