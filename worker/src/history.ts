import { diffLines } from '../../src/domain/diff';

/** Who wrote what. A shared document's edits are recorded as Yjs text deltas with their author. */
export type Op = { retain: number } | { insert: string } | { delete: number };

export interface Entry {
  at: number;
  email: string;
  name: string;
  delta: Op[];
}

/** `n` consecutive characters last written by author `a` during the minute starting at `t`. */
export interface Run {
  a: number;
  t: number;
  n: number;
}

export interface State {
  text: string;
  runs: Run[];
  authors: { email: string; name: string }[];
}

export const emptyState = (): State => ({ text: '', runs: [], authors: [] });

const BUCKET = 60_000;
/** Edits by one person closer together than this belong to one entry in the change list. */
export const SESSION_GAP = 5 * 60_000;
const MAX_SESSIONS = 100;
const MAX_LINES = 200;
const MAX_BLAME = 3000;
const MAX_LINE_CHARS = 300;

/** The state after one author's edit: new text, and who wrote each character. */
export function applyEntry(st: State, e: Entry): State {
  let ai = st.authors.findIndex((a) => a.email === e.email);
  const authors = ai < 0 ? [...st.authors, { email: e.email, name: e.name }] : st.authors;
  if (ai < 0) ai = authors.length - 1;
  const t = Math.floor(e.at / BUCKET) * BUCKET;
  const runs: Run[] = [];
  const push = (r: Run) => {
    const last = runs.at(-1);
    if (last && last.a === r.a && last.t === r.t) last.n += r.n;
    else runs.push({ ...r });
  };
  let ri = 0;
  let used = 0;
  const take = (n: number, keep: boolean) => {
    while (n > 0 && ri < st.runs.length) {
      const r = st.runs[ri]!;
      const k = Math.min(r.n - used, n);
      if (keep) push({ a: r.a, t: r.t, n: k });
      used += k;
      n -= k;
      if (used === r.n) {
        ri++;
        used = 0;
      }
    }
  };
  let text = '';
  let pos = 0;
  for (const op of e.delta) {
    if ('retain' in op) {
      take(op.retain, true);
      text += st.text.slice(pos, pos + op.retain);
      pos += op.retain;
    } else if ('insert' in op) {
      push({ a: ai, t, n: op.insert.length });
      text += op.insert;
    } else {
      take(op.delete, false);
      pos += op.delete;
    }
  }
  take(st.text.length - pos, true);
  return { text: text + st.text.slice(pos), runs, authors };
}

export const replay = (base: State, entries: Entry[]) => entries.reduce(applyEntry, base);

/**
 * Joins a new edit into the previous one when it just continues typing (or backspaces what
 * was just typed), so a sentence is one entry instead of one per keystroke.
 */
export function mergeOps(prev: Op[], next: Op[]): Op[] | null {
  const one = (ops: Op[]) => {
    const [first, second, ...rest] = ops;
    if (rest.length) return null;
    const retain = first && 'retain' in first ? first.retain : 0;
    const act = retain ? second : first;
    return act ? { retain, act } : null;
  };
  const p = one(prev);
  const n = one(next);
  if (!p || !n || !('insert' in p.act)) return null;
  const end = p.retain + p.act.insert.length;
  const head: Op[] = p.retain ? [{ retain: p.retain }] : [];
  if ('insert' in n.act && n.retain === end)
    return [...head, { insert: p.act.insert + n.act.insert }];
  if ('delete' in n.act && n.retain >= p.retain && n.retain + n.act.delete === end) {
    const kept = p.act.insert.slice(0, n.retain - p.retain);
    return kept ? [...head, { insert: kept }] : [];
  }
  return null;
}

export interface HistorySummary {
  authors: { name: string; email?: string }[];
  /** Newest first. */
  sessions: {
    a: number;
    start: number;
    end: number;
    edits: number;
    lines: { type: 'add' | 'del'; text: string }[];
    truncated: boolean;
  }[];
  /** Fewer sessions are listed than happened. */
  older: number;
  /** The document now, line by line, with who last wrote each line. */
  blame: { a: number; t: number; text: string }[];
  blameTruncated: boolean;
}

const clip = (s: string) => (s.length > MAX_LINE_CHARS ? `${s.slice(0, MAX_LINE_CHARS)}…` : s);

/** Builds the change list and line-by-line authorship from the recorded edits. */
export function summarize(base: State, entries: Entry[], showEmails: boolean): HistorySummary {
  let st = base;
  const all: {
    email: string;
    start: number;
    end: number;
    edits: number;
    lines: HistorySummary['sessions'][number]['lines'];
    truncated: boolean;
  }[] = [];
  let cur: { email: string; start: number; end: number; edits: number; before: string } | null =
    null;
  const close = () => {
    if (!cur) return;
    const changed = diffLines(cur.before, st.text).filter((d) => d.type !== 'same') as {
      type: 'add' | 'del';
      text: string;
    }[];
    all.push({
      email: cur.email,
      start: cur.start,
      end: cur.end,
      edits: cur.edits,
      lines: changed.slice(0, MAX_LINES).map((d) => ({ type: d.type, text: clip(d.text) })),
      truncated: changed.length > MAX_LINES,
    });
    cur = null;
  };
  for (const e of entries) {
    if (cur && (cur.email !== e.email || e.at - cur.end > SESSION_GAP)) close();
    if (!cur) cur = { email: e.email, start: e.at, end: e.at, edits: 0, before: st.text };
    st = applyEntry(st, e);
    cur.end = e.at;
    cur.edits++;
  }
  close();

  const index = (email: string) => st.authors.findIndex((a) => a.email === email);
  const blame: HistorySummary['blame'] = [];
  let ri = 0;
  let used = 0;
  // Walks the runs once. `best` is the newest run among a stretch of characters.
  const walk = (n: number): Run | null => {
    let best: Run | null = null;
    while (n > 0 && ri < st.runs.length) {
      const r = st.runs[ri]!;
      const k = Math.min(r.n - used, n);
      if (!best || r.t >= best.t) best = r;
      used += k;
      n -= k;
      if (used === r.n) {
        ri++;
        used = 0;
      }
    }
    return best;
  };
  for (const line of st.text.split('\n')) {
    // A line belongs to whoever wrote its text; its newline counts only for an empty line,
    // otherwise the person who pressed Enter after someone's line would take it over.
    const text = walk(line.length);
    const newline = walk(1);
    const best = text ?? newline;
    if (blame.length < MAX_BLAME)
      blame.push({ a: best?.a ?? 0, t: best?.t ?? 0, text: clip(line) });
  }
  const newest = all.reverse();
  return {
    authors: st.authors.map((a) => ({ name: a.name, ...(showEmails ? { email: a.email } : {}) })),
    sessions: newest.slice(0, MAX_SESSIONS).map(({ email, ...s }) => ({ a: index(email), ...s })),
    older: Math.max(0, newest.length - MAX_SESSIONS),
    blame,
    blameTruncated: st.text.split('\n').length > MAX_BLAME,
  };
}
