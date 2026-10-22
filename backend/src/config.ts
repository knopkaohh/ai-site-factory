import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORM_VERSION } from '../../shared/src/index';

export interface AppConfig {
  port: number;
  databasePath: string;
  databaseLocation: string;
  version: string;
  appRoot: string;
  frontendDist: string;
}

export function resolveAppRoot(moduleUrl = import.meta.url): string {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), '../..');
}

export function displayDatabaseLocation(databasePath: string, appRoot: string): string {
  if (databasePath === ':memory:') {
    return ':memory:';
  }
  const relative = path.relative(appRoot, databasePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return 'пользовательский путь';
  }
  return relative.split(path.sep).join('/');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, moduleUrl = import.meta.url): AppConfig {
  const appRoot = resolveAppRoot(moduleUrl);
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT должен быть целым числом от 1 до 65535');
  }
  const databasePath = env.DATABASE_PATH
    ? path.resolve(appRoot, env.DATABASE_PATH)
    : path.join(appRoot, 'backend', 'data', 'app.db');

  return {
    port,
    databasePath,
    databaseLocation: displayDatabaseLocation(databasePath, appRoot),
    version: PLATFORM_VERSION,
    appRoot,
    frontendDist: path.join(appRoot, 'frontend', 'dist'),
  };
}
