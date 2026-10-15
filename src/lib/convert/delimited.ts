/**
 * CSV and TSV (RFC 4180 quoting), UNL (Informix-style unload files: pipe-delimited,
 * backslash escapes, a delimiter after every row's last field), plus Markdown table ↔ sheet.
 *
 * Delimited files hold text only, so every cell is read as text: "007" stays "007",
 * "1/2" stays "1/2". Typing a number into a cell in the sheet view still writes the
 * characters typed. Converting to XLSX makes a cell a number only when its text is
 * exactly a plain number.
 */
import { ConversionReport } from './doc-ast';
import { parseNumber, textValue, trimSheet, type Cell, type Sheet } from './workbook';
import { splitRow, type Table, type Align } from '@/domain/table';

export interface Dialect {
  delimiter: string;
  /** Line ending to write; taken from the source so edits don't rewrite every line. */
  eol: '\n' | '\r\n';
  /** The source quoted every field. */
  quoteAll: boolean;
  bom: boolean;
  /** How a field holds the delimiter or a line break: RFC 4180 quotes, or a backslash (UNL). */
  escape?: 'quote' | 'backslash';
  /** Every row ends with the delimiter (UNL), which doesn't start another field. */
  terminated?: boolean;
}

/** Text data files that open in the sheet view. */
export const DELIMITED_EXTENSIONS = ['csv', 'tsv', 'tab', 'unl'];

export function detectDialect(text: string, ext: string): Dialect {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const bom = text.charCodeAt(0) === 0xfeff;
  const unl = ext === 'unl';
  const escape = unl ? 'backslash' : 'quote';
  const sample = text
    .slice(bom ? 1 : 0, 20000)
    .split(/\r?\n/)
    .slice(0, 20);
  const lines = sample.filter((l) => l.trim());
  let delimiter = ext === 'tsv' || ext === 'tab' ? '\t' : unl ? '|' : ',';
  if (ext !== 'tsv') {
    // Pick the candidate that splits lines into the most consistent number of fields.
    let best = -1;
    const candidates = unl ? ['|', ',', ';', '\t'] : [',', ';', '\t', '|'];
    for (const d of candidates) {
      const counts = lines.map((l) => splitLine(l, d, escape).length);
      if (!counts.length) continue;
      const first = counts[0]!;
      const score =
        first > 1 && counts.every((c) => c === first)
          ? first * 10
          : Math.max(...counts) > 1
            ? 1
            : 0;
      if (score > best) {
        best = score;
        delimiter = d;
      }
    }
  }
  if (unl) {
    // Parse whole records (escaped line breaks join lines) and check each one's ending.
    const head = text.slice(bom ? 1 : 0, 20000);
    const cut =
      head.length < text.length - (bom ? 1 : 0) ? head.lastIndexOf('\n') + 1 : head.length;
    const terminated = parseDelimited(head.slice(0, cut || head.length), delimiter, {
      escape,
    }).allTerminated;
    return { delimiter, eol, quoteAll: false, bom, escape, terminated };
  }
  const quoteAll = lines.length > 0 && lines.every((l) => /^"/.test(l) && /"$/.test(l));
  return { delimiter, eol, quoteAll, bom };
}

function splitLine(line: string, d: string, escape: Dialect['escape']): string[] {
  return parseDelimited(line, d, { escape }).rows[0] ?? [];
}

