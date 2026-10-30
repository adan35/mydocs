/**
 * The spreadsheet model shared by XLSX, CSV, TSV and Markdown tables.
 *
 * Cells keep their type (number, text, boolean, error), their formula with the last
 * computed value, and their number format code, so dates stay dates and "007" stays
 * text. Nothing here guesses: a value only becomes a number when it is written as one.
 */

import type { SheetFormat } from './sheet-format';

export type ErrorValue = { error: string };
export type CellValue = number | string | boolean | ErrorValue | null;

export interface Cell {
  v: CellValue;
  /** Formula text without the leading "=". */
  f?: string;
  /** Number format code (`0.00`, `yyyy-mm-dd`, `0%`). */
  fmt?: string;
  /** Formula result could not be recomputed here; `v` is the file's cached value. */
  stale?: boolean;
}

export interface Sheet {
  name: string;
  /** Row-major; `rows[r][c]`. Missing entries are empty cells. */
  rows: (Cell | undefined)[][];
  /** Column widths in characters, when the source had them. */
  widths?: number[];
  /** Fill and text colors (see `sheet-format.ts`). */
  format?: SheetFormat;
  /** Color of the sheet's tab, `#rrggbb`. */
  tabColor?: string;
}

export interface Workbook {
  sheets: Sheet[];
}

export const isError = (v: unknown): v is ErrorValue =>
  !!v && typeof v === 'object' && !Array.isArray(v) && 'error' in v;

export function sheetSize(s: Sheet): { rows: number; cols: number } {
  let cols = 0;
  for (const r of s.rows) if (r && r.length > cols) cols = r.length;
  return { rows: s.rows.length, cols };
}

export function getCell(s: Sheet, r: number, c: number): Cell | undefined {
  return s.rows[r]?.[c];
}

export function setCellRaw(s: Sheet, r: number, c: number, cell: Cell | undefined) {
  while (s.rows.length <= r) s.rows.push([]);
  const row = (s.rows[r] ??= []);
  row[c] = cell;
}

// ------------------------------------------------------------------ addresses

