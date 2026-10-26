/**
 * Spreadsheet behavior for tables that live in text (Markdown tables, CSV): the file keeps
 * plain cell text, so a formula is stored as its own text ("=SUM(B2:B4)") and calculated
 * for display. Everything here works on `string[][]` (the file's cell text) and returns
 * new text, so each edit is one write back to the document.
 */
import { parseFormula, recalculate, shiftFormula, moveRefs } from './formula';
import { addr, displayValue, parseInput, parseNumber, type Cell, type Sheet } from './workbook';

export type Rows = string[][];

/** Whether cell text is a formula: "=" followed by something that parses. */
export function isFormulaText(t: string): boolean {
  if (t.length < 2 || t[0] !== '=') return false;
  try {
    parseFormula(t.slice(1));
    return true;
  } catch {
    return false;
  }
}

/** "$1,200.50" and "€12" count as numbers in calculations; the text itself is never changed. */
function moneyNumber(text: string): number | null {
  const t = parseEmphasis(text.trim()).text; // **12** is still the number 12
  const m = /^([-+]?)[$€£¥]\s?(.+)$/.exec(t);
  return m ? parseNumber(m[1]! + m[2]!) : parseNumber(t);
}

/** The number a cell holds, reading numeric-looking text when `fromText` is set. */
export function numericOf(cell: Cell | undefined, fromText: boolean): number | null {
  const v = cell?.v;
  if (typeof v === 'number') return v;
  if (fromText && typeof v === 'string') return moneyNumber(v.trim());
  return null;
}

/**
 * The table as a sheet for display. Plain cells keep their text exactly; formula cells hold
 * their formula (`f`) and the calculated value (`v`). Formulas using functions MyDocs
 * doesn't have show #NAME? rather than a stale number.
 */
export function evaluateRows(rows: Rows, formulas: boolean): Sheet {
  const plain = (t: string): Cell | undefined => (t === '' ? undefined : { v: t });
  if (!formulas || !rows.some((r) => r.some(isFormulaText)))
    return { name: 'Table', rows: rows.map((r) => r.map(plain)) };
  const typed: Sheet = {
    name: 'Table',
    rows: rows.map((r) =>
      r.map((t) => {
        if (isFormulaText(t)) return { v: null, f: t.slice(1) };
        const money = moneyNumber(t);
        return money !== null ? { v: money } : parseInput(t);
      }),
    ),
  };
  recalculate({ sheets: [typed] });
  return {
    name: 'Table',
    rows: rows.map((r, i) =>
      r.map((t, j) => {
        if (!isFormulaText(t)) return plain(t);
        const c = typed.rows[i]![j]!;
        return c.stale ? { v: { error: '#NAME?' }, f: c.f } : { v: c.v, f: c.f };
      }),
    ),
  };
}

// ------------------------------------------------------------------ statistics

export interface RangeStats {
  /** Non-empty cells. */
  count: number;
  numbers: number;
  sum: number;
  min: number;
  max: number;
}

export function rangeStats(
  sheet: Sheet,
  [r1, c1, r2, c2]: [number, number, number, number],
  fromText: boolean,
): RangeStats {
  const s: RangeStats = { count: 0, numbers: 0, sum: 0, min: Infinity, max: -Infinity };
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++) {
      const cell = sheet.rows[r]?.[c];
      if (!cell || cell.v === null || cell.v === '') continue;
      s.count++;
      const n = numericOf(cell, fromText);
      if (n === null) continue;
      s.numbers++;
      s.sum += n;
      s.min = Math.min(s.min, n);
      s.max = Math.max(s.max, n);
    }
  return s;
}

// ------------------------------------------------------------------ structure

const width = (rows: Rows) => Math.max(1, ...rows.map((r) => r.length));
const copy = (rows: Rows): Rows => rows.map((r) => [...r]);

/** Rewrites every formula's references after rows or columns were inserted or deleted. */
function fixRefs(rows: Rows, axis: 'row' | 'col', at: number, delta: number): Rows {
  return rows.map((row) =>
    row.map((t) => (isFormulaText(t) ? `=${moveRefs(t.slice(1), axis, at, delta)}` : t)),
  );
}

export function insertRowsAt(rows: Rows, at: number, count = 1): Rows {
  const out = copy(rows);
  while (out.length < at) out.push([]);
  const w = width(rows);
  out.splice(at, 0, ...Array.from({ length: count }, () => Array.from({ length: w }, () => '')));
  return fixRefs(out, 'row', at, count);
}

export function deleteRowsAt(rows: Rows, at: number, count = 1): Rows {
  const out = copy(rows);
  out.splice(at, count);
  return fixRefs(out, 'row', at, -count);
}

export function insertColsAt(rows: Rows, at: number, count = 1): Rows {
  const out = copy(rows);
  for (const row of out) {
    while (row.length < at) row.push('');
    row.splice(at, 0, ...Array.from({ length: count }, () => ''));
  }
  return fixRefs(out, 'col', at, count);
}

