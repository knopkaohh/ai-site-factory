const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const compactDateTimeFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function asDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: string): string {
  const date = asDate(value);
  return date ? dateFormat.format(date) : value;
}

export function formatDateTime(value: string): string {
  const date = asDate(value);
  return date ? dateTimeFormat.format(date) : value;
}

export function formatCompactDateTime(value: string): string {
  const date = asDate(value);
  return date ? compactDateTimeFormat.format(date) : value;
}
