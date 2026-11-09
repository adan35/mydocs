/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { xlsToWorkbook } from './xls';
import { xlsxToWorkbook } from './xlsx';
import { ops } from './ops';
import { recalculate } from './formula';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(resolve(process.cwd(), 'fixtures', name)));

// functions.xls is functions.xlsx saved by LibreOffice as Excel 97-2003 (BIFF8).
describe('xls reading', () => {
  const xls = xlsToWorkbook(fixture('functions.xls'));
  const xlsx = xlsxToWorkbook(fixture('functions.xlsx'));

  it('keeps sheets, text, numbers and dates', () => {
    expect(xls.workbook.sheets.map((s) => s.name)).toEqual(['Data', 'Second Sheet']);
    const data = xls.workbook.sheets[0]!.rows;
    expect(data[0]!.map((c) => c?.v)).toEqual([
      'Region',
      'Units',
      'Price',
      'Total',
      'Date',
      'Note',
    ]);
    expect(data[1]![5]!.v).toBe('héllo wörld 日本語');
    expect(data[4]![1]!.v).toBe(1234567);
    expect(data[1]![4]!.v).toBe(46024); // 2026-01-02 as a serial number
    expect(data[1]![4]!.fmt).toMatch(/yyyy/);
    expect(data[6]![1]).toMatchObject({ v: 0.15, fmt: '0.0%' });
  });

  it('decodes every formula to the text the .xlsx has', () => {
    let formulas = 0;
    xlsx.workbook.sheets.forEach((sheet, si) =>
      sheet.rows.forEach((row, r) =>
        row?.forEach((cell, c) => {
          if (cell?.f === undefined || cell.f === 'TRUE') return;
          formulas++;
          expect(xls.workbook.sheets[si]!.rows[r]![c]!.f).toBe(cell.f);
        }),
      ),
    );
    expect(formulas).toBeGreaterThan(40);
  });

  it('recalculates to the values the file saved', () => {
    const saved = xlsToWorkbook(fixture('functions.xls')).workbook;
    recalculate(xls.workbook);
    saved.sheets.forEach((s, si) =>
      s.rows.forEach((row, r) =>
        row?.forEach((cell, c) => {
          if (cell?.f === undefined || /RAND/.test(cell.f)) return;
          const after = xls.workbook.sheets[si]!.rows[r]![c]!;
          if (!after.stale) expect(after.v).toEqual(cell.v);
        }),
      ),
    );
  });

  it('keeps fill and text colors, errors and column widths', () => {
    const data = xls.workbook.sheets[0]!;
    expect(data.format?.cells?.['0,0']?.bg).toBe('#ffff00');
    expect(data.format?.cells?.['0,1']?.fg).toBe('#ff0000');
    expect(data.rows[7]![2]!.v).toEqual({ error: '#DIV/0!' });
    expect(data.widths![0]).toBeCloseTo(24, 0);
  });

  it('refuses what it cannot read, with a reason', () => {
    expect(() => xlsToWorkbook(new Uint8Array(600))).toThrow(/not an Excel/);
  });
});

describe('reading a file by what it is, not by its name', () => {
  const read = (data: Uint8Array) => ops.readXlsx({ data }).workbook.sheets[0]!;

  it('opens .xls and .xlsx through the same operation', () => {
    expect(read(fixture('functions.xls')).rows[0]![0]!.v).toBe('Region');
    expect(read(fixture('functions.xlsx')).rows[0]![0]!.v).toBe('Region');
  });

  it('reads tab-separated text saved as .xls', () => {
    const sheet = read(new TextEncoder().encode('a\tb\n1\t2\n'));
    expect(sheet.rows[1]!.map((c) => c?.v)).toEqual([1, 2]);
  });

  it('explains HTML exports saved as .xls', () => {
    expect(() => read(new TextEncoder().encode('<html><table></table></html>'))).toThrow(
      /web page/,
    );
  });
});
