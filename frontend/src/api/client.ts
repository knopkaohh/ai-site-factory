import type { ApiErrorBody, FieldError, HealthReport, ProjectDetail, ProjectInput, ProjectList, ProjectPatch, ProjectStatus } from '../shared';

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
    body: JSON.stringify(input),
  });
}

export function getProject(id: string, signal?: AbortSignal): Promise<ProjectDetail> {
  return apiRequest<ProjectDetail>(`/api/projects/${id}`, { signal });
}

export function updateProject(id: string, patch: ProjectPatch): Promise<ProjectDetail> {
  return apiRequest<ProjectDetail>(`/api/projects/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteProject(id: string): Promise<void> {
  return apiRequest<void>(`/api/projects/${id}`, { method: 'DELETE' });
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
