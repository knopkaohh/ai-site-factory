export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  name_folded TEXT NOT NULL CHECK (length(trim(name_folded)) > 0),
  source_domain TEXT NOT NULL CHECK (length(trim(source_domain)) > 0),
  brief TEXT NOT NULL CHECK (length(trim(brief)) > 0),
  requirements TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('autopilot', 'stage_approval')),
  status TEXT NOT NULL CHECK (status IN ('created', 'in_progress', 'awaiting_review', 'demo_ready', 'published', 'error')),
  current_stage TEXT NOT NULL CHECK (current_stage IN ('collect', 'analyze', 'concept', 'develop', 'qa', 'demo', 'publish')),
  progress INTEGER NOT NULL CHECK (progress >= 0 AND progress <= 100),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_stages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL CHECK (stage_key IN ('collect', 'analyze', 'concept', 'develop', 'qa', 'demo', 'publish')),
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'awaiting_review', 'completed', 'error')),
  position INTEGER NOT NULL CHECK (position >= 1 AND position <= 7),
  started_at TEXT,
  completed_at TEXT,
  error_message TEXT,
  UNIQUE (project_id, stage_key),
  UNIQUE (project_id, position)
);

CREATE TABLE IF NOT EXISTS project_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects (status);
CREATE INDEX IF NOT EXISTS idx_project_stages_project ON project_stages (project_id, position);
CREATE INDEX IF NOT EXISTS idx_project_events_project ON project_events (project_id, created_at DESC);
`;
