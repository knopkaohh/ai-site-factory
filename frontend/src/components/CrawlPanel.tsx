import { useEffect, useState } from 'react';
import {
  ApiRequestError,
  cancelCrawl,
  getCrawl,
  getCrawlPage,
  getCrawlSummary,
  listCrawlPages,
  listCrawls,
  startCrawl,
} from '../api/client';
import { formatDateTime } from '../format';
import {
  CRAWL_PAGE_STATUSES,
  CRAWL_PAGE_STATUS_LABELS,
  CRAWL_RUN_STATUS_LABELS,
  type CrawlPageDetail,
  type CrawlPageStatus,
  type CrawlPageSummary,
  type CrawlRun,
  type CrawlSummary,
} from '../shared';

const ACTIVE = new Set(['queued', 'running']);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function CrawlPanel({
  projectId,
  sourceUrl,
  onChanged,
}: {
  projectId: string;
  sourceUrl: string;
  onChanged: () => void;
}) {
  const [runs, setRuns] = useState<CrawlRun[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [pages, setPages] = useState<CrawlPageSummary[]>([]);
  const [summary, setSummary] = useState<CrawlSummary | null>(null);
  const [page, setPage] = useState<CrawlPageDetail | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<CrawlPageStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = runs.find((item) => item.id === runId) ?? null;
  const active = run ? ACTIVE.has(run.status) : false;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    listCrawls(projectId, controller.signal)
      .then((items) => {
        setRuns(items);
        setRunId((current) => current ?? items[0]?.id ?? null);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') {
          return;
        }
        setError(caught instanceof ApiRequestError ? caught.message : 'Не удалось загрузить запуски сбора');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [projectId]);

  useEffect(() => {
    if (!runId) {
      setPages([]);
      setSummary(null);
      setPage(null);
      return;
    }
    const controller = new AbortController();
    Promise.all([
      listCrawlPages(projectId, runId, { ...(query ? { query } : {}), ...(status ? { status } : {}) }, controller.signal),
      getCrawlSummary(projectId, runId, controller.signal),
    ])
      .then(([nextPages, nextSummary]) => {
        setPages(nextPages);
        setSummary(nextSummary);
        setPage((current) => (current && nextPages.some((item) => item.id === current.id) ? current : null));
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') {
          return;
        }
        setError(caught instanceof ApiRequestError ? caught.message : 'Не удалось загрузить страницы');
      });
    return () => controller.abort();
  }, [projectId, runId, query, status, run?.updatedAt]);

  useEffect(() => {
    if (!run || !ACTIVE.has(run.status)) {
      return;
    }
    const controller = new AbortController();
    const timer = setInterval(() => {
      getCrawl(projectId, run.id, controller.signal)
        .then((fresh) => {
          setRuns((current) => current.map((item) => (item.id === fresh.id ? fresh : item)));
          if (!ACTIVE.has(fresh.status)) {
            onChanged();
            listCrawls(projectId)
              .then(setRuns)
              .catch(() => undefined);
          }
        })
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === 'AbortError') {
            return;
          }
          setError(caught instanceof ApiRequestError ? caught.message : 'Не удалось обновить статус сбора');
        });
    }, 1500);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [projectId, run?.id, run?.status, onChanged]);

  async function handleStart() {
    setPending(true);
    setError(null);
    try {
      const created = await startCrawl(projectId);
      setRuns((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setRunId(created.id);
      setPage(null);
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'Не удалось запустить сбор');
    } finally {
      setPending(false);
    }
  }

  async function handleCancel() {
    if (!run) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const cancelled = await cancelCrawl(projectId, run.id);
      setRuns((current) => current.map((item) => (item.id === cancelled.id ? cancelled : item)));
      await sleep(200);
      const fresh = await listCrawls(projectId);
      setRuns(fresh);
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'Не удалось отменить сбор');
    } finally {
      setPending(false);
    }
  }

  async function openPage(pageId: string) {
    if (!run) {
      return;
    }
    setError(null);
    try {
      setPage(await getCrawlPage(projectId, run.id, pageId));
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'Не удалось открыть страницу');
    }
  }

  return (
    <section className="panel stack crawl-panel">
      <div className="crawl-heading">
        <div>
          <h2>Сбор исходного сайта</h2>
          <p className="muted">Стартовая страница: {sourceUrl}</p>
        </div>
        <div className="crawl-actions">
          {active ? (
            <button type="button" className="button button-danger" onClick={handleCancel} disabled={pending}>
              {pending ? 'Отмена…' : 'Отменить сбор'}
            </button>
          ) : (
            <button type="button" className="button button-primary" onClick={handleStart} disabled={pending}>
              {pending ? 'Запуск…' : run ? 'Повторить сбор' : 'Запустить сбор'}
            </button>
          )}
        </div>
      </div>

      {error ? (
        <div className="banner" role="alert">
          <p>{error}</p>
        </div>
      ) : null}
      {loading ? <p className="muted">Загрузка истории сбора…</p> : null}

      {run ? (
        <>
          <div className="crawl-status" role="status">
            <span className={`badge badge-${run.status}`}>{CRAWL_RUN_STATUS_LABELS[run.status]}</span>
            <span>Найдено: {run.pagesFound}</span>
            <span>Собрано: {run.pagesProcessed}</span>
            <span>Пропущено: {run.pagesSkipped}</span>
            <span>Ошибки: {run.pagesFailed}</span>
            <span>Лимит: {run.pageLimit}</span>
          </div>
          {run.currentUrl ? <p className="muted">Сейчас: {run.currentUrl}</p> : null}
          {run.errorMessage ? <div className="banner banner-warning"><p>{run.errorMessage}</p></div> : null}
          {run.status === 'completed_with_errors' ? (
            <p className="note">Сбор частичный: этап не отмечен завершённым, пока есть пропуски по лимиту или ошибки страниц.</p>
          ) : null}
          {run.status === 'completed' ? (
            <p className="note">Страницы сохранены. Анализ и паспорт сайта не подключены, поэтому следующий этап не запускался.</p>
          ) : null}

          <div className="toolbar">
            <label className="search">
              <span className="visually-hidden">Поиск по страницам</span>
              <input
                value={query}
                placeholder="Поиск по заголовку или адресу"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label className="filter">
              <span className="visually-hidden">Статус страницы</span>
              <select value={status} onChange={(event) => setStatus(event.target.value as CrawlPageStatus | '')}>
                <option value="">Все статусы</option>
                {CRAWL_PAGE_STATUSES.map((item) => (
                  <option key={item} value={item}>
                    {CRAWL_PAGE_STATUS_LABELS[item]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="crawl-layout">
            <div className="crawl-list">
              {pages.length === 0 ? <p className="muted">Страницы по этому фильтру не найдены.</p> : null}
              {pages.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={page?.id === item.id ? 'crawl-page selected' : 'crawl-page'}
                  onClick={() => openPage(item.id)}
                >
                  <span className={`badge badge-${item.status}`}>{CRAWL_PAGE_STATUS_LABELS[item.status]}</span>
                  <span className="crawl-page-title">{item.title || item.url}</span>
                  <span className="muted crawl-page-url">{item.url}</span>
                  {item.errorMessage ? <span className="field-error">{item.errorMessage}</span> : null}
                  {item.skipReason ? <span className="muted">{item.skipReason}</span> : null}
                </button>
              ))}
            </div>
            <div className="crawl-detail">
              {page ? <PageView page={page} /> : <p className="muted">Выберите страницу, чтобы увидеть текст, метаданные, ссылки и изображения.</p>}
            </div>
          </div>

          {summary && (summary.errors.length > 0 || summary.skipped.length > 0) ? (
            <div className="crawl-issues">
              {summary.errors.length > 0 ? (
                <div>
                  <h3>Ошибки страниц</h3>
                  <ul className="plain-list">
                    {summary.errors.map((item) => (
                      <li key={`${item.url}-error`}>
                        <span>{item.url}</span>
                        <span className="muted">{item.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {summary.skipped.length > 0 ? (
                <div>
                  <h3>Пропущенные страницы</h3>
                  <ul className="plain-list">
                    {summary.skipped.map((item) => (
                      <li key={`${item.url}-skip`}>
                        <span>{item.url}</span>
                        <span className="muted">{item.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : loading ? null : (
        <p className="note">Сбор ещё не запускался. Этап останется в статусе «Ожидает», пока страницы не будут сохранены.</p>
      )}

      {runs.length > 0 ? (
        <div>
          <h3>История запусков</h3>
          <ul className="plain-list">
            {runs.map((item) => (
              <li key={item.id}>
                <button type="button" className={item.id === run?.id ? 'text-button selected' : 'text-button'} onClick={() => setRunId(item.id)}>
                  <span className={`badge badge-${item.status}`}>{CRAWL_RUN_STATUS_LABELS[item.status]}</span>
                  <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
                  <span className="muted">
                    собрано {item.pagesProcessed} из {item.pagesFound}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function PageView({ page }: { page: CrawlPageDetail }) {
  return (
    <>
      <h3>{page.title || 'Без заголовка'}</h3>
      <p className="muted">{page.finalUrl || page.url}</p>
      {page.description ? (
        <p>
          <strong>Описание: </strong>
          {page.description}
        </p>
      ) : null}
      {page.fetchedAt ? (
        <p className="muted">
          Собрана: <time dateTime={page.fetchedAt}>{formatDateTime(page.fetchedAt)}</time>
        </p>
      ) : null}
      <h3>Текст</h3>
      <p className="prose">{page.text || 'Текст не извлечён'}</p>
      <h3>Ссылки</h3>
      {page.links.length === 0 ? <p className="muted">Ссылок нет</p> : null}
      <ul className="plain-list">
        {page.links.map((link, index) => (
          <li key={`${link.href}-${index}`}>
            <span>{link.text || link.href}</span>
            <span className="muted">
              {link.relation === 'internal' ? 'внутренняя' : link.relation === 'external' ? 'внешняя' : 'пропущена'} · {link.href}
            </span>
          </li>
        ))}
      </ul>
      <h3>Изображения</h3>
      {page.images.length === 0 ? <p className="muted">Изображений нет</p> : null}
      <ul className="image-list">
        {page.images.map((image) => (
          <li key={image.id}>
            {image.downloadUrl ? <img src={image.downloadUrl} alt={image.alt || ''} /> : null}
            <span>{image.alt || 'Без описания'}</span>
            <span className="muted">{image.sourceUrl}</span>
            {image.errorMessage ? <span className="field-error">{image.errorMessage}</span> : null}
          </li>
        ))}
      </ul>
    </>
  );
}
