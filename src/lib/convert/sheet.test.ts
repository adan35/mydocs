/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { xlsxToWorkbook, workbookToXlsx } from './xlsx';
import { recalculate, parseFormula, shiftFormula, formulaSupported } from './formula';
import { displayValue, editValue, parseInput, type Workbook, type Sheet } from './workbook';
import {
  detectDialect,
  delimitedToSheet,
  findMarkdownTables,
  parseDelimited,
  rewriteDelimited,
  serializeDelimited,
  sheetToDelimited,
  sheetToTable,
  tableToSheet,
  typeTextCells,
} from './delimited';
import { serializeTable } from '@/domain/table';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(resolve(process.cwd(), 'fixtures', name)));
const cell = (wb: Workbook, sheet: number, a: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(a)!;
  const c = m[1]!.charCodeAt(0) - 65;
  return wb.sheets[sheet]!.rows[Number(m[2]) - 1]?.[c];
};

describe('xlsx reading', () => {
  const { workbook: wb, report } = xlsxToWorkbook(fixture('sales-libreoffice.xlsx'));

  it('keeps sheet names and order', () => {
    expect(wb.sheets.map((s) => s.name)).toEqual(['Sales 2026', 'Notes']);
  });

  it('keeps types: text with leading zeros, numbers, booleans, dates', () => {
    expect(cell(wb, 0, 'A2')).toEqual({ v: '007' });
    expect(cell(wb, 0, 'A3')!.v).toBe('0042');
    expect(cell(wb, 0, 'C2')!.v).toBe(3);
    expect(cell(wb, 0, 'F2')!.v).toBe(true);
    expect(cell(wb, 0, 'F3')!.v).toBe(false);
    expect(displayValue(cell(wb, 0, 'G2'))).toBe('2026-01-15');
    expect(displayValue(cell(wb, 0, 'D2'))).toBe('1.50');
  });

  it('keeps formulas with their cached results', () => {
    expect(cell(wb, 0, 'E2')).toMatchObject({ f: 'C2*D2', v: 4.5 });
    expect(cell(wb, 0, 'E6')).toMatchObject({ f: 'SUM(E2:E4)' });
    expect(displayValue(cell(wb, 0, 'E6'))).toBe('36.49');
    expect(displayValue(cell(wb, 0, 'E7'))).toBe('67%');
    expect(cell(wb, 1, 'B1')!.f).toBe("'Sales 2026'!E6*2");
    expect(cell(wb, 0, 'E8')!.f).toBe('xlookup("Pen",B2:B4,E2:E4)');
  });

  it('recalculates supported formulas and keeps cached values for the rest', () => {
    const before = cell(wb, 0, 'E8')!.v;
    const { stale } = recalculate(wb);
    expect(stale).toBe(1);
    expect(cell(wb, 0, 'E8')).toMatchObject({ v: before, stale: true });
    expect(cell(wb, 1, 'B1')!.v).toBeCloseTo(72.98);
    expect(report.notes.length).toBeGreaterThanOrEqual(0);
  });
});

describe('xlsx writing', () => {
  it('round-trips types, formulas, formats and sheet names', () => {
    const { workbook } = xlsxToWorkbook(fixture('sales-libreoffice.xlsx'));
    const { data } = workbookToXlsx(workbook);
    const { workbook: back } = xlsxToWorkbook(data);
    expect(back.sheets.map((s) => s.name)).toEqual(['Sales 2026', 'Notes']);
    expect(cell(back, 0, 'A2')!.v).toBe('007');
    expect(cell(back, 0, 'F2')!.v).toBe(true);
    expect(cell(back, 0, 'E6')).toMatchObject({ f: 'SUM(E2:E4)', fmt: '#,##0.00' });
    expect(displayValue(cell(back, 0, 'G3'))).toBe('2026-02-01');
    expect(back.sheets[0]!.widths?.[1]).toBe(18);
  });

  it('expands shared formulas', () => {
    expect(shiftFormula('C2*D2', 1, 0)).toBe('C3*D3');
    expect(shiftFormula('$C$2*D2+SUM(A1:B1)', 2, 1)).toBe('$C$2*E4+SUM(B3:C3)');
    expect(shiftFormula("'My Sheet'!A1+LOG10(B1)", 1, 0)).toBe("'My Sheet'!A2+LOG10(B2)");
    expect(shiftFormula('A1', -1, 0)).toBe('#REF!');
  });
});

