import type { DatabaseSync } from 'node:sqlite';
import type { StageKey } from '../../../shared/src/index';
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
 *
 * Сейчас функция всегда завершается ошибкой и не меняет проект: реальных
 * обработчиков нет, и подменять их демонстрационным результатом нельзя.
 *
 * Будущий контракт, когда появится реализация сервиса:
 * 1. Убедиться, что проект и этап существуют, а этап ещё не выполняется.
 * 2. В одной транзакции поставить этапу статус in_progress, пересчитать
 *    progress и currentStage и записать событие в историю.
 * 3. Запланировать работу вне HTTP-запроса (setImmediate, worker_threads
 *    или отдельная очередь) и сразу вернуть идентификатор задачи.
 * 4. Маршрут отвечает 202 Accepted и не ждёт сбор, анализ или генерацию.
 * 5. Фоновая работа по завершении сама пишет статус этапа, ошибку или
 *    результат и новую запись истории.
 *
 * Подключение сервиса: реализовать обработчик в backend/src/automation/handlers,
 * зарегистрировать его в registry.ts и вызывать отсюда только после записи
 * статуса. Пока регистра обработчиков намеренно нет.
 */
export function startStage(_database: DatabaseSync, _projectId: string, stageKey: StageKey): never {
  const service = serviceForStage(stageKey);
  throw new AutomationNotReadyError(stageKey, service.id);
}
