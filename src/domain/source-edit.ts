/**
 * Precise edits to Markdown source for rich editing: find where a rendered block's
 * inline content lives in the source, and replace only that range. Everything else
 * in the document stays byte-for-byte as it was.
 */

export interface InlineLocation {
  kind: 'heading' | 'paragraph' | 'item' | 'cell';
  /** 0-based first line and the line after the last. */
  line: number;
  end: number;
  /** The inline source as the parser read it (container prefixes removed). */
  content: string;
  col?: number;
}

export interface SourceRange {
  from: number;
  to: number;
  /** Prefix for lines after the first when the content spans several lines (">", indent). */
  continuation: string;
}

/** Start offset of every line. */
export function lineStarts(doc: string): number[] {
  const out = [0];
  for (let i = doc.indexOf('\n'); i >= 0; i = doc.indexOf('\n', i + 1)) out.push(i + 1);
  return out;
}

function lineEnd(doc: string, starts: number[], line: number): number {
  return line + 1 < starts.length ? starts[line + 1]! - 1 : doc.length;
}

/** The prefix a continuation line needs inside the same containers: `>` kept, markers become spaces. */
export function continuationOf(prefix: string): string {
  return prefix.replace(/[^>\s]/g, ' ');
}

/**
 * Cell ranges of a table row, split exactly like the renderer (markdown-it): on pipes
 * not preceded by a backslash. Ranges exclude the padding spaces around each cell.
 */
export function cellRanges(row: string): { from: number; to: number }[] {
  const bounds: number[] = [];
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '|' && row[i - 1] !== '\\') bounds.push(i);
  }
  const segs: [number, number][] = [];
  let start = 0;
  for (const b of bounds) {
    segs.push([start, b]);
    start = b + 1;
  }
  segs.push([start, row.length]);
  const trimmed = row.trim();
  if (trimmed.startsWith('|') && segs.length > 1 && !row.slice(...segs[0]!).trim()) segs.shift();
  if (
    trimmed.endsWith('|') &&
    !trimmed.endsWith('\\|') &&
    segs.length > 1 &&
    !row.slice(...segs[segs.length - 1]!).trim()
  )
    segs.pop();
  return segs.map(([a, b]) => {
    const text = row.slice(a, b);
    const lead = text.length - text.trimStart().length;
    const inner = text.trim();
    if (!inner) {
      // Empty cell: insert after one space of padding.
      const at = Math.min(b, a + (text.length ? 1 : 0));
      return { from: at, to: at };
    }
    return { from: a + lead, to: a + lead + inner.length };
  });
}

const unescapePipes = (s: string) => s.replace(/\\\|/g, '|');

/**
 * Finds the source range of an inline run. Returns null when the source no longer
 * matches what was rendered (the document changed meanwhile), so callers never
 * write over the wrong text.
 */
export function locateInline(doc: string, loc: InlineLocation): SourceRange | null {
  const range = locateRaw(doc, loc);
  // Task items: the "[ ] " marker belongs to the list item, not to its text.
  const task = loc.kind === 'item' ? /^\[[ xX]\][ \t]?/.exec(loc.content) : null;
  if (range && task) range.from = Math.min(range.to, range.from + task[0].length);
  return range;
}

function locateRaw(doc: string, loc: InlineLocation): SourceRange | null {
  const starts = lineStarts(doc);
  if (loc.line < 0 || loc.line >= starts.length) return null;
  const firstFrom = starts[loc.line]!;
  if (loc.kind === 'cell') {
    const row = doc.slice(firstFrom, lineEnd(doc, starts, loc.line));
    const r = cellRanges(row)[loc.col ?? 0];
    if (!r) return null;
    if (unescapePipes(row.slice(r.from, r.to)) !== unescapePipes(loc.content)) return null;
    return { from: firstFrom + r.from, to: firstFrom + r.to, continuation: '' };
  }
  const lastLine = Math.min(loc.end, starts.length) - 1;
  const segTo = lineEnd(doc, starts, lastLine);
  const seg = doc.slice(firstFrom, segTo);
  const content = loc.content;
  const lines = content.split('\n');
  if (lines.length === 1) {
    const firstLine = doc.slice(firstFrom, lineEnd(doc, starts, loc.line));
    const idx = firstLine.indexOf(content);
    if (idx < 0) return null;
    return {
      from: firstFrom + idx,
      to: firstFrom + idx + content.length,
      continuation: continuationOf(firstLine.slice(0, idx)),
    };
  }
  const idx = seg.indexOf(content);
  if (idx >= 0) {
    const prefix = doc.slice(firstFrom, firstFrom + idx);
    // Top-level paragraph: the content is the source as is.
    return {
      from: firstFrom + idx,
      to: firstFrom + idx + content.length,
      continuation: continuationOf(prefix.slice(prefix.lastIndexOf('\n') + 1)),
    };
  }
  // Inside a container: every content line ends its own source line after a prefix.
  let from = -1;
  let to = -1;
  let continuation = '';
  for (let i = 0; i < lines.length; i++) {
    const ln = loc.line + i;
    if (ln >= starts.length) return null;
    const src = doc.slice(starts[ln]!, lineEnd(doc, starts, ln));
    const want = lines[i]!;
    const at = src.length - want.length;
    if (at < 0 || src.slice(at) !== want || /[^\s>\-*+\d.)]/.test(src.slice(0, at))) {
      // The parser trims trailing spaces; allow them.
      const t = src.trimEnd();
      const at2 = t.length - want.length;
      if (at2 < 0 || t.slice(at2) !== want) return null;
      if (i === 0) from = starts[ln]! + at2;
      if (i === 1) continuation = src.slice(0, at2);
      if (i === lines.length - 1) to = starts[ln]! + at2 + want.length;
      continue;
    }
    if (i === 0) from = starts[ln]! + at;
    if (i === 1) continuation = src.slice(0, at);
    if (i === lines.length - 1) to = starts[ln]! + at + want.length;
  }
  if (from < 0 || to < 0) return null;
  return { from, to, continuation };
}

