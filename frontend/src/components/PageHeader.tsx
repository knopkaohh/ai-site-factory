import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function PageHeader({
  title,
  description,
  backTo,
  backLabel = 'Назад',
  actions,
}: {
  title: string;
  description?: string;
  backTo?: string;
  backLabel?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {backTo ? (
          <Link className="back-link" to={backTo}>
            {backLabel}
          </Link>
        ) : null}
        <h1>{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}
