import { parseNumber, type Sheet } from '@/lib/convert/workbook';

interface Position {
  r: number;
  c: number;
}

export function rangeBounds(a: Position, b: Position) {
  return {
    from: { r: Math.min(a.r, b.r), c: Math.min(a.c, b.c) },
    to: { r: Math.max(a.r, b.r), c: Math.max(a.c, b.c) },
  };
}

/** Read only existing cells, even when the selected rectangle includes empty spare rows. */
export function selectionSummary(sheet: Sheet, a: Position, b: Position) {
  const { from, to } = rangeBounds(a, b);
  let count = 0;
  let numbers = 0;
  let sum = 0;
  for (let r = from.r; r <= Math.min(to.r, sheet.rows.length - 1); r++) {
    const row = sheet.rows[r];
    if (!row) continue;
    for (let c = from.c; c <= Math.min(to.c, row.length - 1); c++) {
      const cell = row[c];
      if (!cell || cell.v === null || cell.v === '') continue;
      count++;
      const number =
        typeof cell.v === 'number'
          ? cell.v
          : typeof cell.v === 'string'
            ? parseNumber(cell.v.trim())
            : null;
      if (number !== null && Number.isFinite(number)) {
        sum += number;
        numbers++;
      }
    }
  }
  return { count, numbers, sum, average: numbers ? sum / numbers : 0 };
}
