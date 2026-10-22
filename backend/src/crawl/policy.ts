import { BlockList, isIP } from 'node:net';

const BLOCKED = new BlockList();
BLOCKED.addSubnet('0.0.0.0', 8, 'ipv4');
BLOCKED.addSubnet('10.0.0.0', 8, 'ipv4');
BLOCKED.addSubnet('100.64.0.0', 10, 'ipv4');
BLOCKED.addSubnet('127.0.0.0', 8, 'ipv4');
BLOCKED.addSubnet('169.254.0.0', 16, 'ipv4');
BLOCKED.addSubnet('172.16.0.0', 12, 'ipv4');
BLOCKED.addSubnet('192.0.0.0', 24, 'ipv4');
BLOCKED.addSubnet('192.0.2.0', 24, 'ipv4');
BLOCKED.addSubnet('192.168.0.0', 16, 'ipv4');
BLOCKED.addSubnet('198.18.0.0', 15, 'ipv4');
BLOCKED.addSubnet('198.51.100.0', 24, 'ipv4');
BLOCKED.addSubnet('203.0.113.0', 24, 'ipv4');
BLOCKED.addSubnet('224.0.0.0', 4, 'ipv4');
BLOCKED.addSubnet('240.0.0.0', 4, 'ipv4');
BLOCKED.addAddress('255.255.255.255', 'ipv4');
BLOCKED.addAddress('::', 'ipv6');
BLOCKED.addAddress('::1', 'ipv6');
BLOCKED.addSubnet('fc00::', 7, 'ipv6');
BLOCKED.addSubnet('fe80::', 10, 'ipv6');
BLOCKED.addSubnet('ff00::', 8, 'ipv6');

const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal', 'metadata.internal']);

const DOCUMENT_EXTENSIONS = new Set(['', 'html', 'htm', 'shtml', 'php', 'asp', 'aspx', 'jsp', 'cgi']);
const SKIPPED_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif',
  'css', 'js', 'mjs', 'map', 'json', 'xml', 'pdf', 'zip', 'gz', 'rar', '7z',
  'exe', 'dmg', 'msi', 'bin', 'iso', 'apk',
  'mp3', 'mp4', 'webm', 'wav', 'avi', 'mov',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
]);

export function isBlockedIp(address: string): boolean {
  const normalized = unwrapMappedIpv4(address.trim().toLowerCase());
  const family = isIP(normalized);
  if (family === 0) {
    return true;
  }
  return BLOCKED.check(normalized, family === 4 ? 'ipv4' : 'ipv6');
}

function unwrapMappedIpv4(address: string): string {
  const mapped = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u);
  return mapped?.[1] ?? address;
}

export function asciiHost(domainOrHost: string): string {
  return new URL(`https://${domainOrHost}`).hostname.toLowerCase();
}

export interface ResolvedCrawlUrl {
  url: URL;
  sameSite: boolean;
  document: boolean;
}

export function resolveCrawlUrl(input: string, base: string, allowedHost: string): ResolvedCrawlUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(input, base);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }
  if (parsed.username || parsed.password) {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/u, '');
  if (!host || BLOCKED_HOSTS.has(host) || host.endsWith('.localhost') || host.endsWith('.local')) {
    return null;
  }
  if (/^\d+$/u.test(host)) {
    return null;
  }
  parsed.hash = '';
  if (parsed.pathname === '') {
    parsed.pathname = '/';
  }
  const allowed = allowedHost.toLowerCase();
  return {
    url: parsed,
    sameSite: host === allowed,
    document: isDocumentPath(parsed.pathname),
  };
}

export function isDocumentPath(pathname: string): boolean {
  const last = pathname.split('/').pop() ?? '';
  if (!last.includes('.')) {
    return true;
  }
  const extension = last.split('.').pop()?.toLowerCase() ?? '';
  if (SKIPPED_EXTENSIONS.has(extension)) {
    return false;
  }
  return DOCUMENT_EXTENSIONS.has(extension);
}

export function shouldQueue(target: ResolvedCrawlUrl, fromFrame: boolean): boolean {
  if (!target.sameSite) {
    return false;
  }
  return fromFrame || target.document;
}
