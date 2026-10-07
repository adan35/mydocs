import type { FileType } from './names';

/** A time range in epoch ms; either end may be open. */
export interface DateRange {
  from?: number;
  to?: number;
}

/**
 * A search query split into free text and operators:
 * `tag:x`, `folder:x` (or `path:`), `type:md`, `created:…`, `modified:…`,
 * `"exact phrase"` and `-excluded`. Unknown `word:` prefixes stay free text.
 */
export interface ParsedQuery {
  /** Free text for the ranked full-text search. */
  text: string;
  phrases: string[];
  exclude: string[];
  tags: string[];
  folders: string[];
  types: FileType[];
  created?: DateRange;
  modified?: DateRange;
  /** True when any operator other than free text was used. */
  hasOperators: boolean;
}

const TYPE_ALIASES: Record<string, FileType[]> = {
  md: ['markdown'],
  markdown: ['markdown'],
  note: ['markdown'],
  txt: ['text'],
  text: ['text'],
  code: ['code'],
  data: ['data'],
  json: ['data'],
  csv: ['data'],
  image: ['image'],
  img: ['image'],
  images: ['image'],
  pdf: ['pdf'],
  other: ['binary'],
  binary: ['binary'],
};

const DAY = 86_400_000;

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Parses `2026-10-05`, `2026-10` or `2026` into the range that period covers (local time). */
function periodRange(value: string): DateRange | null {
  const m = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = m[2] ? Number(m[2]) - 1 : null;
  const d = m[3] ? Number(m[3]) : null;
  if (mo !== null && (mo < 0 || mo > 11)) return null;
  if (d !== null && (d < 1 || d > 31)) return null;
  if (d !== null)
    return { from: new Date(y, mo!, d).getTime(), to: new Date(y, mo!, d + 1).getTime() - 1 };
  if (mo !== null)
    return { from: new Date(y, mo, 1).getTime(), to: new Date(y, mo + 1, 1).getTime() - 1 };
  return { from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime() - 1 };
}

/**
 * Date values: `today`, `yesterday`, `week` / `month` / `year` (the last 7, 30 or 365
 * days), `7d` / `2w` / `3m` (relative), a period like `2026-10`, or a comparison
 * like `>2026-10-01` / `<=2026-09`.
 */
export function parseDateRange(raw: string, now = Date.now()): DateRange | null {
  const value = raw.trim().toLowerCase();
  const today = startOfDay(now);
  switch (value) {
    case 'today':
      return { from: today };
    case 'yesterday':
      return { from: today - DAY, to: today - 1 };
    case 'week':
      return { from: today - 6 * DAY };
    case 'month':
      return { from: today - 29 * DAY };
    case 'year':
      return { from: today - 364 * DAY };
  }
  const rel = /^(\d+)([dwmy])$/.exec(value);
  if (rel) {
    const n = Number(rel[1]);
    const days = { d: 1, w: 7, m: 30, y: 365 }[rel[2] as 'd' | 'w' | 'm' | 'y'] * n;
    return { from: today - (days - 1) * DAY };
  }
  const cmp = /^(>=|<=|>|<)(.+)$/.exec(value);
  if (cmp) {
    const period = periodRange(cmp[2]!);
    if (!period) return null;
    switch (cmp[1]) {
      case '>':
        return { from: period.to! + 1 };
      case '>=':
        return { from: period.from };
      case '<':
        return { to: period.from! - 1 };
      default:
        return { to: period.to };
    }
  }
  return periodRange(value);
}

export function inRange(t: number, r: DateRange | undefined): boolean {
  if (!r) return true;
  return (r.from === undefined || t >= r.from) && (r.to === undefined || t <= r.to);
}

/** Splits into tokens, keeping quoted strings (and `op:"quoted value"`) together. */
function tokenize(q: string): string[] {
  const out: string[] = [];
  const re = /(-?[\w-]+:"[^"]*"?|-?"[^"]*"?|\S+)/g;
  for (const m of q.matchAll(re)) out.push(m[0]);
  return out;
}

const unquote = (s: string) => s.replace(/^"/, '').replace(/"$/, '');

export function parseQuery(q: string, now = Date.now()): ParsedQuery {
  const parsed: ParsedQuery = {
    text: '',
    phrases: [],
    exclude: [],
    tags: [],
    folders: [],
    types: [],
    hasOperators: false,
  };
  const free: string[] = [];
  for (const token of tokenize(q)) {
    const op = /^([a-z]+):(.+)$/i.exec(token);
    if (op) {
      const key = op[1]!.toLowerCase();
      const value = unquote(op[2]!).trim();
      if (!value) continue;
      if (key === 'tag') {
        parsed.tags.push(value.replace(/^#/, '').toLowerCase());
        parsed.hasOperators = true;
        continue;
      }
      if (key === 'folder' || key === 'path' || key === 'in') {
        parsed.folders.push(value.replace(/^\/+|\/+$/g, '').toLowerCase());
        parsed.hasOperators = true;
        continue;
      }
      if (key === 'type' || key === 'ext') {
        const types = TYPE_ALIASES[value.toLowerCase()];
        if (types) {
          parsed.types.push(...types);
          parsed.hasOperators = true;
          continue;
        }
      }
      if (key === 'created' || key === 'modified' || key === 'updated' || key === 'edited') {
        const range = parseDateRange(value, now);
        if (range) {
          if (key === 'created') parsed.created = range;
          else parsed.modified = range;
          parsed.hasOperators = true;
          continue;
        }
      }
    }
    if (token.startsWith('"')) {
      const phrase = unquote(token).trim();
      if (phrase) {
        parsed.phrases.push(phrase);
        parsed.hasOperators = true;
      }
      continue;
    }
    if (token.startsWith('-') && token.length > 1) {
      parsed.exclude.push(unquote(token.slice(1)).toLowerCase());
      parsed.hasOperators = true;
      continue;
    }
    if (/^#[\p{L}\p{N}_/-]+$/u.test(token)) {
      parsed.tags.push(token.slice(1).toLowerCase());
      parsed.hasOperators = true;
      continue;
    }
    free.push(token);
  }
  parsed.text = free.join(' ');
  return parsed;
}
