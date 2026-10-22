import { useEffect, useState } from 'react';
import { ApiRequestError, getHealth } from '../api/client';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { PageHeader } from '../components/PageHeader';
import { formatDateTime } from '../format';
import { INTEGRATION_STATE_LABELS, type HealthReport } from '../shared';

export function SettingsPage() {
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    document.title = 'Настройки — AI Site Factory';
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    getHealth(controller.signal)
      .then((result) => {
        setHealth(result);
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
        description="Состояние платформы и будущих интеграций. Подключёнными отмечены только реально настроенные компоненты."
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
