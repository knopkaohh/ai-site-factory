import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiRequestError, listProjects } from '../api/client';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { PageHeader } from '../components/PageHeader';
import { ProgressBar } from '../components/ProgressBar';
import { StatusBadge } from '../components/StatusBadge';
import { formatCompactDateTime, formatDate } from '../format';
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  stageDefinition,
  type Project,
  type ProjectStatus,
  type ProjectSummary,
} from '../shared';

const emptySummary: ProjectSummary = { total: 0, inProgress: 0, demoReady: 0 };

export function ProjectsPage() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<ProjectStatus | ''>('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [summary, setSummary] = useState<ProjectSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    document.title = 'Проекты — AI Site Factory';
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setRefreshing(true);
      listProjects(
        {
          ...(query.trim() ? { query: query.trim() } : {}),
          ...(status ? { status } : {}),
        },
        controller.signal,
      )
        .then((result) => {
          setProjects(result.projects);
          setSummary(result.summary);
          setError(null);
        })
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === 'AbortError') {
            return;
          }
          const message =
            caught instanceof ApiRequestError ? caught.message : 'Не удалось загрузить проекты';
          setError(message);
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoading(false);
            setRefreshing(false);
          }
        });
    }, 200);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, status, reloadKey]);

  const filtered = query.trim().length > 0 || status !== '';

  return (
    <>
      <PageHeader
        title="Проекты"
        description="Рабочая область проектов редизайна."
        actions={
          <Link className="button button-primary" to="/projects/new">
            Создать проект
          </Link>
        }
      />

      {loading ? <LoadingState label="Загрузка проектов…" /> : null}
      {error ? <ErrorBanner message={error} onRetry={() => setReloadKey((value) => value + 1)} /> : null}

      {!loading && !error ? (
        <section className="stats" aria-label="Сводка">
          <article>
            <div className="stat-value">{summary.total}</div>
            <div className="stat-label">Всего проектов</div>
          </article>
          <article>
            <div className="stat-value">{summary.inProgress}</div>
            <div className="stat-label">В работе</div>
          </article>
          <article>
            <div className="stat-value">{summary.demoReady}</div>
            <div className="stat-label">Готовых демоверсий</div>
          </article>
        </section>
      ) : null}

      {!loading && !error ? (
        <div className="toolbar">
          <label className="search">
            <span className="visually-hidden">Поиск по названию и домену</span>
            <input
              value={query}
              placeholder="Поиск по названию или домену"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="filter">
            <span className="visually-hidden">Фильтр по статусу</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus | '')}>
              <option value="">Все статусы</option>
              {PROJECT_STATUSES.map((item) => (
                <option key={item} value={item}>
                  {PROJECT_STATUS_LABELS[item]}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {!loading && !error && projects.length === 0 && !filtered ? (
        <div className="panel">
          <EmptyState
            title="Проектов пока нет"
            description="Создайте первый проект: укажите домен существующего сайта и краткое техническое задание. Сбор страниц на этом шаге не запускается."
            action={
              <Link className="button button-primary" to="/projects/new">
                Создать проект
              </Link>
            }
          />
        </div>
      ) : null}

      {!loading && !error && projects.length === 0 && filtered ? (
        <div className="panel">
          <EmptyState
            title="Ничего не найдено"
            description="Нет проектов с таким названием, доменом или статусом."
            action={
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  setQuery('');
                  setStatus('');
                }}
              >
                Сбросить фильтры
              </button>
            }
          />
        </div>
      ) : null}

      {!loading && projects.length > 0 ? (
        <section className="panel" aria-busy={refreshing}>
          <div className="list-meta">
            {filtered ? <span>Найдено: {projects.length}</span> : <span>Список проектов</span>}
            {refreshing ? <span>Обновление…</span> : null}
          </div>
          <div className="project-row project-row-head">
            <span>Проект</span>
            <span>Этап</span>
            <span>Статус</span>
            <span>Прогресс</span>
            <span>Обновление</span>
          </div>
          {projects.map((project) => (
            <Link key={project.id} className="project-row" to={`/projects/${project.id}`}>
              <span>
                <span className="cell-label">Проект</span>
                <span className="project-name">{project.name}</span>
                <span className="project-domain">{project.sourceDomain}</span>
                <span className="project-created">Создан {formatDate(project.createdAt)}</span>
              </span>
              <span>
                <span className="cell-label">Этап</span>
                <span>{stageDefinition(project.currentStage).title}</span>
              </span>
              <span>
                <span className="cell-label">Статус</span>
                <StatusBadge status={project.status} />
              </span>
              <span>
                <span className="cell-label">Прогресс</span>
                <ProgressBar value={project.progress} />
              </span>
              <span>
                <span className="cell-label">Обновление</span>
                <time dateTime={project.updatedAt}>{formatCompactDateTime(project.updatedAt)}</time>
              </span>
            </Link>
          ))}
        </section>
      ) : null}
    </>
  );
}
