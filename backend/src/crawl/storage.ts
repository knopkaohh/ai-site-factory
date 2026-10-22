import { mkdirSync } from 'node:fs';
import path from 'node:path';

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function assertStorageId(value: string): void {
  if (!ID_PATTERN.test(value)) {
    throw new Error('Недопустимый идентификатор хранилища');
  }
}

export function crawlProjectDirectory(root: string, projectId: string): string {
  assertStorageId(projectId);
  const directory = path.resolve(root, projectId);
  const relative = path.relative(path.resolve(root), directory);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Недопустимый путь хранилища');
  }
  return directory;
}

export function crawlRunDirectory(root: string, projectId: string, runId: string): string {
  assertStorageId(runId);
  const directory = path.resolve(crawlProjectDirectory(root, projectId), runId);
  const relative = path.relative(path.resolve(root), directory);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Недопустимый путь хранилища');
  }
  return directory;
}

export function ensureCrawlDirectory(root: string, projectId: string, runId: string): string {
  const directory = crawlRunDirectory(root, projectId, runId);
  mkdirSync(path.join(directory, 'pages'), { recursive: true });
  mkdirSync(path.join(directory, 'images'), { recursive: true });
  return directory;
}

export function storedFilePath(runDirectory: string, kind: 'pages' | 'images', name: string): string {
  if (!/^[0-9a-f-]{36}\.(html|jpg|png|gif|webp)$/iu.test(name)) {
    throw new Error('Недопустимое имя файла');
  }
  const filePath = path.resolve(runDirectory, kind, name);
  const relative = path.relative(path.resolve(runDirectory), filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Недопустимый путь файла');
  }
  return filePath;
}
