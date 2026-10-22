export {
  AUTOMATION_SERVICE_IDS,
  INTEGRATION_STATE_LABELS,
  INTEGRATION_STATES,
  NAME_MAX_LENGTH,
  PLATFORM_VERSION,
  PROJECT_EVENT_TYPES,
  PROJECT_MODE_LABELS,
  PROJECT_MODES,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  SEARCH_MAX_LENGTH,
  STAGE_CATALOG,
  STAGE_KEYS,
  STAGE_STATUSES,
  STAGE_STATUS_LABELS,
  TEXT_MAX_LENGTH,
  isProjectMode,
  isProjectStatus,
  isStageKey,
  isStageStatus,
  stageDefinition,
} from './constants';
export type {
  AutomationServiceId,
  IntegrationState,
  ProjectEventType,
  ProjectMode,
  ProjectStatus,
  StageDefinition,
  StageKey,
  StageStatus,
} from './constants';
export { foldSearchText, normalizeSourceDomain } from './domain';
export type { DomainResult } from './domain';
export { deriveCurrentStage, deriveProgress } from './progress';
export type { StageProgressInput } from './progress';
export type {
  ApiErrorBody,
  HealthReport,
  IntegrationStatus,
  Project,
  ProjectDetail,
  ProjectEvent,
  ProjectList,
  ProjectStage,
  ProjectSummary,
} from './types';
export { PROJECT_MODE_OPTIONS, validateProjectInput, validateProjectPatch } from './validation';
export type { FieldError, ProjectInput, ProjectPatch, ValidationResult } from './validation';