export function deleteColsAt(rows: Rows, at: number, count = 1): Rows {
  const out = copy(rows);
  for (const row of out) row.splice(at, count);
  return fixRefs(out, 'col', at, -count);
}

/** Sets a cell in place, growing the table when it is past the edge. */
function put(rows: Rows, r: number, c: number, text: string) {
  while (rows.length <= r) rows.push([]);
  const row = rows[r]!;
  while (row.length <= c) row.push('');
  row[c] = text;
}

export function setCellText(rows: Rows, r: number, c: number, text: string): Rows {
  const out = copy(rows);
  put(out, r, c, text);
  return out;
}

/** Writes a block of text (a paste) with its top left corner at (r, c). */
export function setBlock(rows: Rows, r: number, c: number, block: Rows): Rows {
  const out = copy(rows);
  block.forEach((line, i) => line.forEach((t, j) => put(out, r + i, c + j, t)));
  return out;
}

// ------------------------------------------------------------------ fill

/**
 * Fills a range from its first row (down) or first column (right), moving the relative
 * references in formulas like a spreadsheet does. A single cell is filled from the
 * neighbour above (down) or to the left (right), which is what Ctrl+D and Ctrl+R do.
 */
export function fillRange(
  rows: Rows,
  [r1, c1, r2, c2]: [number, number, number, number],
  dir: 'down' | 'right',
): Rows | null {
  const out = copy(rows);
  const down = dir === 'down';
  const single = down ? r1 === r2 : c1 === c2;
  if (single && (down ? r1 : c1) === 0) return null;
  const from = single ? (down ? r1 - 1 : c1 - 1) : down ? r1 : c1;
  const span = down ? [r1, r2] : [c1, c2];
  for (let a = single ? span[0]! : span[0]! + 1; a <= span[1]!; a++)
    for (let b = down ? c1 : r1; b <= (down ? c2 : r2); b++) {
      const [sr, sc] = down ? [from, b] : [b, from];
      const [tr, tc] = down ? [a, b] : [b, a];
      const src = rows[sr]?.[sc] ?? '';
      const text = isFormulaText(src) ? `=${shiftFormula(src.slice(1), tr - sr, tc - sc)}` : src;
      put(out, tr, tc, text);
    }
  return out;
}

// ------------------------------------------------------------------ sort

const rank = (cell: Cell | undefined, fromText: boolean) => {
  const n = numericOf(cell, fromText);
  return n !== null ? n : null;
};

/**
 * Sorts the rows below `skip` header rows by a column, comparing what the cells show
 * (formula results, numbers before text, blanks last). Formulas move with their row, and
 * their relative references follow, so `=B2*C2` still multiplies its own row.
 */
export function sortRows(
  rows: Rows,
  shown: Sheet,
  col: number,
  dir: 'asc' | 'desc',
  skip: number,
): Rows {
  const body = rows.slice(skip).map((row, i) => ({ row, at: i + skip }));
  const key = (at: number) => shown.rows[at]?.[col];
  body.sort((a, b) => {
    const x = key(a.at);
    const y = key(b.at);
    const tx = displayValue(x);
    const ty = displayValue(y);
    if (!tx && !ty) return 0;
    if (!tx) return 1; // blanks last either way
    if (!ty) return -1;
    const nx = rank(x, true);
    const ny = rank(y, true);
    let cmp: number;
    if (nx !== null && ny !== null) cmp = nx - ny;
    else if (nx !== null) cmp = -1;
    else if (ny !== null) cmp = 1;
    else cmp = tx.localeCompare(ty, undefined, { numeric: true, sensitivity: 'base' });
    return dir === 'asc' ? cmp : -cmp;
  });
  return [
    ...rows.slice(0, skip),
    ...body.map(({ row, at }, i) => {
      const delta = i + skip - at;
      return delta === 0
        ? row
        : row.map((t) => (isFormulaText(t) ? `=${shiftFormula(t.slice(1), delta, 0)}` : t));
    }),
  ];
}

// ------------------------------------------------------------------ AutoSum

/**
 * Σ: with a single cell selected, adds up the numbers directly above it (or to its left).
 * With a range selected, puts the totals in the row below it (or, for one row, the
 * column to its right). Returns the new text and where the first total went.
 */
export function autoSum(
  rows: Rows,
  shown: Sheet,
  [r1, c1, r2, c2]: [number, number, number, number],
): { rows: Rows; at: { r: number; c: number } } | null {
  const num = (r: number, c: number) => numericOf(shown.rows[r]?.[c], true) !== null;
  if (r1 === r2 && c1 === c2) {
    let top = r1;
    while (top > 0 && num(top - 1, c1)) top--;
    if (top < r1)
      return {
        rows: setCellText(rows, r1, c1, `=SUM(${addr(top, c1)}:${addr(r1 - 1, c1)})`),
        at: { r: r1, c: c1 },
      };
    let left = c1;
    while (left > 0 && num(r1, left - 1)) left--;
    if (left < c1)
      return {
        rows: setCellText(rows, r1, c1, `=SUM(${addr(r1, left)}:${addr(r1, c1 - 1)})`),
        at: { r: r1, c: c1 },
      };
    return null;
  }
  let out = rows;
  let first: { r: number; c: number } | null = null;
  if (r1 === r2) {
    out = setCellText(out, r1, c2 + 1, `=SUM(${addr(r1, c1)}:${addr(r1, c2)})`);
    return { rows: out, at: { r: r1, c: c2 + 1 } };
  }
  for (let c = c1; c <= c2; c++) {
    let any = false;
    for (let r = r1; r <= r2; r++) any ||= num(r, c);
    if (!any) continue;
    out = setCellText(out, r2 + 1, c, `=SUM(${addr(r1, c)}:${addr(r2, c)})`);
    first ??= { r: r2 + 1, c };
  }
  return first ? { rows: out, at: first } : null;
}

