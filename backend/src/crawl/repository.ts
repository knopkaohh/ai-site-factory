import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  isCrawlPageStatus,
  isCrawlRunStatus,
  type CrawlImage,
  type CrawlLink,
  type CrawlLinkRelation,
  type CrawlPageDetail,
  type CrawlPageStatus,
  type CrawlPageSummary,
  type CrawlRun,
  type CrawlRunStatus,
  type CrawlSettings,
  type CrawlSummary,
} from '../../../shared/src/index';
import { CRAWL_DEFAULTS } from './limits';

interface SettingsRow {
  page_limit: number;
  max_response_bytes: number;
  request_timeout_ms: number;
  run_timeout_ms: number;
  max_image_bytes: number;
  max_images_per_page: number;
}

interface RunRow {
  id: string;
  project_id: string;
  status: string;
  start_url: string;
  pages_found: number;
  pages_processed: number;
  pages_skipped: number;
  pages_failed: number;
  current_url: string | null;
  error_message: string | null;
  truncated: number;
  page_limit: number;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PageRow {
  id: string;
  run_id: string;
  url: string;
  final_url: string | null;
  status: string;
  http_status: number | null;
  title: string | null;
  description: string | null;
  text_content: string | null;
  excerpt: string | null;
  error_message: string | null;
  skip_reason: string | null;
  fetched_at: string | null;
}

interface LinkRow {
  href: string;
  link_text: string | null;
  relation: string;
}

interface ImageRow {
  id: string;
  source_url: string;
  alt_text: string | null;
  stored_name: string | null;
  content_type: string | null;
  byte_size: number | null;
  error_message: string | null;
}

function asRow<T>(value: unknown): T | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as T;
}

function mapSettings(row: SettingsRow): CrawlSettings {
  return {
    pageLimit: row.page_limit,
    maxResponseBytes: row.max_response_bytes,
    requestTimeoutMs: row.request_timeout_ms,
    runTimeoutMs: row.run_timeout_ms,
    maxImageBytes: row.max_image_bytes,
    maxImagesPerPage: row.max_images_per_page,
  };
}

