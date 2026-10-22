import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, type Dispatcher } from 'undici';
import { isBlockedIp } from './policy';

export const CRAWLER_USER_AGENT = 'AI-Site-Factory/0.2';

export interface FetchResult {
  finalUrl: string;
  status: number;
  contentType: string | null;
  body: Buffer;
}

export interface CrawlFetchOptions {
  signal: AbortSignal;
  maxBytes: number;
  timeoutMs: number;
  allowedHost?: string;
}

export interface CrawlFetcher {
  fetch(url: string, options: CrawlFetchOptions): Promise<FetchResult>;
}

export class CrawlRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrawlRequestError';
  }
}

type LookupFn = (hostname: string) => Promise<string[]>;
type FetchImpl = (url: string, init: { signal: AbortSignal; headers: Record<string, string>; dispatcher?: Dispatcher }) => Promise<Response>;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function createSafeFetcher(overrides?: { lookup?: LookupFn; fetchImpl?: FetchImpl; maxRedirects?: number }): CrawlFetcher {
  const resolve = overrides?.lookup ?? defaultLookup;
  const fetchImpl = overrides?.fetchImpl ?? defaultFetch;
  const maxRedirects = overrides?.maxRedirects ?? 5;

  return {
    async fetch(url, options) {
      let current = new URL(url);
      for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
        assertAllowedHost(current, options.allowedHost);
        await assertPublicDestination(current, resolve);
        const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]);
        const address = (await resolve(current.hostname))[0];
        if (!address) {
          throw new CrawlRequestError('Не удалось определить адрес сайта');
        }
        const agent = agentFor(address);
        try {
          const response = await fetchImpl(current.href, {
            signal,
            headers: {
              'user-agent': CRAWLER_USER_AGENT,
              accept: 'text/html,application/xhtml+xml,image/png,image/jpeg,image/gif,image/webp;q=0.8,*/*;q=0.1',
            },
            dispatcher: agent,
          });
          if (REDIRECT_STATUSES.has(response.status)) {
            const location = response.headers.get('location');
            await response.arrayBuffer().catch(() => undefined);
            if (!location) {
              throw new CrawlRequestError('Перенаправление без адреса');
            }
            current = new URL(location, current);
            continue;
          }
          const body = await readLimited(response, options.maxBytes, signal);
          return {
            finalUrl: current.href,
            status: response.status,
            contentType: response.headers.get('content-type'),
            body,
          };
        } catch (error) {
          if (error instanceof CrawlRequestError) {
            throw error;
          }
          if (signal.aborted && !options.signal.aborted) {
            throw new CrawlRequestError('Превышено время ожидания ответа');
          }
          if (options.signal.aborted) {
            throw error;
          }
          throw new CrawlRequestError(describeNetworkError(error));
        } finally {
          await agent.close();
        }
      }
      throw new CrawlRequestError('Слишком много перенаправлений');
    },
  };
}

function assertAllowedHost(url: URL, allowedHost: string | undefined): void {
  if (!allowedHost) {
    return;
  }
  if (url.hostname.toLowerCase() !== allowedHost.toLowerCase()) {
    throw new CrawlRequestError('Перенаправление за пределы разрешённого сайта');
  }
}

async function assertPublicDestination(url: URL, resolve: LookupFn): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CrawlRequestError('Разрешены только http и https');
  }
  if (url.username || url.password) {
    throw new CrawlRequestError('Адрес с логином запрещён');
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new CrawlRequestError('Локальный адрес запрещён');
  }
  if (isIP(host) && isBlockedIp(host)) {
    throw new CrawlRequestError('Недопустимый сетевой адрес');
  }
  const addresses = await resolve(host);
  if (addresses.length === 0 || addresses.some((address) => isBlockedIp(address))) {
    throw new CrawlRequestError('Адрес сайта указывает на недопустимую сеть');
  }
}

async function defaultLookup(hostname: string): Promise<string[]> {
  if (isIP(hostname)) {
    return [hostname];
  }
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

function defaultFetch(url: string, init: { signal: AbortSignal; headers: Record<string, string>; dispatcher?: Dispatcher }): Promise<Response> {
  return fetch(url, {
    redirect: 'manual',
    signal: init.signal,
    headers: init.headers,
    dispatcher: init.dispatcher,
  } as RequestInit);
}

function agentFor(address: string): Agent {
  const family = isIP(address) === 6 ? 6 : 4;
  return new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        const all = typeof options === 'object' && options !== null && 'all' in options && Boolean(options.all);
        if (all) {
          callback(null, [{ address, family }]);
          return;
        }
        callback(null, address, family);
      },
    },
  });
}

function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Сетевая ошибка';
  }
  const cause = error.cause instanceof Error ? error.cause : error;
  const code = 'code' in cause && typeof cause.code === 'string' ? cause.code : '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'Не удалось определить адрес сайта';
  }
  if (code === 'ECONNREFUSED') {
    return 'Сайт отклонил соединение';
  }
  if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ECONNABORTED') {
    return 'Соединение с сайтом прервано';
  }
  if (code.startsWith('ERR_SSL') || code.startsWith('CERT') || /ssl|tls|certificate|unrecognized name/iu.test(cause.message)) {
    return 'Не удалось установить защищённое соединение';
  }
  if (error.message && error.message !== 'fetch failed') {
    return error.message;
  }
  return 'Не удалось загрузить страницу';
}

async function readLimited(response: Response, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new CrawlRequestError('Ответ больше допустимого размера');
    }
    return buffer;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (!signal.aborted) {
      const step = await reader.read();
      if (step.done) {
        break;
      }
      const chunk = Buffer.from(step.value);
      total += chunk.length;
      if (total > maxBytes) {
        throw new CrawlRequestError('Ответ больше допустимого размера');
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export function imageExtension(contentType: string | null, body: Buffer): 'jpg' | 'png' | 'gif' | 'webp' | null {
  const type = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (type === 'image/jpeg' && body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) {
    return 'jpg';
  }
  if (type === 'image/png' && body.subarray(0, 4).toString('hex') === '89504e47') {
    return 'png';
  }
  if (type === 'image/gif' && body.subarray(0, 4).toString('ascii').startsWith('GIF8')) {
    return 'gif';
  }
  if (type === 'image/webp' && body.subarray(0, 4).toString('ascii') === 'RIFF' && body.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'webp';
  }
  return null;
}
