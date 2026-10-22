import {
  NAME_MAX_LENGTH,
  PROJECT_MODES,
  TEXT_MAX_LENGTH,
  isProjectMode,
  type ProjectMode,
} from './constants';
import { normalizeSourceDomain } from './domain';

export interface FieldError {
  field: string;
  message: string;
}

export interface ProjectInput {
  name: string;
  sourceDomain: string;
  brief: string;
  requirements: string | null;
  mode: ProjectMode;
}

export type ProjectPatch = Partial<ProjectInput>;

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: FieldError[] };

const CREATE_FIELDS = ['name', 'sourceDomain', 'brief', 'requirements', 'mode'] as const;
const PATCH_FIELDS = CREATE_FIELDS;
const FORBIDDEN_FIELDS = ['id', 'status', 'currentStage', 'progress', 'createdAt', 'updatedAt'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pushUnknownFields(
  input: Record<string, unknown>,
  allowed: readonly string[],
  errors: FieldError[],
): void {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      const message = FORBIDDEN_FIELDS.includes(key)
        ? 'Это поле нельзя изменить через запрос проекта'
        : 'Неизвестное поле';
      errors.push({ field: key, message });
    }
  }
}

function readRequiredText(
  value: unknown,
  field: string,
  emptyMessage: string,
  maxLength: number,
  errors: FieldError[],
): string | undefined {
  if (typeof value !== 'string') {
    errors.push({ field, message: emptyMessage });
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    errors.push({ field, message: emptyMessage });
    return undefined;
  }
  if (trimmed.length > maxLength) {
    errors.push({ field, message: `Не длиннее ${maxLength} символов` });
    return undefined;
  }
  return trimmed;
}

function readOptionalText(
  value: unknown,
  field: string,
  maxLength: number,
  errors: FieldError[],
  present: boolean,
): string | null | undefined {
  if (!present) {
    return null;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    errors.push({ field, message: 'Ожидался текст' });
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > maxLength) {
    errors.push({ field, message: `Не длиннее ${maxLength} символов` });
    return undefined;
  }
  return trimmed;
}

function readMode(value: unknown, errors: FieldError[]): ProjectMode | undefined {
  if (!isProjectMode(value)) {
    errors.push({
      field: 'mode',
      message: 'Выберите режим: «Автопилот» или «Согласование этапов»',
    });
    return undefined;
  }
  return value;
}

export function validateProjectInput(input: unknown): ValidationResult<ProjectInput> {
  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ field: 'form', message: 'Ожидался объект с полями проекта' }] };
  }

  const errors: FieldError[] = [];
  pushUnknownFields(input, CREATE_FIELDS, errors);

  const name = readRequiredText(input.name, 'name', 'Укажите название проекта', NAME_MAX_LENGTH, errors);
  const brief = readRequiredText(
    input.brief,
    'brief',
    'Опишите краткое техническое задание',
    TEXT_MAX_LENGTH,
    errors,
  );
  const requirements = readOptionalText(
    input.requirements,
    'requirements',
    TEXT_MAX_LENGTH,
    errors,
    Object.prototype.hasOwnProperty.call(input, 'requirements'),
  );
  const mode = readMode(input.mode, errors);

  let sourceDomain: string | undefined;
  if (typeof input.sourceDomain !== 'string') {
    errors.push({ field: 'sourceDomain', message: 'Укажите домен исходного сайта' });
  } else {
    const normalized = normalizeSourceDomain(input.sourceDomain);
    if (!normalized.ok) {
      errors.push({ field: 'sourceDomain', message: normalized.message });
    } else {
      sourceDomain = normalized.domain;
    }
  }

  if (
    errors.length > 0 ||
    name === undefined ||
    brief === undefined ||
    sourceDomain === undefined ||
    mode === undefined ||
    requirements === undefined
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: { name, sourceDomain, brief, requirements, mode },
  };
}

export function validateProjectPatch(input: unknown): ValidationResult<ProjectPatch> {
  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ field: 'form', message: 'Ожидался объект с полями проекта' }] };
  }

  const errors: FieldError[] = [];
  pushUnknownFields(input, PATCH_FIELDS, errors);

  const present = CREATE_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(input, field));
  if (present.length === 0 && errors.length === 0) {
    errors.push({ field: 'form', message: 'Укажите хотя бы одно поле для изменения' });
  }

  const value: ProjectPatch = {};

  if (Object.prototype.hasOwnProperty.call(input, 'name')) {
    const name = readRequiredText(input.name, 'name', 'Укажите название проекта', NAME_MAX_LENGTH, errors);
    if (name !== undefined) {
      value.name = name;
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, 'brief')) {
    const brief = readRequiredText(
      input.brief,
      'brief',
      'Опишите краткое техническое задание',
      TEXT_MAX_LENGTH,
      errors,
    );
    if (brief !== undefined) {
      value.brief = brief;
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, 'requirements')) {
    const requirements = readOptionalText(input.requirements, 'requirements', TEXT_MAX_LENGTH, errors, true);
    if (requirements !== undefined) {
      value.requirements = requirements;
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, 'mode')) {
    const mode = readMode(input.mode, errors);
    if (mode !== undefined) {
      value.mode = mode;
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, 'sourceDomain')) {
    if (typeof input.sourceDomain !== 'string') {
      errors.push({ field: 'sourceDomain', message: 'Укажите домен исходного сайта' });
    } else {
      const normalized = normalizeSourceDomain(input.sourceDomain);
      if (!normalized.ok) {
        errors.push({ field: 'sourceDomain', message: normalized.message });
      } else {
        value.sourceDomain = normalized.domain;
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value };
}

export const PROJECT_MODE_OPTIONS = PROJECT_MODES;
