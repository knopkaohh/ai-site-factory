import type { StageKey, StageStatus } from './constants';

export interface StageProgressInput {
  stageKey: StageKey;
  status: StageStatus;
  position: number;
}

/** Доля завершённых этапов. Этап «В работе» не считается выполненным. */
export function deriveProgress(stages: readonly { status: StageStatus }[]): number {
  if (stages.length === 0) {
    return 0;
  }
  const completed = stages.filter((stage) => stage.status === 'completed').length;
  return Math.round((completed / stages.length) * 100);
}

/** Первый этап, который ещё не завершён. Если завершены все — последний. */
export function deriveCurrentStage(stages: readonly StageProgressInput[]): StageKey {
  const ordered = [...stages].sort((left, right) => left.position - right.position);
  const active = ordered.find((stage) => stage.status !== 'completed');
  return active?.stageKey ?? ordered.at(-1)?.stageKey ?? 'collect';
}