describe('formulas', () => {
  const book = (rows: (string | number)[][]): Workbook => ({
    sheets: [{ name: 'S', rows: rows.map((r) => r.map((v) => parseInput(String(v)))) }],
  });
  const value = (rows: (string | number)[][], a: string) => {
    const wb = book(rows);
    recalculate(wb);
    return cell(wb, 0, a)!.v;
  };

  it('evaluates arithmetic with precedence', () => {
    expect(value([['=1+2*3^2', '=-2^2', '=(1+2)*3', '=10%']], 'A1')).toBe(19);
    expect(value([['=1+2*3^2', '=-2^2', '=(1+2)*3', '=10%']], 'B1')).toBe(4);
    expect(value([['=1+2*3^2', '=-2^2', '=(1+2)*3', '=10%']], 'D1')).toBe(0.1);
  });

  it('supports common functions and text', () => {
    const rows = [
      [
        1,
        2,
        3,
        'x',
        '=SUM(A1:C1)',
        '=AVERAGE(A1:C1)',
        '=IF(A1>0,"pos","neg")',
        '=CONCAT(D1,"-",A1)',
        '=COUNTIF(A1:C1,">1")',
        '=ROUND(2/3,2)',
      ],
    ];
    expect(value(rows, 'E1')).toBe(6);
    expect(value(rows, 'F1')).toBe(2);
    expect(value(rows, 'G1')).toBe('pos');
    expect(value(rows, 'H1')).toBe('x-1');
    expect(value(rows, 'I1')).toBe(2);
    expect(value(rows, 'J1')).toBe(0.67);
  });

  it('reports errors and cycles', () => {
    expect(value([['=1/0']], 'A1')).toEqual({ error: '#DIV/0!' });
    expect(value([['=B1', '=A1']], 'A1')).toEqual({ error: '#CIRC!' });
    expect(value([['="a"+1']], 'A1')).toEqual({ error: '#VALUE!' });
  });

  it('knows what it supports', () => {
    expect(formulaSupported('SUM(A1:A3)*2')).toBe(true);
    expect(formulaSupported('XLOOKUP(1,A:A,B:B)')).toBe(false);
    expect(() => parseFormula('1+')).toThrow();
  });
});

describe('cell input', () => {
  it('never changes typed text', () => {
    expect(parseInput('007')).toEqual({ v: '007' });
    expect(parseInput('12345678901234567890')).toEqual({ v: '12345678901234567890' });
    expect(parseInput("'42")).toEqual({ v: '42' });
    expect(parseInput('42')).toEqual({ v: 42 });
    expect(parseInput('true')).toEqual({ v: true });
    expect(parseInput('12%')).toEqual({ v: 0.12, fmt: '0%' });
    expect(displayValue(parseInput('2026-02-30'))).toBe('2026-02-30');
    expect(displayValue(parseInput('2026-02-28'))).toBe('2026-02-28');
    expect(editValue({ v: '42' })).toBe("'42");
    expect(editValue({ v: 'plain' })).toBe('plain');
  });
});