export function parseDelimited(
  text: string,
  delimiter: string,
  { escape = 'quote', terminated = false }: Pick<Dialect, 'escape' | 'terminated'> = {},
): {
  rows: string[][];
  malformed: boolean;
  spans: [number, number][];
  /** Every non-blank row ended with an unescaped delimiter (and there was at least one). */
  allTerminated: boolean;
} {
  const rows: string[][] = [];
  const spans: [number, number][] = [];
  let row: string[] = [];
  let field = '';
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let quoted = false;
  let malformed = false;
  let rowStart = i;
  /** The last character read was an unescaped delimiter. */
  let afterDelim = false;
  const n = text.length;
  let allTerminated = true;
  let any = false;
  const endRow = () => {
    if (row.length || field !== '') {
      any = true;
      if (!afterDelim) allTerminated = false;
    }
    // A terminated row's final delimiter closes the last field; it doesn't open a new one.
    if (!(terminated && afterDelim && field === '')) row.push(field);
    rows.push(row);
    row = [];
    field = '';
    afterDelim = false;
  };
  while (i < n) {
    const ch = text[i]!;
    if (escape === 'backslash') {
      if (ch === '\\' && i + 1 < n) {
        // \x is a literal x: the delimiter, a backslash or a line break inside a field.
        const next = text[i + 1]!;
        if (next === '\r' && text[i + 2] === '\n') {
          field += '\r\n';
          i += 3;
        } else {
          field += next;
          i += 2;
        }
        afterDelim = false;
        continue;
      }
      if (ch === delimiter) {
        row.push(field);
        field = '';
        afterDelim = true;
        i++;
        continue;
      }
      if (ch === '\r' || ch === '\n') {
        spans.push([rowStart, i]);
        endRow();
        i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
        rowStart = i;
        continue;
      }
      field += ch;
      afterDelim = false;
      i++;
      continue;
    }
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
      i++;
      continue;
    }
    if (ch === '"') malformed = true;
    if (ch === delimiter) {
      row.push(field);
      field = '';
      afterDelim = true;
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      spans.push([rowStart, i]);
      endRow();
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      rowStart = i;
      continue;
    }
    field += ch;
    afterDelim = false;
    i++;
  }
  if (quoted) malformed = true;
  if (field !== '' || row.length) {
    spans.push([rowStart, n]);
    endRow();
  }
  return { rows, malformed, spans, allTerminated: any && allTerminated };
}