function mapRun(row: RunRow): CrawlRun {
  if (!isCrawlRunStatus(row.status)) {
    throw new Error(`Некорректный статус запуска ${row.id}`);
  }
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    startUrl: row.start_url,
    pagesFound: row.pages_found,
    pagesProcessed: row.pages_processed,
    pagesSkipped: row.pages_skipped,
    pagesFailed: row.pages_failed,
    currentUrl: row.current_url,
    errorMessage: row.error_message,
    truncated: Number(row.truncated) === 1,
    pageLimit: row.page_limit,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPage(row: PageRow): CrawlPageSummary {
  if (!isCrawlPageStatus(row.status)) {
    throw new Error(`Некорректный статус страницы ${row.id}`);
  }
  return {
    id: row.id,
    runId: row.run_id,
    url: row.url,
    finalUrl: row.final_url,
    status: row.status,
    httpStatus: row.http_status,
    title: row.title,
    description: row.description,
    excerpt: row.excerpt,
    errorMessage: row.error_message,
    skipReason: row.skip_reason,
    fetchedAt: row.fetched_at,
  };
}

const RUN_COLUMNS = `
  id, project_id, status, start_url, pages_found, pages_processed, pages_skipped, pages_failed,
  current_url, error_message, truncated, page_limit, started_at, finished_at, created_at, updated_at
`;

export function ensureCrawlSettings(database: DatabaseSync): CrawlSettings {
  const existing = asRow<SettingsRow>(
    database
      .prepare(
        `
          SELECT page_limit, max_response_bytes, request_timeout_ms, run_timeout_ms,
                 max_image_bytes, max_images_per_page
          FROM crawl_settings
          WHERE id = 1
        `,
      )
      .get(),
  );
  if (existing) {
    return mapSettings(existing);
  }
  const now = new Date().toISOString();
  database
    .prepare(
      `
        INSERT INTO crawl_settings (
          id, page_limit, max_response_bytes, request_timeout_ms, run_timeout_ms,
          max_image_bytes, max_images_per_page, updated_at
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      CRAWL_DEFAULTS.pageLimit,
      CRAWL_DEFAULTS.maxResponseBytes,
      CRAWL_DEFAULTS.requestTimeoutMs,
      CRAWL_DEFAULTS.runTimeoutMs,
      CRAWL_DEFAULTS.maxImageBytes,
      CRAWL_DEFAULTS.maxImagesPerPage,
      now,
    );
  return { ...CRAWL_DEFAULTS };
}

export function saveCrawlPageLimit(database: DatabaseSync, pageLimit: number): CrawlSettings {
  const current = ensureCrawlSettings(database);
  database
    .prepare('UPDATE crawl_settings SET page_limit = ?, updated_at = ? WHERE id = 1')
    .run(pageLimit, new Date().toISOString());
  return { ...current, pageLimit };
}

export function insertCrawlRun(
  database: DatabaseSync,
  run: {
    id: string;
    projectId: string;
    startUrl: string;
    pageLimit: number;
    createdAt: string;
  },
): void {
  database
    .prepare(
      `
        INSERT INTO crawl_runs (
          id, project_id, status, start_url, pages_found, pages_processed, pages_skipped, pages_failed,
          current_url, error_message, truncated, page_limit, started_at, finished_at, created_at, updated_at
        ) VALUES (?, ?, 'queued', ?, 0, 0, 0, 0, NULL, NULL, 0, ?, NULL, NULL, ?, ?)
      `,
    )
    .run(run.id, run.projectId, run.startUrl, run.pageLimit, run.createdAt, run.createdAt);
}

export function findCrawlRun(database: DatabaseSync, id: string): CrawlRun | null {
  const row = asRow<RunRow>(database.prepare(`SELECT ${RUN_COLUMNS} FROM crawl_runs WHERE id = ?`).get(id));
  return row ? mapRun(row) : null;
}

export function listCrawlRuns(database: DatabaseSync, projectId: string): CrawlRun[] {
  return database
    .prepare(`SELECT ${RUN_COLUMNS} FROM crawl_runs WHERE project_id = ? ORDER BY created_at DESC, id DESC`)
    .all(projectId)
    .map((item) => mapRun(asRow<RunRow>(item) as RunRow));
}

export function findActiveCrawlRun(database: DatabaseSync, projectId: string): CrawlRun | null {
  const row = asRow<RunRow>(
    database
      .prepare(
        `SELECT ${RUN_COLUMNS} FROM crawl_runs WHERE project_id = ? AND status IN ('queued', 'running')`,
      )
      .get(projectId),
  );
  return row ? mapRun(row) : null;
}

export function listInterruptedCrawlRuns(database: DatabaseSync): CrawlRun[] {
  return database
    .prepare(`SELECT ${RUN_COLUMNS} FROM crawl_runs WHERE status IN ('queued', 'running') ORDER BY created_at ASC`)
    .all()
    .map((item) => mapRun(asRow<RunRow>(item) as RunRow));
}

export function markCrawlRunning(database: DatabaseSync, id: string, startedAt: string): boolean {
  const result = database
    .prepare(
      `
        UPDATE crawl_runs
        SET status = 'running', started_at = ?, updated_at = ?
        WHERE id = ? AND status = 'queued'
      `,
    )
    .run(startedAt, startedAt, id);
  return Number(result.changes) > 0;
}

export interface CrawlProgressPatch {
  pagesFound: number;
  pagesProcessed: number;
  pagesSkipped: number;
  pagesFailed: number;
  currentUrl: string | null;
  truncated: boolean;
}

export function updateCrawlProgress(database: DatabaseSync, id: string, patch: CrawlProgressPatch, updatedAt: string): void {
  database
    .prepare(
      `
        UPDATE crawl_runs
        SET pages_found = ?, pages_processed = ?, pages_skipped = ?, pages_failed = ?,
            current_url = ?, truncated = ?, updated_at = ?
        WHERE id = ? AND status = 'running'
      `,
    )
    .run(
      patch.pagesFound,
      patch.pagesProcessed,
      patch.pagesSkipped,
      patch.pagesFailed,
      patch.currentUrl,
      patch.truncated ? 1 : 0,
      updatedAt,
      id,
    );
}

export function finishCrawlRun(
  database: DatabaseSync,
  id: string,
  outcome: {
    status: Exclude<CrawlRunStatus, 'queued' | 'running'>;
    patch: CrawlProgressPatch;
    errorMessage: string | null;
    finishedAt: string;
  },
): boolean {
  const result = database
    .prepare(
      `
        UPDATE crawl_runs
        SET status = ?, pages_found = ?, pages_processed = ?, pages_skipped = ?, pages_failed = ?,
            current_url = NULL, error_message = ?, truncated = ?, finished_at = ?, updated_at = ?
        WHERE id = ? AND status = 'running'
      `,
    )
    .run(
      outcome.status,
      outcome.patch.pagesFound,
      outcome.patch.pagesProcessed,
      outcome.patch.pagesSkipped,
      outcome.patch.pagesFailed,
      outcome.errorMessage,
      outcome.patch.truncated ? 1 : 0,
      outcome.finishedAt,
      outcome.finishedAt,
      id,
    );
  return Number(result.changes) > 0;
}

export function markCrawlCancelled(database: DatabaseSync, id: string, finishedAt: string): boolean {
  const result = database
    .prepare(
      `
        UPDATE crawl_runs
        SET status = 'cancelled', current_url = NULL, error_message = ?, finished_at = ?, updated_at = ?
        WHERE id = ? AND status IN ('queued', 'running')
      `,
    )
    .run('Запуск отменён', finishedAt, finishedAt, id);
  return Number(result.changes) > 0;
}

export function updateCancelledProgress(database: DatabaseSync, id: string, patch: CrawlProgressPatch, updatedAt: string): void {
  database
    .prepare(
      `
        UPDATE crawl_runs
        SET pages_found = ?, pages_processed = ?, pages_skipped = ?, pages_failed = ?,
            truncated = ?, updated_at = ?
        WHERE id = ? AND status = 'cancelled'
      `,
    )
    .run(
      patch.pagesFound,
      patch.pagesProcessed,
      patch.pagesSkipped,
      patch.pagesFailed,
      patch.truncated ? 1 : 0,
      updatedAt,
      id,
    );
}

export function failInterruptedRun(database: DatabaseSync, id: string, finishedAt: string, message: string): boolean {
  const result = database
    .prepare(
      `
        UPDATE crawl_runs
        SET status = 'failed', current_url = NULL, error_message = ?, finished_at = ?, updated_at = ?
        WHERE id = ? AND status IN ('queued', 'running')
      `,
    )
    .run(message, finishedAt, finishedAt, id);
  return Number(result.changes) > 0;
}

export interface NewCrawlPage {
  id: string;
  runId: string;
  projectId: string;
  url: string;
  finalUrl: string | null;
  status: CrawlPageStatus;
  httpStatus: number | null;
  title: string | null;
  description: string | null;
  text: string | null;
  excerpt: string | null;
  errorMessage: string | null;
  skipReason: string | null;
  fetchedAt: string;
}

export function insertCrawlPage(database: DatabaseSync, page: NewCrawlPage): void {
  database
    .prepare(
      `
        INSERT INTO crawl_pages (
          id, run_id, project_id, url, final_url, status, http_status, title, description,
          text_content, excerpt, error_message, skip_reason, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      page.id,
      page.runId,
      page.projectId,
      page.url,
      page.finalUrl,
      page.status,
      page.httpStatus,
      page.title,
      page.description,
      page.text,
      page.excerpt,
      page.errorMessage,
      page.skipReason,
      page.fetchedAt,
    );
}

export function insertCrawlLink(
  database: DatabaseSync,
  link: { pageId: string; href: string; text: string | null; relation: CrawlLinkRelation },
): void {
  database
    .prepare('INSERT INTO crawl_links (id, page_id, href, link_text, relation) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), link.pageId, link.href, link.text, link.relation);
}

export function insertCrawlImage(
  database: DatabaseSync,
  image: { id: string; pageId: string; sourceUrl: string; alt: string | null },
): void {
  database
    .prepare(
      `
        INSERT INTO crawl_images (id, page_id, source_url, alt_text, stored_name, content_type, byte_size, error_message)
        VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL)
      `,
    )
    .run(image.id, image.pageId, image.sourceUrl, image.alt);
}

export function updateCrawlImage(
  database: DatabaseSync,
  image: {
    id: string;
    storedName: string | null;
    contentType: string | null;
    byteSize: number | null;
    errorMessage: string | null;
  },
): void {
  database
    .prepare(
      `
        UPDATE crawl_images
        SET stored_name = ?, content_type = ?, byte_size = ?, error_message = ?
        WHERE id = ?
      `,
    )
    .run(image.storedName, image.contentType, image.byteSize, image.errorMessage, image.id);
}

export function listCrawlPages(
  database: DatabaseSync,
  runId: string,
  filter: { query?: string; status?: CrawlPageStatus },
): CrawlPageSummary[] {
  const rows = database
    .prepare(
      `
        SELECT id, run_id, url, final_url, status, http_status, title, description,
               NULL AS text_content, excerpt, error_message, skip_reason, fetched_at
        FROM crawl_pages
        WHERE run_id = ?
        ORDER BY fetched_at ASC, url ASC
      `,
    )
    .all(runId)
    .map((item) => mapPage(asRow<PageRow>(item) as PageRow));
  const query = filter.query?.toLocaleLowerCase('ru-RU');
  return rows.filter((page) => {
    if (filter.status && page.status !== filter.status) {
      return false;
    }
    if (!query) {
      return true;
    }
    const haystack = `${page.title ?? ''} ${page.url}`.toLocaleLowerCase('ru-RU');
    return haystack.includes(query);
  });
}

export function getCrawlPage(database: DatabaseSync, runId: string, pageId: string, projectId: string): CrawlPageDetail | null {
  const row = asRow<PageRow>(
    database
      .prepare(
        `
          SELECT id, run_id, url, final_url, status, http_status, title, description,
                 text_content, excerpt, error_message, skip_reason, fetched_at
          FROM crawl_pages
          WHERE id = ? AND run_id = ?
        `,
      )
      .get(pageId, runId),
  );
  if (!row) {
    return null;
  }
  const summary = mapPage(row);
  const links = database
    .prepare('SELECT href, link_text, relation FROM crawl_links WHERE page_id = ? ORDER BY rowid ASC')
    .all(pageId)
    .map((item) => {
      const link = asRow<LinkRow>(item) as LinkRow;
      const relation: CrawlLinkRelation =
        link.relation === 'internal' || link.relation === 'external' || link.relation === 'skipped' ? link.relation : 'skipped';
      return { href: link.href, text: link.link_text ?? '', relation } satisfies CrawlLink;
    });
  const images = database
    .prepare(
      `
        SELECT id, source_url, alt_text, stored_name, content_type, byte_size, error_message
        FROM crawl_images
        WHERE page_id = ?
        ORDER BY rowid ASC
      `,
    )
    .all(pageId)
    .map((item) => mapImage(asRow<ImageRow>(item) as ImageRow, projectId, runId));
  return { ...summary, text: row.text_content, links, images };
}

function mapImage(row: ImageRow, projectId: string, runId: string): CrawlImage {
  const stored = Boolean(row.stored_name);
  return {
    id: row.id,
    sourceUrl: row.source_url,
    alt: row.alt_text,
    contentType: row.content_type,
    byteSize: row.byte_size,
    stored,
    downloadUrl: stored ? `/api/projects/${projectId}/crawls/${runId}/images/${row.id}` : null,
    errorMessage: row.error_message,
  };
}

export function getCrawlSummary(database: DatabaseSync, run: CrawlRun): CrawlSummary {
  const rows = database
    .prepare(
      `
        SELECT url, status, error_message, skip_reason
        FROM crawl_pages
        WHERE run_id = ?
        ORDER BY fetched_at ASC, url ASC
      `,
    )
    .all(run.id) as { url?: string; status?: string; error_message?: string | null; skip_reason?: string | null }[];
  const errors: CrawlSummary['errors'] = [];
  const skipped: CrawlSummary['skipped'] = [];
  for (const row of rows) {
    if (!row.url) {
      continue;
    }
    if (row.status === 'error' && errors.length < 100) {
      errors.push({ url: row.url, message: row.error_message || 'Страница не собрана' });
    }
    if (row.status === 'skipped' && skipped.length < 100) {
      skipped.push({ url: row.url, reason: row.skip_reason || 'Страница пропущена' });
    }
  }
  return {
    pagesFound: run.pagesFound,
    pagesProcessed: run.pagesProcessed,
    pagesSkipped: run.pagesSkipped,
    pagesFailed: run.pagesFailed,
    truncated: run.truncated,
    errors,
    skipped,
  };
}

export function findStoredImage(
  database: DatabaseSync,
  runId: string,
  imageId: string,
): { storedName: string; contentType: string } | null {
  const row = asRow<{ stored_name: string | null; content_type: string | null }>(
    database
      .prepare(
        `
          SELECT image.stored_name, image.content_type
          FROM crawl_images image
          JOIN crawl_pages page ON page.id = image.page_id
          WHERE image.id = ? AND page.run_id = ?
        `,
      )
      .get(imageId, runId),
  );
  if (!row?.stored_name || !row.content_type) {
    return null;
  }
  return { storedName: row.stored_name, contentType: row.content_type };
}
