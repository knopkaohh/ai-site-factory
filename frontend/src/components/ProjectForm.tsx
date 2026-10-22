import { useMemo, useState, type FormEvent } from 'react';
import {
  NAME_MAX_LENGTH,
  PROJECT_MODE_LABELS,
  TEXT_MAX_LENGTH,
  normalizeSourceDomain,
  validateProjectInput,
  type FieldError,
  type ProjectInput,
  type ProjectMode,
} from '../shared';

interface FormState {
  name: string;
  sourceDomain: string;
  brief: string;
  requirements: string;
  mode: ProjectMode | '';
}

const MODE_HINTS: Record<ProjectMode, string> = {
  autopilot: 'После подключения автоматизации этапы выполняются без остановок на согласование.',
  stage_approval: 'После подключения автоматизации система останавливается на контрольных точках.',
};

function errorFor(errors: FieldError[], field: string): string | undefined {
  return errors.find((error) => error.field === field)?.message;
}

export function ProjectForm({
  initial,
  submitLabel,
  pendingLabel,
  pending,
  serverErrors,
  formError,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<ProjectInput>;
  submitLabel: string;
  pendingLabel: string;
  pending: boolean;
  serverErrors: FieldError[];
  formError: string | null;
  onSubmit: (value: ProjectInput) => void;
  onCancel?: () => void;
}) {
  const [state, setState] = useState<FormState>({
    name: initial?.name ?? '',
    sourceDomain: initial?.sourceDomain ?? '',
    brief: initial?.brief ?? '',
    requirements: initial?.requirements ?? '',
    mode: initial?.mode ?? '',
  });
  const [localErrors, setLocalErrors] = useState<FieldError[]>([]);
  const errors = localErrors.length > 0 ? localErrors : serverErrors;
  const normalized = useMemo(() => {
    if (!state.sourceDomain.trim()) {
      return null;
    }
    return normalizeSourceDomain(state.sourceDomain);
  }, [state.sourceDomain]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((current) => ({ ...current, [key]: value }));
    setLocalErrors([]);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = validateProjectInput({
      name: state.name,
      sourceDomain: state.sourceDomain,
      brief: state.brief,
      requirements: state.requirements,
      mode: state.mode,
    });
    if (!parsed.ok) {
      setLocalErrors(parsed.errors);
      return;
    }
    setLocalErrors([]);
    onSubmit(parsed.value);
  }

  const formLevel = errorFor(errors, 'form') ?? formError;

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      {formLevel ? (
        <div className="banner" role="alert">
          <p>{formLevel}</p>
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="project-name">
          Название проекта <span className="required">обязательно</span>
        </label>
        <input
          id="project-name"
          value={state.name}
          maxLength={NAME_MAX_LENGTH}
          autoComplete="off"
          aria-invalid={Boolean(errorFor(errors, 'name'))}
          aria-describedby={errorFor(errors, 'name') ? 'project-name-error' : undefined}
          onChange={(event) => update('name', event.target.value)}
        />
        {errorFor(errors, 'name') ? (
          <p id="project-name-error" className="field-error">
            {errorFor(errors, 'name')}
          </p>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="project-domain">
          Домен исходного сайта <span className="required">обязательно</span>
        </label>
        <input
          id="project-domain"
          inputMode="url"
          autoComplete="url"
          placeholder="example.com"
          value={state.sourceDomain}
          aria-invalid={Boolean(errorFor(errors, 'sourceDomain'))}
          aria-describedby="project-domain-hint"
          onChange={(event) => update('sourceDomain', event.target.value)}
        />
        <p id="project-domain-hint" className="field-hint">
          {normalized?.ok
            ? `Сохранится как ${normalized.domain}. Сайт сейчас не загружается.`
            : 'Можно ввести адрес с протоколом или без него. Путь, порт и параметры не сохраняются.'}
        </p>
        {errorFor(errors, 'sourceDomain') ? <p className="field-error">{errorFor(errors, 'sourceDomain')}</p> : null}
      </div>

      <div className="field">
        <label htmlFor="project-brief">
          Краткое техническое задание <span className="required">обязательно</span>
        </label>
        <textarea
          id="project-brief"
          rows={6}
          maxLength={TEXT_MAX_LENGTH}
          value={state.brief}
          aria-invalid={Boolean(errorFor(errors, 'brief'))}
          onChange={(event) => update('brief', event.target.value)}
        />
        <div className="field-meta">
          {errorFor(errors, 'brief') ? <p className="field-error">{errorFor(errors, 'brief')}</p> : <span />}
          <span className="field-count">
            {state.brief.trim().length}/{TEXT_MAX_LENGTH}
          </span>
        </div>
      </div>

      <div className="field">
        <label htmlFor="project-requirements">Особые требования и ограничения</label>
        <textarea
          id="project-requirements"
          rows={4}
          maxLength={TEXT_MAX_LENGTH}
          value={state.requirements}
          placeholder="Необязательно"
          aria-invalid={Boolean(errorFor(errors, 'requirements'))}
          onChange={(event) => update('requirements', event.target.value)}
        />
        <div className="field-meta">
          {errorFor(errors, 'requirements') ? (
            <p className="field-error">{errorFor(errors, 'requirements')}</p>
          ) : (
            <span />
          )}
          <span className="field-count">
            {state.requirements.trim().length}/{TEXT_MAX_LENGTH}
          </span>
        </div>
      </div>

      <fieldset className="field">
        <legend>
          Режим работы <span className="required">обязательно</span>
        </legend>
        <div className="mode-grid">
          {(Object.keys(PROJECT_MODE_LABELS) as ProjectMode[]).map((mode) => (
            <label key={mode} className={state.mode === mode ? 'mode-card selected' : 'mode-card'}>
              <input
                type="radio"
                name="mode"
                value={mode}
                checked={state.mode === mode}
                onChange={() => update('mode', mode)}
              />
              <span className="mode-title">{PROJECT_MODE_LABELS[mode]}</span>
              <span className="mode-hint">{MODE_HINTS[mode]}</span>
            </label>
          ))}
        </div>
        {errorFor(errors, 'mode') ? <p className="field-error">{errorFor(errors, 'mode')}</p> : null}
      </fieldset>

      <div className="form-actions">
        {onCancel ? (
          <button type="button" className="button button-secondary" onClick={onCancel} disabled={pending}>
            Отмена
          </button>
        ) : null}
        <button type="submit" className="button button-primary" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}