export function colName(c: number): string {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function colIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export const addr = (r: number, c: number) => `${colName(c)}${r + 1}`;

export function parseAddr(a: string): { r: number; c: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(a);
  if (!m) return null;
  return { r: Number(m[2]) - 1, c: colIndex(m[1]!) };
}

// ------------------------------------------------------------------ input

/**
 * Interprets what someone typed into a cell, the way spreadsheet apps do, but never
 * altering text: leading zeros, long digit strings and anything with a leading
 * apostrophe stay text.
 */
export function parseInput(input: string, prev?: Cell): Cell | undefined {
  if (input === '') return undefined;
  if (input.startsWith("'")) return { v: input.slice(1) };
  if (input.startsWith('=') && input.length > 1) return { v: null, f: input.slice(1) };
  const t = input.trim();
  if (/^(true|false)$/i.test(t)) return { v: t.toLowerCase() === 'true' };
  const num = parseNumber(t);
  if (num !== null) {
    const keepFmt = prev?.fmt && !isDateFormat(prev.fmt) ? prev.fmt : undefined;
    if (t.endsWith('%')) return { v: num, fmt: keepFmt ?? (t.includes('.') ? '0.00%' : '0%') };
    return { v: num, fmt: keepFmt };
  }
  const date = parseIsoDate(t);
  if (date !== null)
    return {
      v: date,
      fmt:
        prev?.fmt && isDateFormat(prev.fmt)
          ? prev.fmt
          : t.includes(':')
            ? 'yyyy-mm-dd hh:mm'
            : 'yyyy-mm-dd',
    };
  return { v: input };
}

/** A number only when written as one; "007", "1e400" and "12345678901234567890" stay text. */
export function parseNumber(t: string): number | null {
  const pct = t.endsWith('%');
  const s = (pct ? t.slice(0, -1) : t).replace(/,(?=\d{3}(\D|$))/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return null;
  if (/^[-+]?0\d/.test(s)) return null; // leading zero: an identifier, not a number
  const digits = s.replace(/[^\d]/g, '').replace(/^0+/, '');
  if (digits.length > 15) return null; // beyond double precision: keep exactly as text
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return pct ? n / 100 : n;
}

// ------------------------------------------------------------------ dates

const EPOCH = Date.UTC(1899, 11, 30);
const DAY = 86400000;

/** Spreadsheet serial date (1900 system) from a UTC timestamp. */
export const toSerial = (ms: number) => (ms - EPOCH) / DAY;
export const fromSerial = (serial: number) => EPOCH + Math.round(serial * DAY);

function parseIsoDate(t: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (!m) return null;
  const [y, mo, d, h = '0', mi = '0', s = '0'] = m.slice(1);
  const ms = Date.UTC(+y!, +mo! - 1, +d!, +h, +mi, +s);
  const check = new Date(ms);
  if (check.getUTCMonth() !== +mo! - 1 || check.getUTCDate() !== +d!) return null;
  return toSerial(ms);
}

export function isDateFormat(fmt: string): boolean {
  // Strip quoted text, escapes and colors before looking for date tokens.
  const f = fmt.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '');
  return /[dmyhs]/i.test(f) && !/^[#0.,%\s]*$/.test(f);
}

// ------------------------------------------------------------------ display

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatDate(serial: number, fmt: string): string {
  const d = new Date(fromSerial(serial));
  const f = fmt.replace(/\[[^\]]*\]/g, '').split(';')[0]!;
  const hasAmPm = /am\/pm|a\/p/i.test(f);
  let out = '';
  let i = 0;
  let lastWasHour = false;
  while (i < f.length) {
    const rest = f.slice(i);
    const tok = /^(yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|am\/pm|a\/p|"[^"]*"|\\.|.)/i.exec(
      rest,
    )![0];
    const low = tok.toLowerCase();
    i += tok.length;
    if (low === 'yyyy') out += d.getUTCFullYear();
    else if (low === 'yy') out += pad(d.getUTCFullYear() % 100);
    else if (low === 'mmmm') out += MONTHS[d.getUTCMonth()];
    else if (low === 'mmm') out += MONTHS[d.getUTCMonth()]!.slice(0, 3);
    else if (low === 'mm' || low === 'm') {
      // "m" after an hour (or before seconds) means minutes.
      const minutes = lastWasHour || /^[^dmy]*s/i.test(f.slice(i));
      const v = minutes ? d.getUTCMinutes() : d.getUTCMonth() + 1;
      out += low === 'mm' ? pad(v) : v;
    } else if (low === 'dddd') out += DAYS[d.getUTCDay()];
    else if (low === 'ddd') out += DAYS[d.getUTCDay()]!.slice(0, 3);
    else if (low === 'dd') out += pad(d.getUTCDate());
    else if (low === 'd') out += d.getUTCDate();
    else if (low === 'hh' || low === 'h') {
      let h = d.getUTCHours();
      if (hasAmPm) h = h % 12 || 12;
      out += low === 'hh' ? pad(h) : h;
    } else if (low === 'ss' || low === 's')
      out += low === 'ss' ? pad(d.getUTCSeconds()) : d.getUTCSeconds();
    else if (low === 'am/pm') out += d.getUTCHours() < 12 ? 'AM' : 'PM';
    else if (low === 'a/p') out += d.getUTCHours() < 12 ? 'A' : 'P';
    else if (tok.startsWith('"')) out += tok.slice(1, -1);
    else if (tok.startsWith('\\')) out += tok.slice(1);
    else out += tok;
    if (low === 'hh' || low === 'h') lastWasHour = true;
    else if (/[a-z]/i.test(low)) lastWasHour = false;
  }
  return out;
}

