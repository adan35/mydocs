import { parseFrontMatter, withFrontMatter, type FrontMatter } from './frontmatter';
import { splitFrontMatter } from './markdown-scan';
import { sanitizeName } from './names';
import { isValidTag, normalizeTag } from './tags';

/**
 * A note is an ordinary Markdown file in the Notes folder. Its look and state live in
 * front matter (color, pin, archive, labels as `tags`, reminder, order); its content is
 * plain text or a `- [ ]` task list, followed by image lines. Search, tags, trash, backup
 * and export therefore treat notes like any other document.
 */

export const NOTE_COLORS = [
  'default',
  'coral',
  'peach',
  'sand',
  'mint',
  'sage',
  'fog',
  'storm',
  'dusk',
  'blossom',
  'clay',
  'chalk',
] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export const REPEATS = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type Repeat = (typeof REPEATS)[number];

export interface NoteItem {
  text: string;
  done: boolean;
}

export interface NoteData {
  title: string;
  /** Body of a text note (empty for a checklist). */
  text: string;
  /** Checklist items; `null` for a text note. */
  items: NoteItem[] | null;
  /** Image paths exactly as written in the Markdown, relative to the Notes folder. */
  images: string[];
  color: NoteColor;
  pinned: boolean;
  archived: boolean;
  labels: string[];
  /** Epoch milliseconds. */
  reminder: number | null;
  repeat: Repeat | null;
  /** Position among the other notes; lower comes first. */
  order: number | null;
}

export const emptyNote = (): NoteData => ({
  title: '',
  text: '',
  items: null,
  images: [],
  color: 'default',
  pinned: false,
  archived: false,
  labels: [],
  reminder: null,
  repeat: null,
  order: null,
});

const KNOWN_KEYS = [
  'title',
  'color',
  'pinned',
  'archived',
  'tags',
  'tag',
  'reminder',
  'repeat',
  'order',
];
const IMAGE_LINE = /^!\[[^\]]*\]\(([^)]+)\)$/;
const TASK_LINE = /^[-*+] \[( |x|X)\](?: (.*))?$/;

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);

function reminderOf(v: unknown): number | null {
  const ms = v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : Number(v);
  return Number.isFinite(ms) && v !== null && v !== '' ? ms : null;
}

export function parseNote(src: string): NoteData {
  const fm = parseFrontMatter(src) ?? {};
  const rawTags = fm.tags ?? fm.tag;
  const labels = (
    typeof rawTags === 'string' ? rawTags.split(/[,\s]+/) : Array.isArray(rawTags) ? rawTags : []
  )
    .filter((t): t is string => typeof t === 'string')
    .map(normalizeTag)
    .filter((t, i, all) => isValidTag(t) && all.indexOf(t) === i);

  const lines = src.slice(splitFrontMatter(src).bodyOffset).split('\n');
  const images: string[] = [];
  // Image lines (and blank lines between them) at the very end belong to the note's pictures.
  while (lines.length) {
    const last = lines[lines.length - 1]!.trim();
    const m = IMAGE_LINE.exec(last);
    if (m) images.unshift(m[1]!);
    else if (last) break;
    lines.pop();
  }
  const content = lines.filter((l) => l.trim());
  const tasks = content.map((l) => TASK_LINE.exec(l.trim()));
  const isList = content.length > 0 && tasks.every(Boolean);

  return {
    title: typeof fm.title === 'string' ? fm.title : '',
    text: isList ? '' : lines.join('\n').trim(),
    items: isList ? tasks.map((m) => ({ text: m![2] ?? '', done: m![1] !== ' ' })) : null,
    images,
    color: isOneOf(NOTE_COLORS, fm.color) ? fm.color : 'default',
    pinned: fm.pinned === true,
    archived: fm.archived === true,
    labels,
    reminder: reminderOf(fm.reminder),
    repeat: isOneOf(REPEATS, fm.repeat) ? fm.repeat : null,
    order: typeof fm.order === 'number' && Number.isFinite(fm.order) ? fm.order : null,
  };
}

/** Writes `data` as a note, keeping any front matter keys this module doesn't own. */
export function serializeNote(data: NoteData, previousSrc = ''): string {
  const old: FrontMatter = parseFrontMatter(previousSrc) ?? {};
  const fm: FrontMatter = Object.fromEntries(
    Object.entries(old).filter(([k]) => !KNOWN_KEYS.includes(k)),
  );
  if (data.title.trim()) fm.title = data.title.trim();
  if (data.color !== 'default') fm.color = data.color;
  if (data.pinned) fm.pinned = true;
  if (data.archived) fm.archived = true;
  if (data.labels.length) fm.tags = data.labels;
  if (data.reminder !== null) fm.reminder = new Date(data.reminder).toISOString();
  if (data.reminder !== null && data.repeat) fm.repeat = data.repeat;
  if (data.order !== null) fm.order = data.order;

  const body = data.items
    ? data.items
        .filter((i) => i.text.trim())
        .map((i) => `- [${i.done ? 'x' : ' '}] ${i.text.trim().replace(/\s*\n\s*/g, ' ')}`)
        .join('\n')
    : data.text.trim();
  const pictures = data.images.map((src) => `![](${src})`).join('\n');
  const text = [body, pictures].filter(Boolean).join('\n\n');
  return withFrontMatter(text ? `${text}\n` : '', fm);
}