/** Lays out new inline content in a range: continuation lines get the container prefix. */
export function layoutInline(text: string, range: SourceRange, singleLine: boolean): string {
  if (singleLine) return text.replace(/\s*\n\s*/g, ' ');
  return text
    .split('\n')
    .map((l, i) => (i === 0 || !l ? l : range.continuation + l))
    .join('\n');
}

/**
 * Applies an edit with as little rewriting as possible. `serializedBefore` is the
 * serializer's output for the unedited content and `serializedAfter` for the edited
 * content. When the serializer already reproduces the original exactly, the result is
 * `serializedAfter`. Otherwise only the changed middle part is spliced into the
 * original, so syntax the user didn't touch (`__bold__`, escapes, entities) is kept.
 * Returns null if the change can't be placed safely.
 */
export function mergeInlineEdit(
  original: string,
  serializedBefore: string,
  serializedAfter: string,
): string | null {
  if (serializedBefore === serializedAfter) return original;
  if (serializedBefore === original) return serializedAfter;
  const a = serializedBefore;
  const b = serializedAfter;
  let p = 0;
  const max = Math.min(a.length, b.length);
  while (p < max && a[p] === b[p]) p++;
  let s = 0;
  while (s < max - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const q = a.length - s;
  const align = alignChars(a, original);
  if (!align) return null;
  const from = mapLeft(align, original.length, p);
  const to = mapRight(align, original.length, q);
  if (from > to) return null;
  return original.slice(0, from) + b.slice(p, b.length - s) + original.slice(to);
}

/** For each character of `a`, the index of the matching character of `b` (or -1). LCS-based. */
function alignChars(a: string, b: string): Int32Array | null {
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) return null;
  // Suffix LCS lengths, row by row.
  const dp = new Int32Array((n + 1) * (m + 1));
  const w = m + 1;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        a[i] === b[j]
          ? dp[(i + 1) * w + j + 1]! + 1
          : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
    }
  }
  const match = new Int32Array(n).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      match[i++] = j++;
    } else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) i++;
    else j++;
  }
  return match;
}

/**
 * Where a boundary at `p` in the serialized text falls in the original. Unmatched
 * characters just before `p` are syntax that belongs to the unchanged head (a closing
 * `**`), so the corresponding gap in the original (`__`) stays in the head too.
 */
function mapLeft(match: Int32Array, origLen: number, p: number): number {
  let i = p - 1;
  while (i >= 0 && match[i]! < 0) i--;
  const base = i >= 0 ? match[i]! + 1 : 0;
  if (p - (i + 1) === 0) return base;
  let next = origLen;
  for (let k = p; k < match.length; k++)
    if (match[k]! >= 0) {
      next = match[k]!;
      break;
    }
  return next;
}

function mapRight(match: Int32Array, origLen: number, q: number): number {
  let i = q;
  while (i < match.length && match[i]! < 0) i++;
  const base = i < match.length ? match[i]! : origLen;
  if (i - q === 0) return base;
  let prev = 0;
  for (let k = q - 1; k >= 0; k--)
    if (match[k]! >= 0) {
      prev = match[k]! + 1;
      break;
    }
  return prev;
}

// ------------------------------------------------------------------ block operations

export type BlockType =
  'paragraph' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'bullet' | 'number' | 'task' | 'quote';

const BLOCK_PREFIX = /^(\s*)(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?)?/;

/** The block type of a source line, judged by its prefix. */
export function blockTypeOf(line: string): BlockType {
  const m = BLOCK_PREFIX.exec(line)!;
  const p = (m[2] ?? '').trim();
  if (p.startsWith('#')) return `h${Math.min(6, p.length)}` as BlockType;
  if (/^[-*+]\s+\[/.test(p)) return 'task';
  if (/^[-*+]$/.test(p)) return 'bullet';
  if (/^\d+[.)]$/.test(p)) return 'number';
  if (p === '>') return 'quote';
  return 'paragraph';
}

const PREFIX_FOR: Record<BlockType, string> = {
  paragraph: '',
  h1: '# ',
  h2: '## ',
  h3: '### ',
  h4: '#### ',
  h5: '##### ',
  h6: '###### ',
  bullet: '- ',
  number: '1. ',
  task: '- [ ] ',
  quote: '> ',
};

