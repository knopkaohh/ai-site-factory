import { CRAWL_PAGE_LIMIT_DEFAULT } from '../../../shared/src/index';

export const CRAWL_DEFAULTS = {
  pageLimit: CRAWL_PAGE_LIMIT_DEFAULT,
  maxResponseBytes: 2_000_000,
  requestTimeoutMs: 15_000,
  runTimeoutMs: 8 * 60 * 1000,
  maxImageBytes: 2_000_000,
  maxImagesPerPage: 12,
} as const;

export const CRAWL_MAX_SITEMAPS = 4;
export const CRAWL_MAX_LINKS = 200;
export const CRAWL_MAX_IMAGE_ROWS = 40;
