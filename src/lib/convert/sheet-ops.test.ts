import { describe, expect, it } from 'vitest';
import { recalculate } from './formula';
import {
  addSheet,
  deleteRows,
  deleteSheet,
  duplicateSheet,
  insertRows,
  moveCols,
  moveSheet,
  renameSheet,
  sortRows,
} from './sheet-ops';
import { resolveStyle } from './sheet-format';
import { displayValue, parseInput, type Workbook } from './workbook';

const sheet = (name: string, rows: string[][]) => ({
  name,
  rows: rows.map((r) => r.map((v) => parseInput(v))),
});
const book = (): Workbook => {
  const wb: Workbook = {
    sheets: [
      sheet('Data', [['10'], ['20']]),
      sheet('Total', [['=SUM(Data!A1:A2)'], ["=Data!A1+'Data'!A2"]]),
    ],
  };
  recalculate(wb);
  return wb;
};

describe('sheets', () => {
  it('adds a sheet after the given one with a free name', () => {
    const wb = book();
    wb.sheets[0]!.name = 'Sheet3';
    expect(addSheet(wb, 0)).toBe(1);
    expect(wb.sheets.map((s) => s.name)).toEqual(['Sheet3', 'Sheet4', 'Total']);
  });

  it('duplicates a sheet with its values, formulas and colors, under a new name', () => {
    const wb = book();
    wb.sheets[0]!.format = { cells: { '0,0': { bg: '#ff0000' } } };
    wb.sheets[0]!.tabColor = '#00ff00';
    expect(duplicateSheet(wb, 0)).toBe(1);
    const copy = wb.sheets[1]!;
    expect(copy.name).toBe('Copy of Data');
    expect(copy.tabColor).toBe('#00ff00');
    expect(resolveStyle(copy.format, 0, 0)).toEqual({ bg: '#ff0000' });
    // Editing the copy leaves the original alone.
    copy.rows[0]![0] = parseInput('99');
    expect(displayValue(wb.sheets[0]!.rows[0]![0])).toBe('10');
  });

  it('deleting a sheet turns formulas that used it into #REF! and keeps the last sheet', () => {
    const wb = book();
    expect(deleteSheet(wb, 0)).toBe(true);
    recalculate(wb);
    expect(wb.sheets.map((s) => s.name)).toEqual(['Total']);
    expect(displayValue(wb.sheets[0]!.rows[0]![0])).toBe('#REF!');
    expect(deleteSheet(wb, 0)).toBe(false);
  });

  it('reorders sheets and ignores impossible moves', () => {
    const wb = book();
    expect(moveSheet(wb, 0, 1)).toBe(true);
    expect(wb.sheets.map((s) => s.name)).toEqual(['Total', 'Data']);
    expect(moveSheet(wb, 0, 5)).toBe(false);
    recalculate(wb);
    expect(displayValue(wb.sheets[0]!.rows[0]![0])).toBe('30');
  });

  it('renaming keeps formulas pointing at the sheet, quoting names that need it', () => {
    const wb = book();
    expect(renameSheet(wb, 0, 'Q1 [draft]')).toBe('Q1  draft');
    recalculate(wb);
    expect(wb.sheets[1]!.rows[0]![0]!.f).toBe("SUM('Q1  draft'!A1:A2)");
    expect(displayValue(wb.sheets[1]!.rows[0]![0])).toBe('30');
    // Names stay unique, ignoring case.
    expect(renameSheet(wb, 0, 'total')).toBe('total (2)');
  });
});

