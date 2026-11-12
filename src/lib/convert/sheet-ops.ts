/**
 * Structural edits on a sheet (rows, columns, sorting). Formulas on every sheet keep
 * pointing at the same cells; references to deleted cells become #REF!, as in Excel.
 */
import { moveRefs, permuteColRefs } from './formula';
import {
  deleteColsFormat,
  deleteRowsFormat,
  insertColsFormat,
  insertRowsFormat,
  permuteColsFormat,
  permuteRowsFormat,
} from './sheet-format';
import { cleanSheetName } from './xlsx';
import { sheetSize, type Cell, type Sheet, type Workbook } from './workbook';

function rewriteFormulas(
  wb: Workbook,
  sheetIndex: number,
  axis: 'row' | 'col',
  at: number,
  delta: number,
) {
  rewriteRefs(wb, sheetIndex, (refs) => moveRefs(refs, axis, at, delta));
}

/** Rewrites the references into one sheet (unqualified ones on that sheet, qualified ones anywhere). */
function rewriteRefs(wb: Workbook, sheetIndex: number, rewrite: (refs: string) => string) {
  const name = wb.sheets[sheetIndex]!.name.toLowerCase();
  wb.sheets.forEach((s, si) => {
    for (const row of s.rows)
      for (const cell of row ?? []) {
        if (cell?.f === undefined) continue;
        if (si === sheetIndex) {
          // References to other sheets must not move; protect them by checking the prefix.
          cell.f = moveLocal(cell.f, rewrite);
        } else if (
          cell.f.toLowerCase().includes(`${name}!`) ||
          cell.f.toLowerCase().includes(`'${name}'!`)
        ) {
          cell.f = moveQualified(cell.f, wb.sheets[sheetIndex]!.name, rewrite);
        }
      }
  });
}

/** Moves unqualified references only. */
function moveLocal(f: string, rewrite: (refs: string) => string): string {
  return splitQualified(f)
    .map((p) => (p.qualified ? p.text : rewrite(p.text)))
    .join('');
}

/** Moves references qualified with `sheet` only. */
function moveQualified(f: string, sheet: string, rewrite: (refs: string) => string): string {
  return splitQualified(f)
    .map((p) =>
      p.qualified && p.sheet?.toLowerCase() === sheet.toLowerCase()
        ? p.prefix + rewrite(p.text.slice(p.prefix.length))
        : p.text,
    )
    .join('');
}

