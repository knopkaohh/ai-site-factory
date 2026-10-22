import type { DatabaseSync } from 'node:sqlite';
import type { StageKey } from '../../../shared/src/index';
import { startProjectCrawl } from '../crawl/service';
import { serviceForStage } from './registry';

export class AutomationNotReadyError extends Error {
  readonly code = 'AUTOMATION_NOT_READY';
  readonly stageKey: StageKey;
  readonly serviceId: string;

  constructor(stageKey: StageKey, serviceId: string) {
    super(`Сервис «${serviceId}» для этапа «${stageKey}» ещё не подключён`);
    this.name = 'AutomationNotReadyError';
    this.stageKey = stageKey;
    this.serviceId = serviceId;
  }
}

/**
 * Запуск этапа автоматизации.
 * Сбор исходного сайта ставится в фон и возвращает идентификатор запуска.
 * Остальные этапы по-прежнему не подключены и не меняют проект.
 */
export function startStage(database: DatabaseSync, projectId: string, stageKey: StageKey): { runId: string } {
  if (stageKey !== 'collect') {
    const service = serviceForStage(stageKey);
    throw new AutomationNotReadyError(stageKey, service.id);
  }
  try {
    const run = startProjectCrawl(database, projectId);
    return { runId: run.id };
  } catch (error) {
    if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') {
      throw new AutomationNotReadyError(stageKey, 'crawler');
    }
    throw error;
  }
}