/** Turns a text note into a checklist (one item per line) and back. */
export function toggleChecklist(data: NoteData): Pick<NoteData, 'text' | 'items'> {
  if (data.items) return { text: data.items.map((i) => i.text).join('\n'), items: null };
  const lines = data.text.split('\n').filter((l) => l.trim());
  return { text: '', items: lines.map((text) => ({ text: text.trim(), done: false })) };
}

export function isEmptyNote(n: NoteData): boolean {
  return (
    !n.title.trim() &&
    !n.text.trim() &&
    !n.images.length &&
    !(n.items ?? []).some((i) => i.text.trim())
  );
}

/** A file name for a new note: its title, else its first words, else the time. */
export function noteFileName(n: NoteData, now = new Date()): string {
  const first = n.title.trim() || n.text.trim().split('\n')[0] || n.items?.[0]?.text.trim() || '';
  const p = (v: number) => String(v).padStart(2, '0');
  const stamp = `Note ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}.${p(now.getMinutes())}`;
  const base = sanitizeName(first.slice(0, 48).trim(), stamp).replace(/[.\s]+$/, '') || stamp;
  return `${base}.md`;
}

// ------------------------------------------------------------ reminders

/** The first repeat of `from` after `after`, stepping by calendar days/months. */
export function nextReminder(from: number, repeat: Repeat, after: number): number {
  const d = new Date(from);
  let guard = 0;
  while (d.getTime() <= after && guard++ < 5000) {
    if (repeat === 'daily') d.setDate(d.getDate() + 1);
    else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
    else if (repeat === 'monthly') d.setMonth(d.getMonth() + 1);
    else d.setFullYear(d.getFullYear() + 1);
  }
  return d.getTime();
}

// ------------------------------------------------------------ ordering

export interface Ordered {
  id: string;
  order: number | null;
  createdAt: number;
}

/** Sort position: an explicit order, else newest first. */
export const sortKey = (n: Ordered): number => n.order ?? -n.createdAt;

export const bySortKey = (a: Ordered, b: Ordered): number => sortKey(a) - sortKey(b);

/** The order that puts `dragId` before `targetId` (or after it) within `list`. */
export function orderFor(
  list: readonly Ordered[],
  dragId: string,
  targetId: string,
  after: boolean,
): number {
  const rest = [...list].sort(bySortKey).filter((n) => n.id !== dragId);
  const i = rest.findIndex((n) => n.id === targetId);
  if (i < 0) return sortKey(list[0] ?? { id: '', order: 0, createdAt: 0 });
  const at = after ? i + 1 : i;
  const prev = rest[at - 1];
  const next = rest[at];
  if (prev && next) return (sortKey(prev) + sortKey(next)) / 2;
  if (next) return sortKey(next) - 1000;
  return sortKey(prev!) + 1000;
}

/** The order that puts a note ahead of every other. */
export const orderOnTop = (list: readonly Ordered[]): number =>
  list.length ? Math.min(...list.map(sortKey)) - 1000 : -Date.now();

// ------------------------------------------------------------ search and layout

export interface NoteFilter {
  query: string;
  lists?: boolean;
  images?: boolean;
  reminders?: boolean;
  color?: NoteColor;
  label?: string;
}

export const hasFilter = (f: NoteFilter): boolean =>
  !!(f.query.trim() || f.lists || f.images || f.reminders || f.color || f.label);

export function matchesFilter(n: NoteData, f: NoteFilter): boolean {
  if (f.lists && !n.items) return false;
  if (f.images && !n.images.length) return false;
  if (f.reminders && n.reminder === null) return false;
  if (f.color && n.color !== f.color) return false;
  if (f.label && !n.labels.includes(f.label)) return false;
  const terms = f.query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = [n.title, n.text, ...(n.items ?? []).map((i) => i.text), ...n.labels]
    .join('\n')
    .toLocaleLowerCase();
  return terms.every((t) => hay.includes(t));
}

/** A rough card height in pixels, enough to balance masonry columns without measuring. */
export function estimateHeight(n: NoteData, colWidth = 240): number {
  const perLine = Math.max(12, Math.floor((colWidth - 32) / 7.5));
  const lines = (s: string, max: number) =>
    Math.min(
      max,
      s.split('\n').reduce((sum, l) => sum + Math.max(1, Math.ceil(l.length / perLine)), 0),
    );
  let h = 48;
  if (n.images.length) h += n.images.length > 1 ? 150 : 170;
  if (n.title) h += lines(n.title, 3) * 24;
  if (n.items) {
    const open = n.items.filter((i) => !i.done);
    h += Math.min(open.length, 8) * 26 + (open.length > 8 ? 20 : 0);
    if (open.length < n.items.length) h += 24;
  } else h += lines(n.text, 10) * 20;
  if (n.labels.length || n.reminder !== null) h += 30;
  return h;
}

/** Spreads cards over `cols` columns, each going to the currently shortest one. */
export function masonry<T>(items: readonly T[], cols: number, height: (t: T) => number): T[][] {
  const out: T[][] = Array.from({ length: Math.max(1, cols) }, () => []);
  const heights = out.map(() => 0);
  for (const item of items) {
    let c = 0;
    for (let i = 1; i < heights.length; i++) if (heights[i]! < heights[c]!) c = i;
    out[c]!.push(item);
    heights[c]! += height(item) + 12;
  }
  return out;
}
