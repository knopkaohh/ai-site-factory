import type {
  ApiErrorBody,
  CrawlPageDetail,
  CrawlPageStatus,
  CrawlPageSummary,
  CrawlRun,
  CrawlSettings,
  CrawlSummary,
  FieldError,
  HealthReport,
  ProjectDetail,
  ProjectInput,
  ProjectList,
  ProjectPatch,
  ProjectStatus,
} from '../shared';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: FieldError[];

  constructor(status: number, code: string, message: string, details: FieldError[] = []) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function errorFrom(response: Response, body: unknown): ApiRequestError {
  const record = body && typeof body === 'object' ? (body as Partial<ApiErrorBody>) : null;
  const fallback =
    response.status >= 500
      ? 'Не удалось связаться с сервером. Проверьте, что backend запущен.'
      : 'Сервер вернул ошибку';
  return new ApiRequestError(
    response.status,
    record?.error?.code ?? 'HTTP_ERROR',
    record?.error?.message ?? fallback,
    record?.error?.details ?? [],
  );
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiRequestError(0, 'NETWORK', 'Не удалось связаться с сервером. Проверьте, что backend запущен.');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const body = await readJson(response);
  if (!response.ok) {
    throw errorFrom(response, body);
  }
  if (!body || typeof body !== 'object' || !('data' in body)) {
    throw new ApiRequestError(response.status, 'BAD_RESPONSE', 'Сервер вернул неожиданный ответ');
  }
  return (body as { data: T }).data;
}

export function listProjects(params: { query?: string; status?: ProjectStatus }, signal?: AbortSignal): Promise<ProjectList> {
  const search = new URLSearchParams();
  if (params.query) {
    search.set('q', params.query);
  }
  if (params.status) {
    search.set('status', params.status);
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : '';
  return apiRequest<ProjectList>(`/api/projects${suffix}`, { signal });
}

export function createProject(input: ProjectInput): Promise<ProjectDetail> {
  return apiRequest<ProjectDetail>('/api/projects', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      sourceDomain: input.sourceUrl,
      brief: input.brief,
      requirements: input.requirements,
      mode: input.mode,
    }),
  });
}

export function getProject(id: string, signal?: AbortSignal): Promise<ProjectDetail> {
  return apiRequest<ProjectDetail>(`/api/projects/${id}`, { signal });
}

export function updateProject(id: string, patch: ProjectPatch): Promise<ProjectDetail> {
  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    body.name = patch.name;
  }
  if (patch.sourceUrl !== undefined) {
    body.sourceDomain = patch.sourceUrl;
  } else if (patch.sourceDomain !== undefined) {
    body.sourceDomain = patch.sourceDomain;
  }
  if (patch.brief !== undefined) {
    body.brief = patch.brief;
  }
  if (patch.requirements !== undefined) {
    body.requirements = patch.requirements;
  }
  if (patch.mode !== undefined) {
    body.mode = patch.mode;
  }
  return apiRequest<ProjectDetail>(`/api/projects/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteProject(id: string): Promise<void> {
  return apiRequest<void>(`/api/projects/${id}`, { method: 'DELETE' });
}

export function startCrawl(projectId: string): Promise<CrawlRun> {
  return apiRequest<CrawlRun>(`/api/projects/${projectId}/crawls`, { method: 'POST' });
}

export function listCrawls(projectId: string, signal?: AbortSignal): Promise<CrawlRun[]> {
  return apiRequest<CrawlRun[]>(`/api/projects/${projectId}/crawls`, { signal });
}

export function getCrawl(projectId: string, runId: string, signal?: AbortSignal): Promise<CrawlRun> {
  return apiRequest<CrawlRun>(`/api/projects/${projectId}/crawls/${runId}`, { signal });
}

export function getCrawlSummary(projectId: string, runId: string, signal?: AbortSignal): Promise<CrawlSummary> {
  return apiRequest<CrawlSummary>(`/api/projects/${projectId}/crawls/${runId}/summary`, { signal });
}

export function listCrawlPages(
  projectId: string,
  runId: string,
  params: { query?: string; status?: CrawlPageStatus },
  signal?: AbortSignal,
): Promise<CrawlPageSummary[]> {
  const search = new URLSearchParams();
  if (params.query) {
    search.set('q', params.query);
  }
  if (params.status) {
    search.set('status', params.status);
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : '';
  return apiRequest<CrawlPageSummary[]>(`/api/projects/${projectId}/crawls/${runId}/pages${suffix}`, { signal });
}

export function getCrawlPage(projectId: string, runId: string, pageId: string, signal?: AbortSignal): Promise<CrawlPageDetail> {
  return apiRequest<CrawlPageDetail>(`/api/projects/${projectId}/crawls/${runId}/pages/${pageId}`, { signal });
}

export function cancelCrawl(projectId: string, runId: string): Promise<CrawlRun> {
  return apiRequest<CrawlRun>(`/api/projects/${projectId}/crawls/${runId}/cancel`, { method: 'POST' });
}

export function getCrawlSettings(signal?: AbortSignal): Promise<CrawlSettings> {
  return apiRequest<CrawlSettings>('/api/settings/crawl', { signal });
}

export function updateCrawlSettings(pageLimit: number): Promise<CrawlSettings> {
  return apiRequest<CrawlSettings>('/api/settings/crawl', {
    method: 'PATCH',
    body: JSON.stringify({ pageLimit }),
  });
}

export async function getHealth(signal?: AbortSignal): Promise<HealthReport> {
  let response: Response;
  try {
    response = await fetch('/api/health', {
      signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiRequestError(0, 'NETWORK', 'Не удалось связаться с сервером. Проверьте, что backend запущен.');
  }
  const body = await readJson(response);
  if (body && typeof body === 'object' && 'data' in body) {
    return (body as { data: HealthReport }).data;
  }
  throw errorFrom(response, body);
}