function formatNumber(n: number, fmt: string): string {
  const sections = fmt.split(';');
  let f = sections[0]!;
  let neg = false;
  if (n < 0 && sections[1] !== undefined) {
    f = sections[1];
    n = -n;
    neg = true;
  } else if (n === 0 && sections[2] !== undefined) f = sections[2];
  f = f.replace(/\[[^\]]*\]/g, '');
  // Split into literal text and the digit pattern (#, 0, ?, comma, point).
  const parts: { lit: boolean; text: string }[] = [];
  let percent = false;
  for (let i = 0; i < f.length; i++) {
    const ch = f[i]!;
    if (ch === '"') {
      const end = f.indexOf('"', i + 1);
      const j = end === -1 ? f.length : end;
      parts.push({ lit: true, text: f.slice(i + 1, j) });
      i = j;
    } else if (ch === '\\') parts.push({ lit: true, text: f[++i] ?? '' });
    else if (ch === '_') parts.push({ lit: true, text: (i++, ' ') });
    else if (ch === '*') i++;
    else if ('#0?,.'.includes(ch)) parts.push({ lit: false, text: ch });
    else {
      if (ch === '%') percent = true;
      parts.push({ lit: true, text: ch });
    }
  }
  const firstPat = parts.findIndex((p) => !p.lit);
  if (firstPat < 0) return parts.map((p) => p.text).join('') || generalNumber(neg ? -n : n);
  let lastPat = parts.length - 1;
  while (parts[lastPat]!.lit) lastPat--;
  const pattern = parts
    .slice(firstPat, lastPat + 1)
    .filter((p) => !p.lit)
    .map((p) => p.text)
    .join('');
  const prefix = parts
    .slice(0, firstPat)
    .map((p) => p.text)
    .join('');
  const suffix = parts
    .slice(lastPat + 1)
    .map((p) => p.text)
    .join('');
  const [intPat = '', fracPat = ''] = pattern.split('.');
  const v = percent ? n * 100 : n;
  if (/E[+-]/i.test(f))
    return `${prefix}${v
      .toExponential(fracPat.length)
      .toUpperCase()
      .replace(/E\+?(-?)(\d)$/, 'E+$10$2')}${suffix}`;
  let body = Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: fracPat.replace(/#/g, '').length,
    maximumFractionDigits: fracPat.length,
    useGrouping: intPat.includes(','),
  });
  const minInt = (intPat.match(/0/g) ?? []).length;
  const [int = '', frac] = body.split('.');
  if (int.replace(/,/g, '').length < minInt)
    body = int.padStart(minInt, '0') + (frac !== undefined ? `.${frac}` : '');
  if (minInt === 0 && body.startsWith('0.')) body = body.slice(1);
  const sign = v < 0 && !neg ? '-' : '';
  return `${sign}${prefix}${body}${suffix}`;
}

function generalNumber(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const s = String(Number(n.toPrecision(11)));
  return s.length > 12 ? n.toExponential(5) : s;
}

/** The text a cell shows, as a spreadsheet would display it. */
export function displayValue(cell: Cell | undefined): string {
  if (!cell) return '';
  const v = cell.v;
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'string') return v;
  if (isError(v)) return v.error;
  if (cell.fmt && cell.fmt !== 'General' && cell.fmt !== '@') {
    try {
      return isDateFormat(cell.fmt) ? formatDate(v, cell.fmt) : formatNumber(v, cell.fmt);
    } catch {
      return generalNumber(v);
    }
  }
  return generalNumber(v);
}

/** What the editor shows when a cell is opened: the formula, or a value that re-parses to itself. */
export function editValue(cell: Cell | undefined): string {
  if (!cell) return '';
  if (cell.f !== undefined) return `=${cell.f}`;
  const v = cell.v;
  if (typeof v === 'string')
    return parseInput(v)?.v !== v || v.startsWith("'") || v.startsWith('=') ? `'${v}` : v;
  if (typeof v === 'number' && cell.fmt && isDateFormat(cell.fmt)) {
    const d = new Date(fromSerial(v));
    const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    return d.getUTCHours() || d.getUTCMinutes()
      ? `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
      : date;
  }
  if (typeof v === 'number' && cell.fmt?.includes('%'))
    return `${Number((v * 100).toPrecision(15))}%`;
  return displayValue({ v });
}

/** Plain text for CSV, Markdown and search: the shown value (formulas give their result). */
export function textValue(cell: Cell | undefined): string {
  if (!cell) return '';
  if (typeof cell.v === 'number' && !cell.fmt) return String(cell.v);
  return displayValue(cell);
}

export function emptySheet(name = 'Sheet1', rows = 20, cols = 8): Sheet {
  return { name, rows: Array.from({ length: rows }, () => new Array<Cell | undefined>(cols)) };
}

/** Trims trailing empty rows and cells (they carry nothing and bloat files). */
export function trimSheet(s: Sheet): Sheet {
  const rows = s.rows.map((r) => {
    const row = [...(r ?? [])];
    while (row.length && row[row.length - 1] === undefined) row.pop();
    return row;
  });
  while (rows.length && !rows[rows.length - 1]!.length) rows.pop();
  return { ...s, rows };
}
