import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import {
  PROJECT_EVENT_TYPES,
  PROJECT_MODE_LABELS,
  STAGE_CATALOG,
  deriveCurrentStage,
  deriveProgress,
  foldSearchText,
  type ProjectDetail,
  type ProjectInput,
  type ProjectList,
  type ProjectPatch,
  type ProjectStatus,
} from '../../../shared/src/index';
import { crawlProjectDirectory } from '../crawl/storage';
import { crawlRuntime } from '../crawl/runtime';
import { likeContains, withTransaction } from '../db/database';
import {
  countRelated,
  deleteProject,
  findProject,
  insertEvent,
  insertProject,
  insertStage,
  listEvents,
  listProjects,
  listStages,
  summarizeProjects,
  updateProjectRow,
} from '../repositories/projectRepository';

const FIELD_LABELS: Record<keyof ProjectInput, string> = {
  name: 'название',
  sourceDomain: 'исходный домен',
  sourceUrl: 'исходный адрес',
  brief: 'краткое техническое задание',
  requirements: 'особые требования',
  mode: 'режим работы',
};

function readDetail(database: DatabaseSync, id: string): ProjectDetail | null {
  const project = findProject(database, id);
  if (!project) {
    return null;
  }
  return {
    project,
    stages: listStages(database, id),
    events: listEvents(database, id),
  };
}

export function listProjectPage(
  database: DatabaseSync,
  filters: { query?: string; status?: ProjectStatus },
): ProjectList {
  const searchPattern = filters.query ? likeContains(foldSearchText(filters.query)) : undefined;
  return {
    projects: listProjects(database, {
      ...(searchPattern ? { searchPattern } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    }),
    summary: summarizeProjects(database),
  };
}

export function getProjectDetail(database: DatabaseSync, id: string): ProjectDetail | null {
  return readDetail(database, id);
}

export function createProject(database: DatabaseSync, input: ProjectInput): ProjectDetail {
  return withTransaction(database, () => {
    const now = new Date().toISOString();
    const id = randomUUID();
    const stages = STAGE_CATALOG.map((definition, index) => ({
      stageKey: definition.key,
      status: 'pending' as const,
      position: index + 1,
    }));

    insertProject(database, {
      id,
      name: input.name,
      nameFolded: foldSearchText(input.name),
      sourceDomain: input.sourceDomain,
      sourceUrl: input.sourceUrl,
      brief: input.brief,
      requirements: input.requirements,
      mode: input.mode,
      status: 'created',
      currentStage: deriveCurrentStage(stages),
      progress: deriveProgress(stages),
      createdAt: now,
      updatedAt: now,
    });

    for (const definition of STAGE_CATALOG) {
      const position = stages.find((stage) => stage.stageKey === definition.key)?.position ?? 0;
      insertStage(database, {
        id: randomUUID(),
        projectId: id,
        stageKey: definition.key,
        title: definition.title,
        status: 'pending',
        position,
      });
    }

    insertEvent(database, {
      id: randomUUID(),
      projectId: id,
      eventType: PROJECT_EVENT_TYPES.created,
      message: `Проект создан. Исходный адрес: ${input.sourceUrl}. Режим: ${PROJECT_MODE_LABELS[input.mode]}.`,
      createdAt: now,
    });

    const detail = readDetail(database, id);
    if (!detail) {
      throw new Error('Проект не найден сразу после создания');
    }
    return detail;
  });
}

function changedFields(current: ProjectInput, patch: ProjectPatch): (keyof ProjectInput)[] {
  const fields: (keyof ProjectInput)[] = [];
  if (patch.name !== undefined && patch.name !== current.name) {
    fields.push('name');
  }
  if (patch.sourceDomain !== undefined && patch.sourceDomain !== current.sourceDomain) {
    fields.push('sourceDomain');
  }
  if (
    patch.sourceUrl !== undefined &&
    patch.sourceUrl !== current.sourceUrl &&
    !fields.includes('sourceDomain')
  ) {
    fields.push('sourceUrl');
  }
  if (patch.brief !== undefined && patch.brief !== current.brief) {
    fields.push('brief');
  }
  if (patch.requirements !== undefined && patch.requirements !== current.requirements) {
    fields.push('requirements');
  }
  if (patch.mode !== undefined && patch.mode !== current.mode) {
    fields.push('mode');
  }
  return fields;
}

export function updateProject(
  database: DatabaseSync,
  id: string,
  patch: ProjectPatch,
): ProjectDetail | null {
  const current = findProject(database, id);
  if (!current) {
    return null;
  }

  const fields = changedFields(
    {
      name: current.name,
      sourceDomain: current.sourceDomain,
      sourceUrl: current.sourceUrl,
      brief: current.brief,
      requirements: current.requirements,
      mode: current.mode,
    },
    patch,
  );

  if (fields.length === 0) {
    return readDetail(database, id);
  }

  return withTransaction(database, () => {
    const now = new Date().toISOString();
    const next = {
      name: patch.name ?? current.name,
      sourceDomain: patch.sourceDomain ?? current.sourceDomain,
      sourceUrl: patch.sourceUrl ?? current.sourceUrl,
      brief: patch.brief ?? current.brief,
      requirements: patch.requirements === undefined ? current.requirements : patch.requirements,
      mode: patch.mode ?? current.mode,
    };
    updateProjectRow(database, {
      id,
      name: next.name,
      nameFolded: foldSearchText(next.name),
      sourceDomain: next.sourceDomain,
      sourceUrl: next.sourceUrl,
      brief: next.brief,
      requirements: next.requirements,
      mode: next.mode,
      updatedAt: now,
    });

    const labels = fields.map((field) => FIELD_LABELS[field]).join(', ');
    const modeNote = fields.includes('mode') ? ` Новый режим: ${PROJECT_MODE_LABELS[next.mode]}.` : '';
    insertEvent(database, {
      id: randomUUID(),
      projectId: id,
      eventType: PROJECT_EVENT_TYPES.updated,
      message: `Обновлены параметры проекта: ${labels}.${modeNote}`,
      createdAt: now,
    });

    const detail = readDetail(database, id);
    if (!detail) {
      throw new Error('Проект не найден сразу после обновления');
    }
    return detail;
  });
}

export function removeProject(database: DatabaseSync, id: string): boolean {
  const removed = withTransaction(database, () => {
    const current = findProject(database, id);
    if (!current) {
      return false;
    }
    const changes = deleteProject(database, id);
    return changes > 0;
  });
  if (removed) {
    removeProjectFiles(id);
  }
  return removed;
}

export function removeProjectFiles(projectId: string): void {
  try {
    rmSync(crawlProjectDirectory(crawlRuntime().storageRoot, projectId), { recursive: true, force: true });
  } catch (error) {
    console.error('Не удалось удалить файлы сбора', error);
  }
}

export function relatedCounts(database: DatabaseSync, projectId: string) {
  return countRelated(database, projectId);
}