// ------------------------------------------------------------------ emphasis

export interface Emphasis {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  /** The text without its markers. */
  text: string;
}

/** Reads `**bold**`, `*italic*`, `***both***` and `~~strike~~` around a whole cell. */
export function parseEmphasis(t: string): Emphasis {
  let text = t;
  const out: Emphasis = { bold: false, italic: false, strike: false, text };
  let m = /^~~([^~]+)~~$/.exec(text);
  if (m) {
    out.strike = true;
    text = m[1]!;
  }
  if ((m = /^\*\*\*([^*]+)\*\*\*$/.exec(text))) {
    out.bold = out.italic = true;
    text = m[1]!;
  } else if ((m = /^\*\*([^*]+)\*\*$/.exec(text))) {
    out.bold = true;
    text = m[1]!;
  } else if ((m = /^\*([^*]+)\*$/.exec(text))) {
    out.italic = true;
    text = m[1]!;
  }
  out.text = text;
  return out;
}

function writeEmphasis(e: Emphasis): string {
  const stars = e.bold && e.italic ? '***' : e.bold ? '**' : e.italic ? '*' : '';
  const inner = `${stars}${e.text}${stars}`;
  return e.strike ? `~~${inner}~~` : inner;
}

/**
 * Turns bold, italic or strikethrough on for the range, or off when every filled cell
 * already has it. Formulas and empty cells are left alone.
 */
export function toggleEmphasis(
  rows: Rows,
  [r1, c1, r2, c2]: [number, number, number, number],
  kind: 'bold' | 'italic' | 'strike',
): Rows {
  const cells: [number, number][] = [];
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++) {
      const t = rows[r]?.[c] ?? '';
      if (t.trim() && !isFormulaText(t)) cells.push([r, c]);
    }
  if (!cells.length) return rows;
  const allOn = cells.every(([r, c]) => parseEmphasis(rows[r]![c]!)[kind]);
  const out = copy(rows);
  for (const [r, c] of cells) {
    const e = parseEmphasis(out[r]![c]!);
    e[kind] = !allOn;
    out[r]![c] = writeEmphasis(e);
  }
  return out;
}

// ------------------------------------------------------------------ filter

export type FilterOp =
  'contains' | 'equals' | 'not-equals' | 'greater' | 'less' | 'empty' | 'filled';

export interface Filter {
  col: number;
  op: FilterOp;
  value: string;
}

export const FILTER_OPS: { id: FilterOp; label: string; needsValue: boolean }[] = [
  { id: 'contains', label: 'contains', needsValue: true },
  { id: 'equals', label: 'is', needsValue: true },
  { id: 'not-equals', label: 'is not', needsValue: true },
  { id: 'greater', label: 'is greater than', needsValue: true },
  { id: 'less', label: 'is less than', needsValue: true },
  { id: 'empty', label: 'is empty', needsValue: false },
  { id: 'filled', label: 'is not empty', needsValue: false },
];

function matches(cell: Cell | undefined, f: Filter): boolean {
  const text = displayValue(cell);
  const q = f.value.trim();
  const lower = text.toLowerCase();
  switch (f.op) {
    case 'empty':
      return text === '';
    case 'filled':
      return text !== '';
    case 'contains':
      return lower.includes(q.toLowerCase());
    case 'equals':
    case 'not-equals': {
      const a = numericOf(cell, true);
      const b = moneyNumber(q);
      const same = a !== null && b !== null ? a === b : lower === q.toLowerCase();
      return f.op === 'equals' ? same : !same;
    }
    default: {
      const a = numericOf(cell, true);
      const b = moneyNumber(q);
      if (a === null || b === null) return false;
      return f.op === 'greater' ? a > b : a < b;
    }
  }
}

/** Indexes of the rows that satisfy every filter. The first `skip` rows (the header) always stay. */
export function filterRows(shown: Sheet, filters: Filter[], skip: number): number[] {
  const out: number[] = [];
  shown.rows.forEach((row, i) => {
    if (i < skip || filters.every((f) => matches(row?.[f.col], f))) out.push(i);
  });
  return out;
}

export const describeFilter = (f: Filter, name: string) =>
  `${name} ${FILTER_OPS.find((o) => o.id === f.op)!.label}${
    FILTER_OPS.find((o) => o.id === f.op)!.needsValue ? ` “${f.value}”` : ''
  }`;
