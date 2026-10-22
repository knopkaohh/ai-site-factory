import type { DatabaseSync } from 'node:sqlite';
import {
  deriveCurrentStage,
  deriveProgress,
  isProjectMode,
  isProjectStatus,
  isStageKey,
  isStageStatus,
  type Project,
  type ProjectEvent,
  type ProjectStage,
  type ProjectStatus,
  type StageKey,
  type StageStatus,
} from '../../../shared/src/index';

interface ProjectRow {
  id: string;
  name: string;
  source_domain: string;
  source_url: string | null;
  brief: string;
  requirements: string | null;
  mode: string;
  status: string;
  current_stage: string;
  progress: number;
  created_at: string;
  updated_at: string;
}

interface StageRow {
  id: string;
  project_id: string;
  stage_key: string;
  title: string;
  status: string;
  position: number;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

interface EventRow {
  id: string;
  project_id: string;
  event_type: string;
  message: string;
  created_at: string;
}

interface CountRow {
  total: number;
  in_progress: number | null;
  demo_ready: number | null;
}

function asRow<T>(value: unknown): T | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as T;
}

function mapProject(row: ProjectRow): Project {
  if (!isProjectMode(row.mode) || !isProjectStatus(row.status) || !isStageKey(row.current_stage)) {
    throw new Error(`Некорректная запись проекта ${row.id}`);
  }
  return {
    id: row.id,
    name: row.name,
    sourceDomain: row.source_domain,
    sourceUrl: row.source_url?.trim() || `https://${row.source_domain}/`,
    brief: row.brief,
    requirements: row.requirements,
    mode: row.mode,
    status: row.status,
    currentStage: row.current_stage,
    progress: row.progress,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapStage(row: StageRow): ProjectStage {
  if (!isStageKey(row.stage_key) || !isStageStatus(row.status)) {
    throw new Error(`Некорректная запись этапа ${row.id}`);
  }
  return {
    id: row.id,
    projectId: row.project_id,
    stageKey: row.stage_key,
    title: row.title,
    status: row.status,
    position: row.position,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
  };
}

function mapEvent(row: EventRow): ProjectEvent {
  return {
    id: row.id,
    projectId: row.project_id,
    eventType: row.event_type,
    message: row.message,
    createdAt: row.created_at,
  };
}

const PROJECT_COLUMNS = `
  id, name, source_domain, source_url, brief, requirements, mode, status,
  current_stage, progress, created_at, updated_at
`;

export function findProject(database: DatabaseSync, id: string): Project | null {
  const row = asRow<ProjectRow>(
    database.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ?`).get(id),
  );
  return row ? mapProject(row) : null;
}

export function listProjects(
  database: DatabaseSync,
  filters: { searchPattern?: string; status?: string },
): Project[] {
  const where: string[] = [];
  const params: string[] = [];
  if (filters.searchPattern) {
    where.push("(name_folded LIKE ? ESCAPE '\\' OR source_domain LIKE ? ESCAPE '\\')");
    params.push(filters.searchPattern, filters.searchPattern);
  }
  if (filters.status) {
    where.push('status = ?');
    params.push(filters.status);
  }
  const sql = `
    SELECT ${PROJECT_COLUMNS}
    FROM projects
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY updated_at DESC, id DESC
  `;
  return database
    .prepare(sql)
    .all(...params)
    .map((item) => mapProject(asRow<ProjectRow>(item) as ProjectRow));
}

export function summarizeProjects(database: DatabaseSync): {
  total: number;
  inProgress: number;
  demoReady: number;
} {
  const row = asRow<CountRow>(
    database
      .prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
          SUM(CASE WHEN status = 'demo_ready' THEN 1 ELSE 0 END) AS demo_ready
        FROM projects
      `)
      .get(),
  );
  return {
    total: Number(row?.total ?? 0),
    inProgress: Number(row?.in_progress ?? 0),
    demoReady: Number(row?.demo_ready ?? 0),
  };
}

export function listStages(database: DatabaseSync, projectId: string): ProjectStage[] {
  return database
    .prepare(
      `
        SELECT id, project_id, stage_key, title, status, position, started_at, completed_at, error_message
        FROM project_stages
        WHERE project_id = ?
        ORDER BY position ASC
      `,
    )
    .all(projectId)
    .map((item) => mapStage(asRow<StageRow>(item) as StageRow));
}

export function listEvents(database: DatabaseSync, projectId: string): ProjectEvent[] {
  return database
    .prepare(
      `
        SELECT id, project_id, event_type, message, created_at
        FROM project_events
        WHERE project_id = ?
        ORDER BY created_at DESC, id DESC
      `,
    )
    .all(projectId)
    .map((item) => mapEvent(asRow<EventRow>(item) as EventRow));
}

export interface NewProjectRecord {
  id: string;
  name: string;
  nameFolded: string;
  sourceDomain: string;
  sourceUrl: string;
  brief: string;
  requirements: string | null;
  mode: string;
  status: string;
  currentStage: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
}

export function insertProject(database: DatabaseSync, project: NewProjectRecord): void {
  database
    .prepare(
      `
        INSERT INTO projects (
          id, name, name_folded, source_domain, source_url, brief, requirements, mode, status,
          current_stage, progress, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      project.id,
      project.name,
      project.nameFolded,
      project.sourceDomain,
      project.sourceUrl,
      project.brief,
      project.requirements,
      project.mode,
      project.status,
      project.currentStage,
      project.progress,
      project.createdAt,
      project.updatedAt,
    );
}

export interface NewStageRecord {
  id: string;
  projectId: string;
  stageKey: string;
  title: string;
  status: string;
  position: number;
}

export function insertStage(database: DatabaseSync, stage: NewStageRecord): void {
  database
    .prepare(
      `
        INSERT INTO project_stages (
          id, project_id, stage_key, title, status, position, started_at, completed_at, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
      `,
    )
    .run(stage.id, stage.projectId, stage.stageKey, stage.title, stage.status, stage.position);
}

export function insertEvent(
  database: DatabaseSync,
  event: { id: string; projectId: string; eventType: string; message: string; createdAt: string },
): void {
  database
    .prepare(
      `
        INSERT INTO project_events (id, project_id, event_type, message, created_at)
        VALUES (?, ?, ?, ?, ?)
      `,
    )
    .run(event.id, event.projectId, event.eventType, event.message, event.createdAt);
}

export function updateProjectRow(
  database: DatabaseSync,
  project: {
    id: string;
    name: string;
    nameFolded: string;
    sourceDomain: string;
    sourceUrl: string;
    brief: string;
    requirements: string | null;
    mode: string;
    updatedAt: string;
  },
): void {
  database
    .prepare(
      `
        UPDATE projects
        SET name = ?, name_folded = ?, source_domain = ?, source_url = ?, brief = ?, requirements = ?, mode = ?, updated_at = ?
        WHERE id = ?
      `,
    )
    .run(
      project.name,
      project.nameFolded,
      project.sourceDomain,
      project.sourceUrl,
      project.brief,
      project.requirements,
      project.mode,
      project.updatedAt,
      project.id,
    );
}

export function deleteProject(database: DatabaseSync, id: string): number {
  const result = database.prepare('DELETE FROM projects WHERE id = ?').run(id);
  return Number(result.changes);
}

export function applyProjectStage(
  database: DatabaseSync,
  projectId: string,
  stageKey: StageKey,
  stage: {
    status: StageStatus;
    startedAt: string | null;
    completedAt: string | null;
    errorMessage: string | null;
  },
  projectStatus: ProjectStatus,
  updatedAt: string,
): void {
  database
    .prepare(
      `
        UPDATE project_stages
        SET status = ?, started_at = ?, completed_at = ?, error_message = ?
        WHERE project_id = ? AND stage_key = ?
      `,
    )
    .run(stage.status, stage.startedAt, stage.completedAt, stage.errorMessage, projectId, stageKey);
  const stages = listStages(database, projectId);
  database
    .prepare(
      `
        UPDATE projects
        SET status = ?, progress = ?, current_stage = ?, updated_at = ?
        WHERE id = ?
      `,
    )
    .run(projectStatus, deriveProgress(stages), deriveCurrentStage(stages), updatedAt, projectId);
}

export function resetCollectStageIfRunning(database: DatabaseSync, projectId: string, updatedAt: string): boolean {
  const result = database
    .prepare(
      `
        UPDATE project_stages
        SET status = 'pending', started_at = NULL, completed_at = NULL, error_message = NULL
        WHERE project_id = ? AND stage_key = 'collect' AND status = 'in_progress'
      `,
    )
    .run(projectId);
  if (Number(result.changes) === 0) {
    return false;
  }
  const stages = listStages(database, projectId);
  const status: ProjectStatus = stages.every((stage) => stage.status === 'pending') ? 'created' : 'in_progress';
  database
    .prepare('UPDATE projects SET status = ?, progress = ?, current_stage = ?, updated_at = ? WHERE id = ?')
    .run(status, deriveProgress(stages), deriveCurrentStage(stages), updatedAt, projectId);
  return true;
}

export function countRelated(database: DatabaseSync, projectId: string): { stages: number; events: number } {
  const stages = asRow<{ count: number }>(
    database.prepare('SELECT COUNT(*) AS count FROM project_stages WHERE project_id = ?').get(projectId),
  );
  const events = asRow<{ count: number }>(
    database.prepare('SELECT COUNT(*) AS count FROM project_events WHERE project_id = ?').get(projectId),
  );
  return { stages: Number(stages?.count ?? 0), events: Number(events?.count ?? 0) };
}
