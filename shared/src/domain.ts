export type DomainResult =
  | { ok: true; domain: string }
  | { ok: false; message: string };

const LABEL_PATTERN = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?$/u;

function fail(message: string): DomainResult {
  return { ok: false, message };
}

function isIpHostname(hostname: string): boolean {
  if (hostname.includes(':')) {
    return true;
  }
  const parts = hostname.split('.');
  if (parts.length !== 4) {
    return false;
  }
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/**
 * Приводит ввод пользователя к домену без протокола, порта, пути и запроса.
 * Кириллические домены сохраняются в Unicode в нижнем регистре.
 * Сайт при этом не загружается.
 */
export function normalizeSourceDomain(input: string): DomainResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return fail('Укажите домен исходного сайта');
  }
  if (/\s/u.test(trimmed)) {
    return fail('Домен не должен содержать пробелы');
  }

  let remainder = trimmed;
  const schemeMatch = remainder.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
  if (schemeMatch?.[1]) {
    const protocol = schemeMatch[1].toLowerCase();
    if (protocol !== 'http' && protocol !== 'https') {
      return fail('Допустим адрес только с протоколом http или https');
    }
    remainder = remainder.slice(schemeMatch[0].length);
  }

  if (remainder.includes('@')) {
    return fail('Укажите домен без логина и пароля');
  }

  const hostAndPort = remainder.split(/[/?#]/u)[0] ?? '';
  if (!hostAndPort || hostAndPort.startsWith('[')) {
    return fail('Укажите доменное имя, например example.com');
  }

  const withoutPort = hostAndPort.replace(/:\d+$/u, '').replace(/\.$/u, '');
  const domain = withoutPort.toLocaleLowerCase('ru-RU');
  if (!domain || domain.includes(':') || domain.includes('..')) {
    return fail('Укажите полное доменное имя, например example.com');
  }

  let parsed: URL;
  try {
    parsed = new URL(`https://${domain}`);
  } catch {
    return fail('Не удалось разобрать домен. Пример: example.com');
  }

  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    return fail('Укажите домен без пути, логина и лишних символов');
  }

  const asciiHost = parsed.hostname.toLowerCase().replace(/\.$/u, '');
  if (!asciiHost || isIpHostname(asciiHost) || asciiHost === 'localhost') {
    return fail('Укажите доменное имя, а не IP-адрес или localhost');
  }

  const labels = domain.split('.');
  const asciiLabels = asciiHost.split('.');
  if (labels.length < 2 || asciiLabels.length !== labels.length) {
    return fail('Укажите полное доменное имя, например example.com');
  }
  if (asciiHost.length > 253) {
    return fail('Домен слишком длинный');
  }

  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index];
    const asciiLabel = asciiLabels[index];
    if (!label || !asciiLabel || !LABEL_PATTERN.test(label) || asciiLabel.length > 63) {
      return fail('Домен содержит недопустимые символы');
    }
  }

  const tld = labels[labels.length - 1];
  if (!tld || tld.length < 2 || /^\d+$/u.test(tld)) {
    return fail('Укажите полное доменное имя, например example.com');
  }

  return { ok: true, domain };
}

export function foldSearchText(value: string): string {
  return value.trim().toLocaleLowerCase('ru-RU');
}
