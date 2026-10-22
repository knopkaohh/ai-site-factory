interface RobotRule {
  allow: boolean;
  pattern: string;
}

interface RobotGroup {
  agents: string[];
  rules: RobotRule[];
  sitemaps: string[];
}

export function parseRobots(text: string): { groups: RobotGroup[]; sitemaps: string[] } {
  const groups: RobotGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotGroup | null = null;
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.replace(/#.*$/u, '').trim();
    if (!line) {
      continue;
    }
    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === 'sitemap' && value) {
      sitemaps.push(value);
      continue;
    }
    if (key === 'user-agent') {
      const agent = value.toLowerCase();
      if (!current || current.rules.length > 0) {
        current = { agents: [agent], rules: [], sitemaps: [] };
        groups.push(current);
      } else {
        current.agents.push(agent);
      }
      continue;
    }
    if ((key === 'allow' || key === 'disallow') && current) {
      current.rules.push({ allow: key === 'allow', pattern: value });
    }
  }
  return { groups, sitemaps };
}

export function extractSitemapLocs(xml: string): string[] {
  const locs: string[] = [];
  const pattern = /<loc>\s*([^<]+?)\s*<\/loc>/giu;
  for (const match of xml.matchAll(pattern)) {
    const value = match[1]?.trim();
    if (value) {
      locs.push(value.replace(/&amp;/gu, '&'));
    }
  }
  return locs;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function ruleMatches(pattern: string, path: string): boolean {
  if (!pattern) {
    return false;
  }
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const expression = `^${body.split('*').map((part) => escapeRegex(part)).join('.*')}${anchored ? '$' : ''}`;
  return new RegExp(expression, 'u').test(path);
}

export function isAllowedByRobots(robotsText: string, urlPath: string, userAgent: string): boolean {
  const { groups } = parseRobots(robotsText);
  const agent = userAgent.toLowerCase();
  const named = groups.filter((group) => group.agents.some((item) => item !== '*' && agent.includes(item)));
  const chosen = named.length > 0 ? named : groups.filter((group) => group.agents.includes('*'));
  let winner: { length: number; allow: boolean } | null = null;
  for (const group of chosen) {
    for (const rule of group.rules) {
      if (!ruleMatches(rule.pattern, urlPath)) {
        continue;
      }
      const length = rule.pattern.replace(/\$$/u, '').length;
      if (!winner || length > winner.length || (length === winner.length && rule.allow)) {
        winner = { length, allow: rule.allow };
      }
    }
  }
  return winner ? winner.allow : true;
}

export function robotsPath(url: URL): string {
  return `${url.pathname}${url.search}`;
}
