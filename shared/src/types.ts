import type {
  CrawlLinkRelation,
  CrawlPageStatus,
  CrawlRunStatus,
  ProjectEventType,
  ProjectMode,
  ProjectStatus,
  StageKey,
  StageStatus,
} from './constants';

export interface Project {
  id: string;
  name: string;
  sourceDomain: string;
  sourceUrl: string;
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

export interface CrawlSettings {
  pageLimit: number;
  maxResponseBytes: number;
  requestTimeoutMs: number;
  runTimeoutMs: number;
  maxImageBytes: number;
  maxImagesPerPage: number;
}

export interface CrawlRun {
  id: string;
  projectId: string;
  status: CrawlRunStatus;
  startUrl: string;
  pagesFound: number;
  pagesProcessed: number;
  pagesSkipped: number;
  pagesFailed: number;
  currentUrl: string | null;
  errorMessage: string | null;
  truncated: boolean;
  pageLimit: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrawlPageSummary {
  id: string;
  runId: string;
  url: string;
  finalUrl: string | null;
  status: CrawlPageStatus;
  httpStatus: number | null;
  title: string | null;
  description: string | null;
  excerpt: string | null;
  errorMessage: string | null;
  skipReason: string | null;
  fetchedAt: string | null;
}

export interface CrawlLink {
  href: string;
  text: string;
  relation: CrawlLinkRelation;
}

export interface CrawlImage {
  id: string;
  sourceUrl: string;
  alt: string | null;
  contentType: string | null;
  byteSize: number | null;
  stored: boolean;
  downloadUrl: string | null;
  errorMessage: string | null;
}

export interface CrawlPageDetail extends CrawlPageSummary {
  text: string | null;
  links: CrawlLink[];
  images: CrawlImage[];
}

export interface CrawlSummary {
  pagesFound: number;
  pagesProcessed: number;
  pagesSkipped: number;
  pagesFailed: number;
  truncated: boolean;
  errors: { url: string; message: string }[];
  skipped: { url: string; reason: string }[];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: { field: string; message: string }[];
  };
}
