import { load } from 'cheerio';
import { resolveCrawlUrl, type ResolvedCrawlUrl } from './policy';

export interface ExtractedLink {
  href: string;
  text: string;
  target: ResolvedCrawlUrl | null;
  fromFrame: boolean;
}

export interface ExtractedImage {
  src: string;
  alt: string;
  target: ResolvedCrawlUrl | null;
}

export interface ExtractedPage {
  title: string | null;
  description: string | null;
  text: string;
  links: ExtractedLink[];
  images: ExtractedImage[];
}

const TEXT_LIMIT = 100_000;

export function decodeHtml(buffer: Buffer, contentType: string | null): string {
  const headerCharset = charsetFrom(contentType);
  const preview = buffer.subarray(0, 4096).toString('latin1');
  const metaCharset = charsetFrom(preview);
  const charset = normalizeCharset(headerCharset || metaCharset || 'utf-8');
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buffer);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  }
}

function charsetFrom(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const match = /charset\s*=\s*["']?\s*([a-zA-Z0-9._-]+)/iu.exec(value);
  return match?.[1]?.toLowerCase() ?? null;
}

function normalizeCharset(value: string): string {
  const lower = value.toLowerCase();
  if (lower === 'utf8') {
    return 'utf-8';
  }
  if (lower === 'win-1251' || lower === 'cp1251' || lower === 'windows1251') {
    return 'windows-1251';
  }
  return lower;
}

export function looksLikeHtml(contentType: string | null, body: Buffer): boolean {
  const type = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (type === 'text/html' || type === 'application/xhtml+xml') {
    return true;
  }
  if (type && type !== 'text/plain' && type !== 'application/octet-stream') {
    return false;
  }
  const preview = body.subarray(0, 512).toString('latin1').toLowerCase();
  return preview.includes('<html') || preview.includes('<!doctype') || preview.includes('<frameset') || preview.includes('<frame');
}

export function extractPage(html: string, pageUrl: string, allowedHost: string): ExtractedPage {
  const $ = load(html);
  const baseHref = $('base[href]').first().attr('href');
  const base = baseHref ? new URL(baseHref, pageUrl).href : pageUrl;
  const title = clean($('title').first().text()) || null;
  const description =
    clean($('meta[name="description"]').attr('content') ?? '') ||
    clean($('meta[property="og:description"]').attr('content') ?? '') ||
    null;
  $('script, style, noscript, template').remove();
  const text = clean($('body').text() || $.root().text()).slice(0, TEXT_LIMIT);
  const links: ExtractedLink[] = [];
  const seen = new Set<string>();

  function pushLink(rawHref: string | undefined, textValue: string, fromFrame: boolean): void {
    if (!rawHref) {
      return;
    }
    const target = resolveCrawlUrl(rawHref, base, allowedHost);
    const key = `${fromFrame}:${target?.url.href ?? rawHref}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    links.push({ href: rawHref, text: clean(textValue).slice(0, 300), target, fromFrame });
  }

  $('a[href]').each((_index, element) => {
    const node = $(element);
    pushLink(node.attr('href'), node.text(), false);
  });
  $('frame[src], iframe[src]').each((_index, element) => {
    pushLink($(element).attr('src'), '', true);
  });

  const images: ExtractedImage[] = [];
  const seenImages = new Set<string>();
  $('img[src]').each((_index, element) => {
    const node = $(element);
    const src = node.attr('src');
    if (!src || seenImages.has(src)) {
      return;
    }
    seenImages.add(src);
    images.push({
      src,
      alt: clean(node.attr('alt') ?? '').slice(0, 300),
      target: resolveCrawlUrl(src, base, allowedHost),
    });
  });

  return { title, description, text, links, images };
}

function clean(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

export function excerpt(text: string, limit = 280): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit).trimEnd()}…`;
}
