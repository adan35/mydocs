import { cleanSheetName } from '@/lib/convert/xlsx';
import { displayValue, parseInput, type Cell, type Workbook } from '@/lib/convert/workbook';

export const NUMBER_FORMATS = [
  { label: 'Automatic', code: '' },
  { label: 'Number', code: '#,##0.00' },
  { label: 'Percent', code: '0.00%' },
  { label: 'Currency (USD)', code: '"$"#,##0.00' },
  { label: 'Date', code: 'yyyy-mm-dd' },
  { label: 'Plain text', code: '@' },
] as const;

export function formatCell(cell: Cell | undefined, code: string): Cell {
  if (code === '@' && !cell?.f) return { v: displayValue(cell), fmt: '@' };
  const next = { ...(cell ?? { v: null }) };
  if (code) next.fmt = code;
  else delete next.fmt;
  return next;
}

export function parseCellInput(input: string, prev?: Cell): Cell | undefined {
  if (input === '') return prev?.fmt ? { v: null, fmt: prev.fmt } : undefined;
  if (prev?.fmt === '@') return { v: input, fmt: '@' };
  const next = parseInput(input, prev);
  if (next && !next.fmt && prev?.fmt) next.fmt = prev.fmt;
  return next;
}

const quotedName = (name: string) => `'${name.replace(/'/g, "''")}'`;

/** Matches quoted sheet names and references while protecting Excel text literals. */
function rewriteSheetRefs(formula: string, oldName: string, newName: string | null): string {
  return formula.replace(
    /"(?:[^"]|"")*"|('(?:[^']|'')+'|[A-Za-z_][\w.]*)!(\$?[A-Za-z_][\w.$]*(?::\$?[A-Za-z_][\w.$]*)?|\$?\d+(?::\$?\d+)?)?/g,
    (match: string, prefix: string | undefined, reference: string | undefined, offset: number) => {
      if (!prefix) return match;
      // An external workbook can have a sheet with the same name.
      if (formula[offset - 1] === ']') return match;
      const name = prefix.startsWith("'") ? prefix.slice(1, -1).replace(/''/g, "'") : prefix;
      if (name.toLowerCase() !== oldName.toLowerCase()) return match;
      return newName === null ? '#REF!' : `${quotedName(newName)}!${reference ?? ''}`;
    },
  );
}

export function renameSheet(book: Workbook, index: number, name: string): string {
  const sheet = book.sheets[index]!;
  const taken = new Set(book.sheets.filter((_, i) => i !== index).map((s) => s.name.toLowerCase()));
  const clean = cleanSheetName(name, taken);
  const old = sheet.name;
  sheet.name = clean;
  for (const s of book.sheets)
    for (const row of s.rows)
      for (const cell of row ?? []) if (cell?.f) cell.f = rewriteSheetRefs(cell.f, old, clean);
  return clean;
}

export function duplicateSheet(book: Workbook, index: number): number {
  const copy = structuredClone(book.sheets[index]!);
  const old = copy.name;
  copy.name = cleanSheetName(
    `${copy.name} copy`,
    new Set(book.sheets.map((s) => s.name.toLowerCase())),
  );
  for (const row of copy.rows)
    for (const cell of row ?? []) if (cell?.f) cell.f = rewriteSheetRefs(cell.f, old, copy.name);
  book.sheets.splice(index + 1, 0, copy);
  return index + 1;
}

export function deleteSheet(book: Workbook, index: number): boolean {
  if (book.sheets.length <= 1) return false;
  const old = book.sheets[index]!.name;
  book.sheets.splice(index, 1);
  for (const s of book.sheets)
    for (const row of s.rows)
      for (const cell of row ?? []) if (cell?.f) cell.f = rewriteSheetRefs(cell.f, old, null);
  return true;
}
