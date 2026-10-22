import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiRequestError, createProject } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { ProjectForm } from '../components/ProjectForm';
import type { FieldError, ProjectInput } from '../shared';

export function ProjectCreatePage() {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldError[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Новый проект — AI Site Factory';
  }, []);

  async function handleSubmit(value: ProjectInput) {
    setPending(true);
    setServerErrors([]);
    setFormError(null);
    try {
      const detail = await createProject(value);
      navigate(`/projects/${detail.project.id}`);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setServerErrors(error.details);
        setFormError(error.details.length > 0 ? null : error.message);
      } else {
        setFormError('Не удалось создать проект');
      }
      setPending(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Новый проект"
        description="Домен и техническое задание сохраняются в базе. Исходный сайт на этом шаге не загружается."
        backTo="/"
        backLabel="К проектам"
      />
      <section className="panel form-panel">
        <ProjectForm
          submitLabel="Создать проект"
          pendingLabel="Создание…"
          pending={pending}
          serverErrors={serverErrors}
          formError={formError}
          onSubmit={handleSubmit}
          onCancel={() => navigate('/')}
        />
      </section>
    </>
  );
}