/**
 * Changes the type of the block on `line` (an explicit structural change). Only the
 * prefix of that line changes; indentation and content are kept. Headings are a
 * single line, so a multi-line paragraph turned into a heading joins its lines.
 */
export function setBlockType(
  doc: string,
  line: number,
  end: number,
  type: BlockType,
): { from: number; to: number; insert: string } | null {
  const starts = lineStarts(doc);
  if (line >= starts.length) return null;
  const from = starts[line]!;
  const last = Math.min(end, starts.length) - 1;
  const to = lineEnd(doc, starts, last);
  const lines = doc.slice(from, to).split('\n');
  const strip = (l: string) => {
    const m = BLOCK_PREFIX.exec(l)!;
    return { indent: m[1] ?? '', body: l.slice(m[0].length) };
  };
  const first = strip(lines[0]!);
  const prefix = PREFIX_FOR[type];
  if (type.startsWith('h')) {
    const body = [first.body, ...lines.slice(1).map((l) => strip(l).body.trim())]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+#+\s*$/, '');
    return { from, to, insert: `${first.indent}${prefix}${body}` };
  }
  const rest = lines.slice(1).map((l) => {
    const s = strip(l);
    if (type === 'quote') return `${s.indent}> ${s.body}`;
    return `${s.indent}${' '.repeat(prefix.length)}${s.body}`.replace(/\s+$/, '');
  });
  return { from, to, insert: [`${first.indent}${prefix}${first.body}`, ...rest].join('\n') };
}

/**
 * Moves the top-level block spanning lines [line, end) above the previous block or
 * below the next one. Blank lines between blocks stay where they are.
 */
export function moveBlock(
  doc: string,
  blocks: { line: number; end: number }[],
  index: number,
  dir: -1 | 1,
): { from: number; to: number; insert: string } | null {
  const other = index + dir;
  if (other < 0 || other >= blocks.length) return null;
  const starts = lineStarts(doc);
  const a = blocks[Math.min(index, other)]!;
  const b = blocks[Math.max(index, other)]!;
  const trim = (blk: { line: number; end: number }) => {
    let e = Math.min(blk.end, starts.length);
    while (e > blk.line + 1 && !doc.slice(starts[e - 1]!, lineEnd(doc, starts, e - 1)).trim()) e--;
    return { from: starts[blk.line]!, to: lineEnd(doc, starts, e - 1) };
  };
  const ra = trim(a);
  const rb = trim(b);
  const textA = doc.slice(ra.from, ra.to);
  const textB = doc.slice(rb.from, rb.to);
  const between = doc.slice(ra.to, rb.from);
  return { from: ra.from, to: rb.to, insert: textB + between + textA };
}

/** Removes the block spanning lines [line, end), with one adjacent blank line. */
export function deleteBlock(
  doc: string,
  line: number,
  end: number,
): { from: number; to: number; insert: string } {
  const starts = lineStarts(doc);
  const from = starts[line] ?? doc.length;
  let to = end < starts.length ? starts[end]! : doc.length;
  // Swallow one following blank line so the gap between neighbours stays single.
  const next = doc.indexOf('\n', to);
  if (to < doc.length && !doc.slice(to, next < 0 ? doc.length : next).trim())
    to = next < 0 ? doc.length : next + 1;
  return { from, to, insert: '' };
}

/** The offset where a new block goes after the block spanning [line, end) (before trailing blanks). */
export function afterBlock(doc: string, end: number): number {
  const starts = lineStarts(doc);
  let e = Math.min(end, starts.length);
  while (e > 0 && !doc.slice(starts[e - 1]!, lineEnd(doc, starts, e - 1)).trim()) e--;
  return e > 0 ? lineEnd(doc, starts, e - 1) : 0;
}

/**
 * The body of a fenced code block spanning [line, end): the lines between the fences.
 * Returns null if the block doesn't start with a fence.
 */
export function fenceBody(
  doc: string,
  line: number,
  end: number,
): { from: number; to: number; info: string; empty: boolean } | null {
  const starts = lineStarts(doc);
  if (line >= starts.length) return null;
  const open = doc.slice(starts[line]!, lineEnd(doc, starts, line));
  const m = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(open);
  if (!m) return null;
  const fence = m[2]!;
  const last = Math.min(end, starts.length) - 1;
  const closeLine = doc.slice(starts[last]!, lineEnd(doc, starts, last));
  const closed =
    last > line &&
    closeLine.trim().startsWith(fence[0]!.repeat(fence.length)) &&
    !closeLine.trim().replace(/[`~]/g, '');
  const bodyFrom = line + 1 < starts.length ? starts[line + 1]! : doc.length;
  const bodyTo = closed ? starts[last]! - 1 : lineEnd(doc, starts, last);
  // An empty body has no line of its own: new code goes in before the closing fence.
  const empty = closed ? last === line + 1 : bodyFrom >= doc.length;
  return { from: bodyFrom, to: empty ? bodyFrom : bodyTo, info: m[3]!.trim(), empty };
}
