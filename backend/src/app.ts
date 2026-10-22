import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { resolveAppRoot } from './config';
import type { CrawlFetcher } from './crawl/fetcher';
import { createSafeFetcher } from './crawl/fetcher';
import { setCrawlRuntime } from './crawl/runtime';
import { errorHandler } from './http/errors';
import { healthHandler } from './http/routes/health';
import { createProjectRouter } from './http/routes/projects';
import { createSettingsRouter } from './http/routes/settings';

export interface AppDependencies {
  database: DatabaseSync;
  version: string;
  databaseLocation: string;
  frontendDist?: string;
  crawl?: {
    fetcher?: CrawlFetcher;
    storageRoot?: string;
    delayMs?: number;
  };
}

export function createApp(dependencies: AppDependencies): Express {
  setCrawlRuntime({
    fetcher: dependencies.crawl?.fetcher ?? createSafeFetcher(),
    storageRoot: dependencies.crawl?.storageRoot ?? path.join(resolveAppRoot(), 'backend', 'data', 'crawls'),
    delayMs: dependencies.crawl?.delayMs ?? 200,
  });
  const app = express();
  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  app.use((request, response, next) => {
    const started = Date.now();
    response.on('finish', () => {
      if (request.path.startsWith('/api')) {
        console.log(`${request.method} ${request.path} ${response.statusCode} ${Date.now() - started}ms`);
      }
    });
    next();
  });

  app.get('/api/health', (request, response) => {
    healthHandler(dependencies.database, dependencies.version, dependencies.databaseLocation, request, response);
  });
  app.use('/api/projects', createProjectRouter(dependencies.database));
  app.use('/api/settings', createSettingsRouter(dependencies.database));
  app.use('/api', (_request, response) => {
    response.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Метод API не найден' },
    });
  });

  const indexFile = dependencies.frontendDist ? path.join(dependencies.frontendDist, 'index.html') : '';
  if (indexFile && existsSync(indexFile)) {
    app.use(express.static(dependencies.frontendDist as string));
    app.use((request, response, next) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        next();
        return;
      }
      response.sendFile(indexFile, (error) => {
        if (error) {
          next(error);
        }
      });
    });
  }

  app.use(errorHandler);
  return app;
}