describe('delimited files', () => {
  it('parses quotes, embedded delimiters and newlines', () => {
    const text = 'a,b,c\n"x, y","say ""hi""","line\nbreak"\n007,,3\n';
    expect(parseDelimited(text, ',').rows).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'line\nbreak'],
      ['007', '', '3'],
    ]);
  });

  it('detects the delimiter and line ending, and writes the same dialect back', () => {
    const text = 'name;qty\r\nPen;007\r\nCup;2\r\n';
    const d = detectDialect(text, 'csv');
    expect(d).toMatchObject({ delimiter: ';', eol: '\r\n' });
    const { sheet } = delimitedToSheet(text, d);
    expect(sheetToDelimited(sheet, d).text).toBe(text);
  });

  it('quotes only what needs quoting', () => {
    const d = detectDialect('', 'tsv');
    expect(serializeDelimited([['a', 'b\tc', 'say "x"']], d)).toBe('a\t"b\tc"\t"say ""x"""\n');
  });

  it('rewrites only the edited row, keeping quoting elsewhere as it was', () => {
    const text = 'name,note\n"Pen","blue, fine"\n  Cup ,"two\nlines"\nLamp,x\n';
    const d = detectDialect(text, 'csv');
    const rows = parseDelimited(text, ',').rows;
    rows[3]![1] = 'y';
    expect(rewriteDelimited(text, rows, d)).toBe(
      'name,note\n"Pen","blue, fine"\n  Cup ,"two\nlines"\nLamp,y\n',
    );
    rows.push(['New', '']);
    expect(rewriteDelimited(text, rows, d)).toBe(
      'name,note\n"Pen","blue, fine"\n  Cup ,"two\nlines"\nLamp,y\nNew,\n',
    );
  });

  it('types only exact numbers when converting to a spreadsheet', () => {
    const { sheet } = delimitedToSheet('n\n007\n42\n4.50\nTRUE\n1e3\n', detectDialect('', 'csv'));
    const typed = typeTextCells(sheet).rows.map((r) => r[0]?.v);
    expect(typed).toEqual(['n', '007', 42, '4.50', true, '1e3']);
  });

  it('writes formulas as their values and says so', () => {
    const s: Sheet = { name: 'S', rows: [[{ v: 2, f: '1+1' }]] };
    const r = sheetToDelimited(s, detectDialect('', 'csv'));
    expect(r.text).toBe('2\n');
    expect(r.report.notes[0]!.message).toMatch(/formula/);
  });
});

describe('markdown tables', () => {
  const md =
    '# Doc\n\n## Prices\n\n| Item | Qty |\n| :--- | --: |\n| Pen | 007 |\n| a \\| b | 2 |\n\n```\n| not | a |\n| --- | --- |\n```\n\n| x |\n| - |\n| 1 |\n';

  it('finds every table outside code blocks, with its heading', () => {
    const t = findMarkdownTables(md);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ start: 4, end: 8, label: 'Prices' });
    expect(t[0]!.table.rows[0]).toEqual(['Pen', '007']);
  });

  it('round-trips a table through a sheet without changing it', () => {
    const t = findMarkdownTables(md)[0]!;
    const sheet = tableToSheet(t.table);
    expect(sheet.rows[2]![0]!.v).toBe('a | b');
    const back = sheetToTable(sheet, t.table.align);
    expect(serializeTable(back)).toBe(serializeTable(t.table));
  });
});

it.runIf(!!process.env.CONVERT_DUMP)('dumps the fixture export', async () => {
  const { writeFileSync } = await import('node:fs');
  const { workbook } = xlsxToWorkbook(fixture('sales-libreoffice.xlsx'));
  recalculate(workbook);
  writeFileSync(
    resolve(process.env.CONVERT_DUMP!, 'sales-out.xlsx'),
    workbookToXlsx(workbook).data,
  );
});

describe('number formats', () => {
  it('formats numbers like a spreadsheet', () => {
    const f = (v: number, fmt: string) => displayValue({ v, fmt });
    expect(f(1234.5, '#,##0.00')).toBe('1,234.50');
    expect(f(0.256, '0.0%')).toBe('25.6%');
    expect(f(5, '"$"#,##0.00')).toBe('$5.00');
    expect(f(-5, '#,##0;(#,##0)')).toBe('(5)');
    expect(f(7, '000')).toBe('007');
    expect(f(3.5, '0.00 "kg"')).toBe('3.50 kg');
    expect(f(46037, 'd mmm yyyy')).toBe('15 Jan 2026');
    expect(f(46037.5, 'yyyy-mm-dd hh:mm')).toBe('2026-01-15 12:00');
    expect(f(46037, 'yyyy\\-mm\\-dd')).toBe('2026-01-15');
  });
});
