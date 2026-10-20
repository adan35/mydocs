import { describe, expect, it } from 'vitest';
import { recalculate } from '@/lib/convert/formula';
import { workbookToXlsx, xlsxToWorkbook } from '@/lib/convert/xlsx';
import type { Workbook } from '@/lib/convert/workbook';
import {
  deleteSheet,
  duplicateSheet,
  formatCell,
  parseCellInput,
  renameSheet,
} from './workbook-controls';

const book = (): Workbook => ({
  sheets: [
    { name: "O'Brien", rows: [[{ v: 12 }]] },
    {
      name: 'Summary',
      rows: [
        [
          { v: 12, f: "'o''brien'!A1" },
          { v: "O'Brien!A1", f: '"O\'Brien!A1"' },
        ],
      ],
    },
  ],
});

describe('workbook sheet controls', () => {
  it('renames qualified references case-insensitively without changing formula text literals', () => {
    const wb = book();
    renameSheet(wb, 0, 'Quarter 1');
    expect(wb.sheets[1]!.rows[0]![0]!.f).toBe("'Quarter 1'!A1");
    expect(wb.sheets[1]!.rows[0]![1]!.f).toBe('"O\'Brien!A1"');
    recalculate(wb);
    expect(wb.sheets[1]!.rows[0]![0]!.v).toBe(12);
  });

  it('duplicates data and widths independently and keeps explicit self-references on the copy', () => {
    const wb: Workbook = {
      sheets: [{ name: 'Data', widths: [20], rows: [[{ v: 2 }, { v: 2, f: 'Data!A1' }]] }],
    };
    const index = duplicateSheet(wb, 0);
    expect(index).toBe(1);
    expect(wb.sheets[1]!.name).toBe('Data copy');
    expect(wb.sheets[1]!.rows[0]![1]!.f).toBe("'Data copy'!A1");
    wb.sheets[1]!.rows[0]![0]!.v = 7;
    wb.sheets[1]!.widths![0] = 30;
    recalculate(wb);
    expect(wb.sheets[1]!.rows[0]![1]!.v).toBe(7);
    expect(wb.sheets[0]!.rows[0]![0]!.v).toBe(2);
    expect(wb.sheets[0]!.widths![0]).toBe(20);
  });

  it('marks deleted sheet references as #REF! and refuses to remove the last sheet', () => {
    const wb = book();
    expect(deleteSheet(wb, 0)).toBe(true);
    expect(wb.sheets[0]!.rows[0]![0]!.f).toBe('#REF!');
    recalculate(wb);
    expect(wb.sheets[0]!.rows[0]![0]!.v).toEqual({ error: '#REF!' });
    expect(wb.sheets[0]!.rows[0]![1]!.f).toBe('"O\'Brien!A1"');
    expect(deleteSheet(wb, 0)).toBe(false);
  });

  it('keeps duplicate names within the Excel limit even when the original uses all 31 characters', () => {
    const wb: Workbook = { sheets: [{ name: 'A'.repeat(31), rows: [] }] };
    duplicateSheet(wb, 0);
    expect(wb.sheets[1]!.name.length).toBeLessThanOrEqual(31);
    expect(wb.sheets[1]!.name).not.toBe(wb.sheets[0]!.name);
    const back = xlsxToWorkbook(workbookToXlsx(wb).data).workbook;
    expect(back.sheets.map((s) => s.name)).toEqual(wb.sheets.map((s) => s.name));
  });

  it('keeps qualified column and row ranges while leaving external workbook references alone', () => {
    const wb: Workbook = {
      sheets: [
        { name: 'Data', rows: [] },
        {
          name: 'Summary',
          rows: [[{ v: null, f: 'SUM(Data!A:A,Data!1:3,Data!NamedRange,[Other.xlsx]Data!A1)' }]],
        },
      ],
    };
    renameSheet(wb, 0, 'Archive');
    expect(wb.sheets[1]!.rows[0]![0]!.f).toBe(
      "SUM('Archive'!A:A,'Archive'!1:3,'Archive'!NamedRange,[Other.xlsx]Data!A1)",
    );
    deleteSheet(wb, 0);
    expect(wb.sheets[0]!.rows[0]![0]!.f).toBe('SUM(#REF!,#REF!,#REF!,[Other.xlsx]Data!A1)');
  });
});

describe('workbook number formats', () => {
  it('round trips plain text, blank cell formats, dates and currency', () => {
    const wb: Workbook = {
      sheets: [
        {
          name: 'Data',
          rows: [
            [
              formatCell({ v: 12 }, '@'),
              formatCell(undefined, '0.00%'),
              formatCell({ v: 46037 }, 'yyyy-mm-dd'),
              formatCell({ v: 12 }, '"$"#,##0.00'),
            ],
          ],
        },
      ],
    };
    const { workbook: back } = xlsxToWorkbook(workbookToXlsx(wb).data);
    expect(back.sheets[0]!.rows[0]).toEqual(wb.sheets[0]!.rows[0]);
    const text = back.sheets[0]!.rows[0]![0];
    expect(parseCellInput('123', text)).toEqual({ v: '123', fmt: '@' });
    expect(parseCellInput('=1+2', text)).toEqual({ v: '=1+2', fmt: '@' });
  });

  it('keeps formulas when formatting and retains cell formats when replacing or clearing values', () => {
    const formula = { v: 2, f: '1+1' };
    expect(formatCell(formula, '@')).toEqual({ ...formula, fmt: '@' });
    const currency = formatCell({ v: 12 }, '"$"#,##0.00');
    expect(parseCellInput('=2+3', currency)).toEqual({ v: null, f: '2+3', fmt: currency.fmt });
    expect(parseCellInput('', currency)).toEqual({ v: null, fmt: currency.fmt });
  });
});
