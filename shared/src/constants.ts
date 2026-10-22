export const PLATFORM_VERSION = '0.1.0';

export const PROJECT_MODES = ['autopilot', 'stage_approval'] as const;
export type ProjectMode = (typeof PROJECT_MODES)[number];

export const PROJECT_STATUSES = [
  'created',
  'in_progress',
  'awaiting_review',
  'demo_ready',
  'published',
  'error',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const STAGE_STATUSES = [
  'pending',
  'in_progress',
  'awaiting_review',
  'completed',
  'error',
] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

export const STAGE_KEYS = [
  'collect',
  'analyze',
  'concept',
  'develop',
  'qa',
  'demo',
  'publish',
] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

export const INTEGRATION_STATES = ['not_connected', 'in_development', 'ok'] as const;
export type IntegrationState = (typeof INTEGRATION_STATES)[number];

export const AUTOMATION_SERVICE_IDS = [
  'crawler',
  'analyzer',
  'designer',
  'developer',
  'qa',
  'publisher',
] as const;
export type AutomationServiceId = (typeof AUTOMATION_SERVICE_IDS)[number];

export interface StageDefinition {
  key: StageKey;
  title: string;
  service: AutomationServiceId;
}

export const STAGE_CATALOG: readonly StageDefinition[] = [
  { key: 'collect', title: 'Сбор исходного сайта', service: 'crawler' },
  { key: 'analyze', title: 'Анализ и паспорт сайта', service: 'analyzer' },
  { key: 'concept', title: 'Концепция редизайна', service: 'designer' },
  { key: 'develop', title: 'Разработка нового сайта', service: 'developer' },
  { key: 'qa', title: 'Тестирование и исправление ошибок', service: 'qa' },
  { key: 'demo', title: 'Подготовка демоверсии', service: 'publisher' },
  { key: 'publish', title: 'Публикация', service: 'publisher' },
];

export const PROJECT_EVENT_TYPES = {
  created: 'project.created',
  updated: 'project.updated',
} as const;
export type ProjectEventType = (typeof PROJECT_EVENT_TYPES)[keyof typeof PROJECT_EVENT_TYPES];

export const PROJECT_MODE_LABELS: Record<ProjectMode, string> = {
  autopilot: 'Автопилот',
  stage_approval: 'Согласование этапов',
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  created: 'Создан',
  in_progress: 'В работе',
  awaiting_review: 'Требует согласования',
  demo_ready: 'Демоверсия готова',
  published: 'Опубликован',
  error: 'Ошибка',
};

export const STAGE_STATUS_LABELS: Record<StageStatus, string> = {
  pending: 'Ожидает',
  in_progress: 'В работе',
  awaiting_review: 'Требует согласования',
  completed: 'Завершён',
  error: 'Ошибка',
};

export const INTEGRATION_STATE_LABELS: Record<IntegrationState, string> = {
  not_connected: 'Не подключено',
  in_development: 'В разработке',
  ok: 'Подключено',
};

export const NAME_MAX_LENGTH = 120;
export const TEXT_MAX_LENGTH = 4000;
export const SEARCH_MAX_LENGTH = 200;

export function isProjectMode(value: unknown): value is ProjectMode {
  return typeof value === 'string' && PROJECT_MODES.includes(value as ProjectMode);
}

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === 'string' && PROJECT_STATUSES.includes(value as ProjectStatus);
}

export function isStageStatus(value: unknown): value is StageStatus {
  return typeof value === 'string' && STAGE_STATUSES.includes(value as StageStatus);
}

export function isStageKey(value: unknown): value is StageKey {
  return typeof value === 'string' && STAGE_KEYS.includes(value as StageKey);
}

export function stageDefinition(key: StageKey): StageDefinition {
  const definition = STAGE_CATALOG.find((item) => item.key === key);
  if (!definition) {
    throw new Error(`Неизвестный этап: ${key}`);
  }
  return definition;
}