function splitQualified(
  f: string,
): { text: string; qualified: boolean; sheet?: string; prefix: string }[] {
  const re =
    /('(?:[^']|'')+'|[A-Za-z_][\w.]*)!(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)/g;
  const out: { text: string; qualified: boolean; sheet?: string; prefix: string }[] = [];
  let last = 0;
  for (const m of f.matchAll(re)) {
    // Skip matches inside string literals.
    const before = f.slice(0, m.index);
    if ((before.match(/"/g) ?? []).length % 2) continue;
    if (m.index! > last) out.push({ text: f.slice(last, m.index), qualified: false, prefix: '' });
    const sheet = m[1]!.startsWith("'") ? m[1]!.slice(1, -1).replace(/''/g, "'") : m[1]!;
    out.push({ text: m[0], qualified: true, sheet, prefix: `${m[1]}!` });
    last = m.index! + m[0].length;
  }
  if (last < f.length) out.push({ text: f.slice(last), qualified: false, prefix: '' });
  return out;
}

export function insertRows(wb: Workbook, si: number, at: number, count = 1) {
  const s = wb.sheets[si]!;
  while (s.rows.length < at) s.rows.push([]);
  s.rows.splice(at, 0, ...Array.from({ length: count }, () => [] as (Cell | undefined)[]));
  s.format = insertRowsFormat(s.format, at, count);
  rewriteFormulas(wb, si, 'row', at, count);
}

export function deleteRows(wb: Workbook, si: number, at: number, count = 1) {
  const s = wb.sheets[si]!;
  s.rows.splice(at, count);
  s.format = deleteRowsFormat(s.format, at, count);
  rewriteFormulas(wb, si, 'row', at, -count);
}

export function insertCols(wb: Workbook, si: number, at: number, count = 1) {
  const s = wb.sheets[si]!;
  for (const row of s.rows)
    if (row && row.length > at) row.splice(at, 0, ...new Array<Cell | undefined>(count));
  if (s.widths && s.widths.length > at) s.widths.splice(at, 0, ...new Array<number>(count));
  s.format = insertColsFormat(s.format, at, count);
  rewriteFormulas(wb, si, 'col', at, count);
}

export function deleteCols(wb: Workbook, si: number, at: number, count = 1) {
  const s = wb.sheets[si]!;
  for (const row of s.rows) row?.splice(at, count);
  s.widths?.splice(at, count);
  s.format = deleteColsFormat(s.format, at, count);
  rewriteFormulas(wb, si, 'col', at, -count);
}

/**
 * Moves `count` columns starting at `from` so the block begins at column `to` (counted after
 * the block is taken out, so `to` is where its first column ends up). Cells, widths, colors
 * and every formula that points at the columns follow them. Returns false if nothing moves.
 */
export function moveCols(wb: Workbook, si: number, from: number, count: number, to: number) {
  const s = wb.sheets[si]!;
  if (count < 1 || from < 0 || to < 0 || from === to) return false;
  // A loop, not Math.max(...rows): a spread of tens of thousands of rows is slow and can overflow.
  let width = Math.max(from + count, to + count);
  for (const row of s.rows) if (row && row.length > width) width = row.length;
  // order[new] = old
  const order = Array.from({ length: width }, (_, i) => i);
  const block = order.splice(from, count);
  order.splice(to, 0, ...block);
  const newOf = new Map(order.map((old, now) => [old, now]));
  const permute = <T>(row: readonly (T | undefined)[]): (T | undefined)[] => {
    const out = order.map((old) => row[old]);
    // Trailing blanks go, so a row stays as short as its last cell.
    while (out.length && out[out.length - 1] === undefined) out.pop();
    return out;
  };
  for (let r = 0; r < s.rows.length; r++) {
    const row = s.rows[r];
    if (row?.length) s.rows[r] = permute(row);
  }
  if (s.widths) s.widths = permute(s.widths) as number[]; // holes mean "default width"
  s.format = permuteColsFormat(s.format, order);
  rewriteRefs(wb, si, (refs) => permuteColRefs(refs, (c) => newOf.get(c) ?? c));
  return true;
}

/** Where a block of `count` columns starting at `first` should start to move one step or to an end; null if it can't. */
export function colMoveTarget(
  first: number,
  count: number,
  where: 'left' | 'right' | 'start' | 'end',
  totalCols: number,
): number | null {
  const last = totalCols - count;
  const to =
    where === 'left' ? first - 1 : where === 'right' ? first + 1 : where === 'start' ? 0 : last;
  return to < 0 || to > last || to === first ? null : to;
}

/**
 * Sorts rows below the header by one column. Rows holding formulas are not moved
 * (their references would silently change meaning); the caller is told instead.
 */
export function sortRows(
  s: Sheet,
  col: number,
  dir: 'asc' | 'desc',
  headerRows = 1,
): { ok: boolean } {
  const body = s.rows.slice(headerRows).map((row, i) => ({ row, at: i + headerRows }));
  if (body.some(({ row }) => row?.some((c) => c?.f !== undefined))) return { ok: false };
  const key = (r: (Cell | undefined)[] | undefined) => r?.[col]?.v ?? null;
  body.sort((a, b) => {
    const x = key(a.row);
    const y = key(b.row);
    if (x === null && y === null) return 0;
    if (x === null) return 1; // blanks last either way
    if (y === null) return -1;
    let cmp: number;
    if (typeof x === 'number' && typeof y === 'number') cmp = x - y;
    else if (typeof x === 'number') cmp = -1;
    else if (typeof y === 'number') cmp = 1;
    else
      cmp = String(typeof x === 'object' ? x.error : x).localeCompare(
        String(typeof y === 'object' ? y.error : y),
        undefined,
        { numeric: true, sensitivity: 'base' },
      );
    return dir === 'asc' ? cmp : -cmp;
  });
  s.rows.splice(headerRows, body.length, ...body.map((b) => b.row));
  // Colors stay with their rows.
  const order = Array.from({ length: headerRows + body.length }, (_, i) =>
    i < headerRows ? i : body[i - headerRows]!.at,
  );
  s.format = permuteRowsFormat(s.format, order);
  return { ok: true };
}

export function cloneWorkbook(wb: Workbook): Workbook {
  return structuredClone(wb);
}

export function usedSize(s: Sheet) {
  return sheetSize(s);
}

// ------------------------------------------------------------------ sheets

const quoteSheet = (n: string) => (/^[A-Za-z_][\w.]*$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`);

/** Adds an empty sheet after `after` (or at the end) and returns its index. */
export function addSheet(wb: Workbook, after = wb.sheets.length - 1): number {
  const taken = new Set(wb.sheets.map((x) => x.name.toLowerCase()));
  let n = wb.sheets.length + 1;
  while (taken.has(`sheet${n}`)) n++;
  const at = Math.max(0, Math.min(after + 1, wb.sheets.length));
  wb.sheets.splice(at, 0, { name: cleanSheetName(`Sheet${n}`, taken), rows: [] });
  return at;
}

/** Copies a sheet (values, formulas, colors) right after it and returns the copy's index. */
export function duplicateSheet(wb: Workbook, si: number): number {
  const copy = structuredClone(wb.sheets[si]!);
  const taken = new Set(wb.sheets.map((x) => x.name.toLowerCase()));
  copy.name = cleanSheetName(`Copy of ${copy.name}`, taken);
  wb.sheets.splice(si + 1, 0, copy);
  return si + 1;
}

/**
 * Removes a sheet. Formulas elsewhere that point into it become #REF!, as in Excel.
 * The last sheet can't be removed.
 */
export function deleteSheet(wb: Workbook, si: number): boolean {
  if (wb.sheets.length < 2 || !wb.sheets[si]) return false;
  const [gone] = wb.sheets.splice(si, 1);
  for (const s of wb.sheets)
    for (const row of s.rows)
      for (const cell of row ?? [])
        if (cell?.f !== undefined)
          cell.f = splitQualified(cell.f)
            .map((p) =>
              p.qualified && p.sheet?.toLowerCase() === gone!.name.toLowerCase() ? '#REF!' : p.text,
            )
            .join('');
  return true;
}

export function moveSheet(wb: Workbook, from: number, to: number): boolean {
  if (from === to || !wb.sheets[from] || to < 0 || to >= wb.sheets.length) return false;
  const [s] = wb.sheets.splice(from, 1);
  wb.sheets.splice(to, 0, s!);
  return true;
}

/** Renames a sheet (to a name Excel accepts) and updates formulas that name it. Returns the final name. */
export function renameSheet(wb: Workbook, si: number, name: string): string {
  const taken = new Set(wb.sheets.filter((_, k) => k !== si).map((x) => x.name.toLowerCase()));
  const clean = cleanSheetName(name, taken);
  const old = wb.sheets[si]!.name;
  wb.sheets[si]!.name = clean;
  for (const sh of wb.sheets)
    for (const row of sh.rows)
      for (const cell of row ?? [])
        if (cell?.f) cell.f = cell.f.split(`${quoteSheet(old)}!`).join(`${quoteSheet(clean)}!`);
  return clean;
}
