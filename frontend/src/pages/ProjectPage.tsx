import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiRequestError, deleteProject, getProject, updateProject } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorBanner } from '../components/ErrorBanner';
import { EventList } from '../components/EventList';
import { LoadingState } from '../components/LoadingState';
import { PageHeader } from '../components/PageHeader';
import { ProgressBar } from '../components/ProgressBar';
import { ProjectForm } from '../components/ProjectForm';
import { StageList } from '../components/StageList';
import { StatusBadge } from '../components/StatusBadge';
import { formatDateTime } from '../format';
import { PROJECT_MODE_LABELS, stageDefinition, type FieldError, type ProjectDetail, type ProjectInput } from '../shared';

export function ProjectPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldError[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    document.title = detail ? `${detail.project.name} — AI Site Factory` : 'Проект — AI Site Factory';
  }, [detail]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    getProject(projectId, controller.signal)
      .then((result) => {
        setDetail(result);
        setError(null);
        setNotFound(false);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') {
          return;
        }
        if (caught instanceof ApiRequestError && caught.status === 404) {
          setNotFound(true);
          setDetail(null);
          return;
        }
        setError(caught instanceof ApiRequestError ? caught.message : 'Не удалось загрузить проект');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [projectId, reloadKey]);

  async function handleSave(value: ProjectInput) {
    if (!detail) {
      return;
    }
    setPending(true);
    setServerErrors([]);
    setFormError(null);
    try {
      const updated = await updateProject(detail.project.id, value);
      setDetail(updated);
      setEditing(false);
      setNotice('Изменения сохранены');
    } catch (caught) {
      if (caught instanceof ApiRequestError) {
        setServerErrors(caught.details);
        setFormError(caught.details.length > 0 ? null : caught.message);
      } else {
        setFormError('Не удалось сохранить изменения');
      }
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    if (!detail) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await deleteProject(detail.project.id);
      navigate('/');
    } catch (caught) {
      setConfirmDelete(false);
      setError(caught instanceof ApiRequestError ? caught.message : 'Не удалось удалить проект');
      setDeleting(false);
    }
  }

  if (loading) {
    return <LoadingState label="Загрузка проекта…" />;
  }
  if (notFound) {
    return (
      <PageHeader
        title="Проект не найден"
        description="Возможно, запись уже удалена."
        backTo="/"
        backLabel="К проектам"
      />
    );
  }
  if (!detail) {
    return error ? <ErrorBanner message={error} onRetry={() => setReloadKey((value) => value + 1)} /> : null;
  }

  const { project, stages, events } = detail;
  const stageTitle = stageDefinition(project.currentStage).title;

  return (
    <>
      <PageHeader
        title={project.name}
        description={project.sourceDomain}
        backTo="/"
        backLabel="К проектам"
        actions={
          <>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                setNotice(null);
                setEditing((value) => !value);
                setServerErrors([]);
                setFormError(null);
              }}
            >
              {editing ? 'Закрыть форму' : 'Изменить'}
            </button>
            <button type="button" className="button button-danger" onClick={() => setConfirmDelete(true)}>
              Удалить
            </button>
          </>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}
      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}

      {editing ? (
        <section className="panel form-panel">
          <h2>Параметры проекта</h2>
          <ProjectForm
            key={`${project.id}-${project.updatedAt}`}
            initial={project}
            submitLabel="Сохранить"
            pendingLabel="Сохранение…"
            pending={pending}
            serverErrors={serverErrors}
            formError={formError}
            onSubmit={handleSave}
            onCancel={() => setEditing(false)}
          />
        </section>
      ) : null}

      <div className="project-layout">
        <section className="panel stack">
          <div className="meta-row">
            <StatusBadge status={project.status} />
            <span className="meta-chip">{PROJECT_MODE_LABELS[project.mode]}</span>
          </div>
          <div>
            <h2>Прогресс</h2>
            <ProgressBar value={project.progress} />
            <p className="muted">Текущий этап: {stageTitle}</p>
          </div>
          <div>
            <h2>Краткое техническое задание</h2>
            <p className="prose">{project.brief}</p>
          </div>
          <div>
            <h2>Особые требования</h2>
            <p className="prose">{project.requirements ?? 'Не указаны'}</p>
          </div>
          <dl className="facts">
            <div>
              <dt>Создан</dt>
              <dd>
                <time dateTime={project.createdAt}>{formatDateTime(project.createdAt)}</time>
              </dd>
            </div>
            <div>
              <dt>Обновлён</dt>
              <dd>
                <time dateTime={project.updatedAt}>{formatDateTime(project.updatedAt)}</time>
              </dd>
            </div>
            <div>
              <dt>Исходный сайт</dt>
              <dd>
                <a href={`https://${project.sourceDomain}`} target="_blank" rel="noreferrer noopener">
                  https://{project.sourceDomain}
                </a>
              </dd>
            </div>
          </dl>
        </section>

        <section className="panel stack">
          <h2>Этапы</h2>
          <StageList stages={stages} />
          <p className="note">
            Автоматический запуск пока недоступен. Сервисы сбора, анализа, дизайна, разработки, тестирования и
            публикации не подключены, поэтому этапы остаются в сохранённом статусе «Ожидает».
          </p>
        </section>
      </div>

      <section className="panel stack history">
        <h2>История</h2>
        <EventList events={events} />
      </section>

      <ConfirmDialog
        open={confirmDelete}
        title="Удалить проект?"
        description={`Проект «${project.name}», его этапы и история будут удалены без возможности восстановления.`}
        confirmLabel="Удалить проект"
        pending={deleting}
        onConfirm={handleDelete}
        onClose={() => {
          if (!deleting) {
            setConfirmDelete(false);
          }
        }}
      />
    </>
  );
}
