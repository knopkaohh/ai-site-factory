import type { ProjectEventType, ProjectMode, ProjectStatus, StageKey, StageStatus } from './constants';

export interface Project {
  id: string;
  name: string;
  sourceDomain: string;
  brief: string;
  requirements: string | null;
  mode: ProjectMode;
  status: ProjectStatus;
  currentStage: StageKey;
  progress: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectStage {
  id: string;
  projectId: string;
  stageKey: StageKey;
  title: string;
  status: StageStatus;
  position: number;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface ProjectEvent {
  id: string;
  projectId: string;
  eventType: ProjectEventType | string;
  message: string;
  createdAt: string;
}

export interface ProjectDetail {
  project: Project;
  stages: ProjectStage[];
  events: ProjectEvent[];
}

export interface ProjectSummary {
  total: number;
  inProgress: number;
  demoReady: number;
}

export interface ProjectList {
  projects: Project[];
  summary: ProjectSummary;
}

export interface IntegrationStatus {
  id: string;
  title: string;
  state: 'not_connected' | 'in_development' | 'ok';
  detail: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  version: string;
  time: string;
  database: {
    status: 'ok' | 'error';
    engine: 'sqlite';
    location: string;
    message?: string;
  };
  integrations: IntegrationStatus[];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: { field: string; message: string }[];
  };
}
