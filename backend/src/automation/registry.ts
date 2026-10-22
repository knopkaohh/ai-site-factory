import { STAGE_KEYS, type IntegrationStatus, type StageKey } from '../../../shared/src/index';

export interface AutomationServiceDescriptor extends IntegrationStatus {
  stageKeys: readonly StageKey[];
}

/**
 * Каталог будущих сервисов. В первом спринте ни один из них не выполняется:
 * записи описывают границу модуля и честный статус для экрана настроек.
 */
export const AUTOMATION_CATALOG: readonly AutomationServiceDescriptor[] = [
  {
    id: 'crawler',
    title: 'Сбор исходного сайта',
    state: 'in_development',
    detail: 'Модуль не подключён. Страницы, тексты и изображения исходного сайта не собираются.',
    stageKeys: ['collect'],
  },
  {
    id: 'analyzer',
    title: 'Анализ и паспорт сайта',
    state: 'in_development',
    detail: 'Модуль не подключён. Паспорт бизнеса и структура сайта не формируются.',
    stageKeys: ['analyze'],
  },
  {
    id: 'designer',
    title: 'Концепция и дизайн-система',
    state: 'in_development',
    detail: 'Модуль не подключён. Концепция редизайна не создаётся.',
    stageKeys: ['concept'],
  },
  {
    id: 'developer',
    title: 'Генерация сайта',
    state: 'in_development',
    detail: 'Модуль не подключён. Код нового сайта не генерируется.',
    stageKeys: ['develop'],
  },
  {
    id: 'qa',
    title: 'Тестирование и исправления',
    state: 'in_development',
    detail: 'Модуль не подключён. Автоматические проверки и правки не выполняются.',
    stageKeys: ['qa'],
  },
  {
    id: 'publisher',
    title: 'Демоверсия и публикация',
    state: 'in_development',
    detail: 'Модуль не подключён. Демоверсия не готовится и сайт не публикуется.',
    stageKeys: ['demo', 'publish'],
  },
  {
    id: 'llm',
    title: 'ИИ-модели',
    state: 'not_connected',
    detail: 'Провайдеры моделей и ключи доступа не настроены.',
    stageKeys: [],
  },
  {
    id: 'external_api',
    title: 'Внешние API',
    state: 'not_connected',
    detail: 'Сторонние API не подключены.',
    stageKeys: [],
  },
];

export function integrationStatuses(): IntegrationStatus[] {
  return AUTOMATION_CATALOG.map(({ id, title, state, detail }) => ({ id, title, state, detail }));
}

export function serviceForStage(stageKey: StageKey): AutomationServiceDescriptor {
  const matches = AUTOMATION_CATALOG.filter((service) => service.stageKeys.includes(stageKey));
  if (matches.length !== 1) {
    throw new Error(`Этап ${stageKey} должен быть связан ровно с одним сервисом`);
  }
  const service = matches[0];
  if (!service) {
    throw new Error(`Этап ${stageKey} не связан с сервисом`);
  }
  return service;
}

export function assertStageCoverage(): void {
  for (const stageKey of STAGE_KEYS) {
    serviceForStage(stageKey);
  }
}
