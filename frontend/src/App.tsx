import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { PageHeader } from './components/PageHeader';
import { ProjectCreatePage } from './pages/ProjectCreatePage';
import { ProjectPage } from './pages/ProjectPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<ProjectsPage />} />
          <Route path="projects/new" element={<ProjectCreatePage />} />
          <Route path="projects/:projectId" element={<ProjectPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route
            path="*"
            element={
              <PageHeader
                title="Страница не найдена"
                description="Такого раздела нет."
                backTo="/"
                backLabel="К проектам"
              />
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