export function serializeDelimited(rows: string[][], dialect: Dialect): string {
  const d = dialect.delimiter;
  let field: (s: string) => string;
  if (dialect.escape === 'backslash') {
    const special = new RegExp(`[\\\\\\n${d.replace(/[\\^$.*+?()[\]{}|-]/g, '\\$&')}]`, 'g');
    field = (s) => s.replace(/\r\n/g, '\n').replace(special, (c) => `\\${c}`);
  } else {
    const needs = new RegExp(`["\\r\\n${d === '\t' ? '\\t' : d.replace(/[|]/g, '\\|')}]|^\\s|\\s$`);
    field = (s: string) => (dialect.quoteAll || needs.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  }
  const end = dialect.terminated ? d : '';
  const body = rows.map((r) => r.map(field).join(d) + end).join(dialect.eol);
  return (dialect.bom ? '\ufeff' : '') + body + (rows.length ? dialect.eol : '');
}

/** A delimited file as a sheet: every cell is text. */
export function delimitedToSheet(
  text: string,
  dialect: Dialect,
  name = 'Sheet1',
): { sheet: Sheet; report: ConversionReport } {
  const report = new ConversionReport();
  const { rows, malformed } = parseDelimited(text, dialect.delimiter, dialect);
  if (malformed)
    report.note('Some quotes in the file are unbalanced; those fields were read as written.');
  const widths = new Set(rows.map((r) => r.length));
  if (widths.size > 1)
    report.note(
      'Rows have different numbers of fields; short rows are shown with empty cells.',
      'info',
    );
  return {
    sheet: {
      name,
      rows: rows.map((r) => r.map((v): Cell | undefined => (v === '' ? undefined : { v }))),
    },
    report,
  };
}

/**
 * Writes rows back over `original`, reusing the original text of every row whose values
 * didn't change, so an edit touches only the edited lines (quoting and spacing elsewhere
 * stay exactly as they were).
 */
export function rewriteDelimited(original: string, rows: string[][], dialect: Dialect): string {
  const parsed = parseDelimited(original, dialect.delimiter, dialect);
  const same = (a: string[] | undefined, b: string[]) => {
    if (!a) return false;
    const n = Math.max(a.length, b.length);
    for (let k = 0; k < n; k++) if ((a[k] ?? '') !== (b[k] ?? '')) return false;
    return true;
  };
  const plain = { ...dialect, bom: false };
  const lines = rows.map((r, i) => {
    const span = parsed.spans[i];
    if (span && same(parsed.rows[i], r)) return original.slice(span[0], span[1]);
    return serializeDelimited([r], plain).slice(0, -dialect.eol.length);
  });
  const bom = original.charCodeAt(0) === 0xfeff ? '﻿' : '';
  const trailing = /\r?\n$/.test(original) || !original ? dialect.eol : '';
  return bom + lines.join(dialect.eol) + (lines.length ? trailing : '');
}

export function sheetToDelimited(
  sheet: Sheet,
  dialect: Dialect,
): { text: string; report: ConversionReport; rows: string[][] } {
  const report = new ConversionReport();
  const s = trimSheet(sheet);
  const width = Math.max(0, ...s.rows.map((r) => r.length));
  let formulas = 0;
  const rows = s.rows.map((r) =>
    Array.from({ length: width }, (_, c) => {
      const cell = r[c];
      if (cell?.f !== undefined) formulas++;
      return textValue(cell);
    }),
  );
  if (formulas)
    report.note(
      `${formulas} formula${formulas === 1 ? ' was' : 's were'} saved as ${formulas === 1 ? 'its' : 'their'} current value; CSV can't hold formulas.`,
    );
  return { text: serializeDelimited(rows, dialect), report, rows };
}

/**
 * Types cells for a spreadsheet target: plain numbers (keeping written decimals such as
 * "250.0" through a number format) and TRUE/FALSE become typed values; everything else (leading zeros, dates, codes) stays text exactly.
 */
export function typeTextCells(sheet: Sheet): Sheet {
  return {
    ...sheet,
    rows: sheet.rows.map((r) =>
      r.map((cell) => {
        if (!cell || typeof cell.v !== 'string' || cell.f !== undefined) return cell;
        const t = cell.v;
        if (t !== t.trim()) return cell;
        const m = /^-?(0|[1-9]\d*)(?:\.(\d+))?$/.exec(t);
        const n = m ? parseNumber(t) : null;
        if (n !== null && String(n) === t) return { v: n };
        // "250.0" or "1.50": a number whose decimals are shown through its format.
        const places = m?.[2]?.length ?? 0;
        if (n !== null && places && !Object.is(n, -0) && n.toFixed(places) === t)
          return { v: n, fmt: `0.${'0'.repeat(places)}` };
        if (t === 'TRUE' || t === 'FALSE') return { v: t === 'TRUE' };
        return cell;
      }),
    ),
  };
}

// ------------------------------------------------------------------ Markdown tables

/** All pipe tables in a Markdown document with their line ranges. */
export interface MdTableRef {
  index: number;
  start: number;
  /** Line after the last table line. */
  end: number;
  table: Table;
  /** Text of the heading above, for the picker. */
  label: string;
}

export function findMarkdownTables(text: string): MdTableRef[] {
  const lines = text.split('\n');
  const out: MdTableRef[] = [];
  let fence: string | null = null;
  let heading = '';
  const delim = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1]![0]!;
      else if (f[1]![0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) heading = h[1]!.trim();
    const next = lines[i + 1];
    if (
      line.includes('|') &&
      next !== undefined &&
      delim.test(next) &&
      splitRow(line).length === splitRow(next).length
    ) {
      let end = i + 2;
      while (end < lines.length && lines[end]!.includes('|') && lines[end]!.trim()) end++;
      const header = splitRow(line);
      const align: Align[] = splitRow(next).map((c) => {
        const t = c.trim();
        return t.startsWith(':') && t.endsWith(':')
          ? 'center'
          : t.endsWith(':')
            ? 'right'
            : t.startsWith(':')
              ? 'left'
              : null;
      });
      const rows = lines.slice(i + 2, end).map((l) => {
        const cells = splitRow(l);
        return Array.from({ length: header.length }, (_, k) => cells[k] ?? '');
      });
      out.push({
        index: out.length,
        start: i,
        end,
        table: { header, align, rows },
        label: heading,
      });
      i = end - 1;
    }
  }
  return out;
}

/** A Markdown table as a sheet: the header is row 1. Cells hold the Markdown text. */
export function tableToSheet(t: Table, name = 'Table'): Sheet {
  return {
    name,
    rows: [t.header, ...t.rows].map((r) =>
      r.map((v): Cell | undefined =>
        v.trim() === '' ? undefined : { v: v.trim().replace(/\\\|/g, '|') },
      ),
    ),
  };
}

/** Back to a table, keeping the column alignment; values become escaped cell text. */
/** `keepEmpty` keeps blank rows the user inserted on purpose (live table edits). */
export function sheetToTable(sheet: Sheet, align: Align[], keepEmpty = false): Table {
  const s = keepEmpty ? sheet : trimSheet(sheet);
  const width = Math.max(1, ...s.rows.map((r) => r.length), align.length);
  const cell = (c: Cell | undefined) =>
    textValue(c)
      .replace(/\r?\n/g, ' ')
      .replace(/(?<!\\)\|/g, '\\|');
  const rows = s.rows.map((r) => Array.from({ length: width }, (_, k) => cell(r[k])));
  const [header = Array.from({ length: width }, () => ''), ...body] = rows;
  return { header, align: Array.from({ length: width }, (_, k) => align[k] ?? null), rows: body };
}