describe('colors follow structural edits', () => {
  const colored = (): Workbook => {
    const wb: Workbook = { sheets: [sheet('S', [['b'], ['a'], ['c']])] };
    wb.sheets[0]!.format = { cells: { '1,0': { bg: '#ff0000' } } };
    return wb;
  };

  it('moves with inserted and deleted rows', () => {
    const wb = colored();
    insertRows(wb, 0, 0);
    expect(resolveStyle(wb.sheets[0]!.format, 2, 0)).toEqual({ bg: '#ff0000' });
    deleteRows(wb, 0, 0);
    deleteRows(wb, 0, 1);
    expect(wb.sheets[0]!.format).toBeUndefined();
  });

  it('stays with its row when the sheet is sorted', () => {
    const wb = colored();
    expect(sortRows(wb.sheets[0]!, 0, 'asc', 0).ok).toBe(true);
    // "a" was the colored row and sorts first.
    expect(displayValue(wb.sheets[0]!.rows[0]![0])).toBe('a');
    expect(resolveStyle(wb.sheets[0]!.format, 0, 0)).toEqual({ bg: '#ff0000' });
    expect(resolveStyle(wb.sheets[0]!.format, 1, 0)).toEqual({});
  });
});

describe('moving columns', () => {
  const grid = (): Workbook => {
    const wb: Workbook = {
      sheets: [
        sheet('S', [
          ['a', 'b', 'c', 'd'],
          ['1', '2', '3', '=A2+C2'],
        ]),
        sheet('T', [['=S!B2*10', '=SUM(S!A2:C2)']]),
      ],
    };
    wb.sheets[0]!.widths = [10, 20, 30, 40];
    wb.sheets[0]!.format = {
      cols: { '1': { bg: '#ff0000' } },
      cells: { '1,2': { fg: '#0000ff' } },
    };
    recalculate(wb);
    return wb;
  };
  const row = (wb: Workbook, r: number) => wb.sheets[0]!.rows[r]!.map((c) => displayValue(c));

  it('moves cells, widths and colors with the column', () => {
    const wb = grid();
    expect(moveCols(wb, 0, 1, 1, 3)).toBe(true); // b to the end
    expect(row(wb, 0)).toEqual(['a', 'c', 'd', 'b']);
    expect(wb.sheets[0]!.widths).toEqual([10, 30, 40, 20]);
    expect(resolveStyle(wb.sheets[0]!.format, 5, 3)).toEqual({ bg: '#ff0000' });
    expect(resolveStyle(wb.sheets[0]!.format, 1, 1)).toEqual({ fg: '#0000ff' });
  });

  it('keeps formulas on every sheet pointing at the same cells', () => {
    const wb = grid();
    moveCols(wb, 0, 0, 1, 2); // a to between c and d: b c a d
    recalculate(wb);
    expect(row(wb, 1)).toEqual(['2', '3', '1', '4']);
    expect(wb.sheets[0]!.rows[1]![3]!.f).toBe('C2+B2');
    expect(wb.sheets[1]!.rows[0]![0]!.f).toBe('S!A2*10');
    expect(displayValue(wb.sheets[1]!.rows[0]![0])).toBe('20');
    // A range's ends follow their cells: A2:C2 becomes C2:B2, which now spans c and a.
    expect(displayValue(wb.sheets[1]!.rows[0]![1])).toBe('4');
  });

  it('moves several columns as one block, and into empty columns', () => {
    const wb = grid();
    moveCols(wb, 0, 2, 2, 0);
    expect(row(wb, 0)).toEqual(['c', 'd', 'a', 'b']);
    moveCols(wb, 0, 0, 1, 6);
    expect(wb.sheets[0]!.rows[0]![6]!.v).toBe('c');
    expect(wb.sheets[0]!.rows[0]![0]!.v).toBe('d');
  });

  it('does nothing when the column would stay where it is', () => {
    expect(moveCols(grid(), 0, 1, 1, 1)).toBe(false);
  });

  it('moves 40,000 rows quickly', () => {
    const wb: Workbook = {
      sheets: [
        { name: 'Big', rows: Array.from({ length: 40_000 }, (_, i) => [{ v: i }, { v: 'x' }]) },
      ],
    };
    const t = performance.now();
    moveCols(wb, 0, 1, 1, 0);
    expect(performance.now() - t).toBeLessThan(500);
    expect(wb.sheets[0]!.rows[39_999]![1]!.v).toBe(39_999);
  });
});
