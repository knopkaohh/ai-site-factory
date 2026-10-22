import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

export function Layout() {
  const location = useLocation();
  const projectsActive = location.pathname === '/' || location.pathname.startsWith('/projects');

  return (
    <div className="app-shell">
      <a className="skip-link" href="#content">
        К содержимому
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            SF
          </span>
          <span>
            <span className="brand-title">AI Site Factory</span>
            <span className="brand-sub">Редизайн сайтов</span>
          </span>
        </div>
        <nav className="nav" aria-label="Разделы">
          <Link
            to="/"
            className={projectsActive ? 'nav-link active' : 'nav-link'}
            aria-current={projectsActive ? 'page' : undefined}
          >
            Проекты
          </Link>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Настройки
          </NavLink>
        </nav>
      </aside>
      <div className="workspace">
        <main id="content" className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
