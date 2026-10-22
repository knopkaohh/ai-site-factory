import path from 'node:path';
import { resolveAppRoot } from '../config';
import { createSafeFetcher, type CrawlFetcher } from './fetcher';

export interface CrawlRuntime {
  fetcher: CrawlFetcher;
  storageRoot: string;
  delayMs: number;
}

let runtime: CrawlRuntime = {
  fetcher: createSafeFetcher(),
  storageRoot: path.join(resolveAppRoot(), 'backend', 'data', 'crawls'),
  delayMs: 200,
};

export function setCrawlRuntime(next: CrawlRuntime): void {
  runtime = next;
}

export function crawlRuntime(): CrawlRuntime {
  return runtime;
}
