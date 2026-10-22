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
  source_url TEXT,
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

CREATE TABLE IF NOT EXISTS crawl_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  page_limit INTEGER NOT NULL,
  max_response_bytes INTEGER NOT NULL,
  request_timeout_ms INTEGER NOT NULL,
  run_timeout_ms INTEGER NOT NULL,
  max_image_bytes INTEGER NOT NULL,
  max_images_per_page INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS crawl_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'completed_with_errors', 'failed', 'cancelled')),
  start_url TEXT NOT NULL,
  pages_found INTEGER NOT NULL DEFAULT 0,
  pages_processed INTEGER NOT NULL DEFAULT 0,
  pages_skipped INTEGER NOT NULL DEFAULT 0,
  pages_failed INTEGER NOT NULL DEFAULT 0,
  current_url TEXT,
  error_message TEXT,
  truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
  page_limit INTEGER NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS crawl_pages (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  final_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('fetched', 'skipped', 'error')),
  http_status INTEGER,
  title TEXT,
  description TEXT,
  text_content TEXT,
  excerpt TEXT,
  error_message TEXT,
  skip_reason TEXT,
  fetched_at TEXT,
  UNIQUE (run_id, url)
);

CREATE TABLE IF NOT EXISTS crawl_links (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES crawl_pages(id) ON DELETE CASCADE,
  href TEXT NOT NULL,
  link_text TEXT,
  relation TEXT NOT NULL CHECK (relation IN ('internal', 'external', 'skipped'))
);

CREATE TABLE IF NOT EXISTS crawl_images (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES crawl_pages(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  alt_text TEXT,
  stored_name TEXT,
  content_type TEXT,
  byte_size INTEGER,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_crawl_runs_project ON crawl_runs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crawl_pages_run ON crawl_pages (run_id, fetched_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crawl_one_active
  ON crawl_runs (project_id)
  WHERE status IN ('queued', 'running');
`;
