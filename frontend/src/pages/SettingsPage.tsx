import { useEffect, useState } from 'react';
import { ApiRequestError, getCrawlSettings, getHealth, updateCrawlSettings } from '../api/client';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { PageHeader } from '../components/PageHeader';
import { formatDateTime } from '../format';
import { CRAWL_PAGE_LIMIT_MAX, CRAWL_PAGE_LIMIT_MIN, INTEGRATION_STATE_LABELS, type CrawlSettings, type HealthReport } from '../shared';

export function SettingsPage() {
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [settings, setSettings] = useState<CrawlSettings | null>(null);
  const [pageLimit, setPageLimit] = useState('100');
  const [saving, setSaving] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    document.title = 'Настройки — AI Site Factory';
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    Promise.all([getHealth(controller.signal), getCrawlSettings(controller.signal)])
      .then(([healthResult, settingsResult]) => {
        setHealth(healthResult);
        setSettings(settingsResult);
        setPageLimit(String(settingsResult.pageLimit));
        setError(null);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') {
          return;
        }
        setHealth(null);
        setError(caught instanceof ApiRequestError ? caught.message : 'Не удалось получить состояние платформы');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [reloadKey]);

  return (
    <>
      <PageHeader
        title="Настройки"
        description="Состояние платформы, лимит сбора и интеграции. Подключёнными отмечены только реально работающие компоненты."
      />
      {loading ? <LoadingState /> : null}
      {error ? <ErrorBanner message={error} onRetry={() => setReloadKey((value) => value + 1)} /> : null}
      {health ? (
        <>
          <section className="panel stack">
            <h2>Платформа</h2>
            <dl className="facts">
              <div>
                <dt>Версия</dt>
                <dd>{health.version}</dd>
              </div>
              <div>
                <dt>Backend</dt>
                <dd>{health.status === 'ok' ? 'Работает' : 'Работает с ошибкой базы данных'}</dd>
              </div>
              <div>
                <dt>База данных</dt>
                <dd>
                  SQLite · {health.database.status === 'ok' ? 'подключена' : 'недоступна'} · {health.database.location}
                  {health.database.message ? `. ${health.database.message}` : ''}
                </dd>
              </div>
              <div>
                <dt>Проверено</dt>
                <dd>
                  <time dateTime={health.time}>{formatDateTime(health.time)}</time>
                </dd>
              </div>
            </dl>
          </section>
          <section className="panel stack">
            <h2>Сбор исходного сайта</h2>
            {settings ? (
              <form
                className="form"
                onSubmit={(event) => {
                  event.preventDefault();
                  setSaving(true);
                  setSettingsError(null);
                  setSettingsNotice(null);
                  updateCrawlSettings(Number(pageLimit))
                    .then((next) => {
                      setSettings(next);
                      setPageLimit(String(next.pageLimit));
                      setSettingsNotice('Лимит страниц сохранён');
                    })
                    .catch((caught: unknown) => {
                      setSettingsError(caught instanceof ApiRequestError ? caught.message : 'Не удалось сохранить лимит');
                    })
                    .finally(() => setSaving(false));
                }}
              >
                <label className="field" htmlFor="page-limit">
                  Страниц за один запуск
                  <input
                    id="page-limit"
                    type="number"
                    min={CRAWL_PAGE_LIMIT_MIN}
                    max={CRAWL_PAGE_LIMIT_MAX}
                    value={pageLimit}
                    onChange={(event) => setPageLimit(event.target.value)}
                  />
                </label>
                <dl className="facts">
                  <div>
                    <dt>Размер ответа</dt>
                    <dd>до {Math.round(settings.maxResponseBytes / 1_000_000)} МБ</dd>
                  </div>
                  <div>
                    <dt>Ожидание ответа</dt>
                    <dd>{Math.round(settings.requestTimeoutMs / 1000)} с</dd>
                  </div>
                  <div>
                    <dt>Время запуска</dt>
                    <dd>{Math.round(settings.runTimeoutMs / 60000)} мин</dd>
                  </div>
                  <div>
                    <dt>Изображения</dt>
                    <dd>
                      JPEG, PNG, GIF и WebP, до {settings.maxImagesPerPage} на страницу и{' '}
                      {Math.round(settings.maxImageBytes / 1_000_000)} МБ
                    </dd>
                  </div>
                </dl>
                {settingsError ? <p className="field-error">{settingsError}</p> : null}
                {settingsNotice ? <p className="notice">{settingsNotice}</p> : null}
                <div className="form-actions">
                  <button type="submit" className="button button-primary" disabled={saving}>
                    {saving ? 'Сохранение…' : 'Сохранить лимит'}
                  </button>
                </div>
              </form>
            ) : null}
          </section>
          <section className="panel stack">
            <h2>Интеграции</h2>
            <div className="integration-table">
              <div className="integration-row integration-head">
                <span>Компонент</span>
                <span>Состояние</span>
                <span>Комментарий</span>
              </div>
              {health.integrations.map((item) => (
                <div key={item.id} className="integration-row">
                  <span className="integration-title">{item.title}</span>
                  <span>
                    <span className={`badge badge-${item.state}`}>{INTEGRATION_STATE_LABELS[item.state]}</span>
                  </span>
                  <span className="muted">{item.detail}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
