/**
 * Structural edits on a sheet (rows, columns, sorting). Formulas on every sheet keep
 * pointing at the same cells; references to deleted cells become #REF!, as in Excel.
 */
import { moveRefs } from './formula';
import { sheetSize, type Cell, type Sheet, type Workbook } from './workbook';

function rewriteFormulas(
  wb: Workbook,
  sheetIndex: number,
  axis: 'row' | 'col',
  at: number,
  delta: number,
) {
  const name = wb.sheets[sheetIndex]!.name.toLowerCase();
  wb.sheets.forEach((s, si) => {
    for (const row of s.rows)
      for (const cell of row ?? []) {
        if (cell?.f === undefined) continue;
        if (si === sheetIndex) {
          // References to other sheets must not move; protect them by checking the prefix.
          cell.f = moveLocal(cell.f, axis, at, delta);
        } else if (
          cell.f.toLowerCase().includes(`${name}!`) ||
          cell.f.toLowerCase().includes(`'${name}'!`)
        ) {
          cell.f = moveQualified(cell.f, wb.sheets[sheetIndex]!.name, axis, at, delta);
        }
      }
  });
}

/** Moves unqualified references only. */
function moveLocal(f: string, axis: 'row' | 'col', at: number, delta: number): string {
  return splitQualified(f)
    .map((p) => (p.qualified ? p.text : moveRefs(p.text, axis, at, delta)))
    .join('');
}

/** Moves references qualified with `sheet` only. */
function moveQualified(
  f: string,
  sheet: string,
  axis: 'row' | 'col',
  at: number,
  delta: number,
): string {
  return splitQualified(f)
    .map((p) =>
      p.qualified && p.sheet?.toLowerCase() === sheet.toLowerCase()
        ? p.prefix + moveRefs(p.text.slice(p.prefix.length), axis, at, delta)
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
  rewriteFormulas(wb, si, 'row', at, count);
}

export function deleteRows(wb: Workbook, si: number, at: number, count = 1) {
  const s = wb.sheets[si]!;
  s.rows.splice(at, count);
  rewriteFormulas(wb, si, 'row', at, -count);
}

export function insertCols(wb: Workbook, si: number, at: number, count = 1) {
  const s = wb.sheets[si]!;
  for (const row of s.rows)
    if (row && row.length > at) row.splice(at, 0, ...new Array<Cell | undefined>(count));
  if (s.widths && s.widths.length > at) s.widths.splice(at, 0, ...new Array<number>(count));
  rewriteFormulas(wb, si, 'col', at, count);
}

export function deleteCols(wb: Workbook, si: number, at: number, count = 1) {
  const s = wb.sheets[si]!;
  for (const row of s.rows) row?.splice(at, count);
  s.widths?.splice(at, count);
  rewriteFormulas(wb, si, 'col', at, -count);
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
  const body = s.rows.slice(headerRows);
  if (body.some((r) => r?.some((c) => c?.f !== undefined))) return { ok: false };
  const key = (r: (Cell | undefined)[] | undefined) => r?.[col]?.v ?? null;
  body.sort((a, b) => {
    const x = key(a);
    const y = key(b);
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
  s.rows.splice(headerRows, body.length, ...body);
  return { ok: true };
}

export function cloneWorkbook(wb: Workbook): Workbook {
  return structuredClone(wb);
}

export function usedSize(s: Sheet) {
  return sheetSize(s);
}
