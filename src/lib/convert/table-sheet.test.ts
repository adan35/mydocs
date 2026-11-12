import { describe, expect, it } from 'vitest';
import {
  autoSum,
  deleteRowsAt,
  evaluateRows,
  fillRange,
  columnValues,
  describeColumnFilter,
  filterRows,
  insertRowsAt,
  isFormulaText,
  parseEmphasis,
  rangeStats,
  sortRows,
  toggleEmphasis,
} from './table-sheet';
import { displayValue } from './workbook';
import { expandTemplate, TEMPLATES } from '@/domain/templates';
import { findMarkdownTables } from './delimited';

const shown = (rows: string[][]) => evaluateRows(rows, true);
const text = (rows: string[][], r: number, c: number) => displayValue(shown(rows).rows[r]?.[c]);

describe('formulas in text tables', () => {
  it('calculates formulas and leaves other text exactly as written', () => {
    const rows = [
      ['Item', 'Qty', 'Price', 'Total'],
      ['Pens', '3', '$1.50', '=B2*C2'],
      ['Ink', '2', '4', '=B3*C3'],
      ['Sum', '', '', '=SUM(D2:D3)'],
    ];
    expect(text(rows, 1, 3)).toBe('4.5');
    expect(text(rows, 3, 3)).toBe('12.5');
    expect(text(rows, 1, 2)).toBe('$1.50');
    expect(shown(rows).rows[1]![3]!.f).toBe('B2*C2');
  });

  it('treats unparseable and unsupported formulas honestly', () => {
    expect(isFormulaText('=SUM(')).toBe(false);
    expect(isFormulaText('= apples')).toBe(false);
    expect(isFormulaText('=')).toBe(false);
    expect(text([['=FOO(1)']], 0, 0)).toBe('#NAME?');
    expect(text([['=1/0']], 0, 0)).toBe('#DIV/0!');
  });

  it('keeps references right when rows are inserted or deleted', () => {
    const rows = [['h'], ['1'], ['2'], ['3'], ['=SUM(A2:A4)']];
    expect(insertRowsAt(rows, 2)[5]![0]).toBe('=SUM(A2:A5)');
    expect(deleteRowsAt(rows, 3)[3]![0]).toBe('=SUM(A2:A3)');
    expect(deleteRowsAt(rows, 1, 3)[1]![0]).toBe('=SUM(#REF!)');
  });

  it('fills down and right, moving relative references', () => {
    const rows = [
      ['1', '2'],
      ['=A1+1', ''],
      ['', ''],
    ];
    expect(fillRange(rows, [1, 0, 2, 0], 'down')![2]![0]).toBe('=A2+1');
    expect(fillRange(rows, [1, 0, 1, 1], 'right')![1]![1]).toBe('=B1+1');
    expect(fillRange(rows, [0, 0, 0, 0], 'down')).toBeNull();
  });

  it('sorts by what cells show and moves formulas with their row', () => {
    const rows = [
      ['n', 'x', 'double'],
      ['b', '10', '=B2*2'],
      ['a', '9', '=B3*2'],
      ['c', '', ''],
    ];
    const out = sortRows(rows, shown(rows), 1, 'asc', 1);
    expect(out.map((r) => r[0])).toEqual(['n', 'a', 'b', 'c']);
    expect(out[1]![2]).toBe('=B2*2');
    expect(text(out, 2, 2)).toBe('20');
  });

  it('adds up numbers above, beside or in a selected range', () => {
    const rows = [
      ['h', 'k'],
      ['1', '5'],
      ['2', '6'],
      ['', ''],
    ];
    const one = autoSum(rows, shown(rows), [3, 0, 3, 0])!;
    expect(one.rows[3]![0]).toBe('=SUM(A2:A3)');
    const range = autoSum(rows, shown(rows), [1, 0, 2, 1])!;
    expect(range.rows[3]).toEqual(['=SUM(A2:A3)', '=SUM(B2:B3)']);
    expect(autoSum([['x']], shown([['x']]), [0, 0, 0, 0])).toBeNull();
  });

  it('measures a selection', () => {
    const rows = [
      ['3', 'a'],
      ['4.5', ''],
    ];
    expect(rangeStats(shown(rows), [0, 0, 1, 1], true)).toMatchObject({
      count: 3,
      numbers: 2,
      sum: 7.5,
      min: 3,
      max: 4.5,
    });
  });
});

describe('text formatting and filters', () => {
  it('toggles Markdown emphasis across a range', () => {
    const rows = [
      ['a', '**b**'],
      ['', '=1+1'],
    ];
    const on = toggleEmphasis(rows, [0, 0, 1, 1], 'bold');
    expect(on).toEqual([
      ['**a**', '**b**'],
      ['', '=1+1'],
    ]);
    expect(toggleEmphasis(on, [0, 0, 0, 1], 'bold')[0]).toEqual(['a', 'b']);
    expect(toggleEmphasis([['x']], [0, 0, 0, 0], 'italic')[0]![0]).toBe('*x*');
    expect(parseEmphasis('~~***x***~~')).toMatchObject({
      bold: true,
      italic: true,
      strike: true,
      text: 'x',
    });
    expect(parseEmphasis('**a** and **b**').bold).toBe(false);
  });

  it('filters rows but keeps the header', () => {
    const rows = [
      ['n', 'v'],
      ['a', '5'],
      ['b', '15'],
      ['c', ''],
    ];
    const s = shown(rows);
    expect(filterRows(s, { 1: { cond: { op: 'greater', value: '10' } } }, 1)).toEqual([0, 2]);
    expect(filterRows(s, { 0: { cond: { op: 'contains', value: 'A' } } }, 1)).toEqual([0, 1]);
    expect(filterRows(s, { 1: { cond: { op: 'empty', value: '' } } }, 1)).toEqual([0, 3]);
  });

  it('filters by the values ticked in a column, and combines columns', () => {
    const s = shown([
      ['cat', 'n'],
      ['Surgical', '5'],
      ['Medicine', '15'],
      ['Surgical', '25'],
      ['', '30'],
    ]);
    expect(filterRows(s, { 0: { include: ['Surgical'] } }, 1)).toEqual([0, 1, 3]);
    expect(filterRows(s, { 0: { include: [''] } }, 1)).toEqual([0, 4]);
    // A value filter and a condition on other columns must both hold.
    const both = {
      0: { include: ['Surgical'] },
      1: { cond: { op: 'greater' as const, value: '10' } },
    };
    expect(filterRows(s, both, 1)).toEqual([0, 3]);
    // An empty filter lets everything through.
    expect(filterRows(s, { 0: {} }, 1)).toEqual([0, 1, 2, 3, 4]);
  });

  it("lists a column's values with counts, narrowed by the other columns only", () => {
    const s = shown([
      ['cat', 'n'],
      ['Surgical', '5'],
      ['Medicine', '15'],
      ['Surgical', '25'],
      ['', '30'],
    ]);
    expect(columnValues(s, 0, {}, 1)).toEqual([
      { text: 'Medicine', count: 1 },
      { text: 'Surgical', count: 2 },
      { text: '', count: 1 },
    ]);
    // Its own filter does not hide the other choices; another column's does.
    expect(columnValues(s, 0, { 0: { include: ['Surgical'] } }, 1)).toHaveLength(3);
    expect(columnValues(s, 0, { 1: { cond: { op: 'less', value: '20' } } }, 1)).toEqual([
      { text: 'Medicine', count: 1 },
      { text: 'Surgical', count: 1 },
    ]);
    // Numbers sort as numbers.
    expect(columnValues(s, 1, {}, 1).map((v) => v.text)).toEqual(['5', '15', '25', '30']);
  });

  it('describes a filter for its chip', () => {
    expect(describeColumnFilter({ include: ['A', 'B'] })).toBe('A, B');
    expect(describeColumnFilter({ include: ['1', '2', '3', '4'] })).toBe('4 values');
    expect(describeColumnFilter({ cond: { op: 'contains', value: 'x' } })).toBe('contains “x”');
    expect(describeColumnFilter({ include: [''], cond: { op: 'filled', value: '' } })).toBe(
      '(empty) and is not empty',
    );
  });

  it('filters 40,000 rows quickly', () => {
    const rows = [['id', 'cat']];
    for (let i = 0; i < 40_000; i++) rows.push([String(i), ['A', 'B', 'C', 'D'][i % 4]!]);
    const s = shown(rows);
    const t = performance.now();
    const out = filterRows(s, { 1: { include: ['B', 'C'] } }, 1);
    columnValues(s, 1, {}, 1);
    expect(out).toHaveLength(20_001);
    expect(performance.now() - t).toBeLessThan(1000);
  });
});

describe('meeting minutes template', () => {
  it('expands completely and contains editable tables', () => {
    const t = TEMPLATES.find((x) => x.id === 'minutes')!;
    const body = expandTemplate(t.body, {
      title: 'Weekly sync',
      date: '2026-10-26',
      time: '09:30',
    });
    expect(body).not.toMatch(/\{\{/);
    expect(body).toContain('# Weekly sync');
    const tables = findMarkdownTables(body);
    expect(tables.map((x) => x.label)).toEqual(['👥 Attendees', '✅ Decisions', '🎯 Action items']);
  });
});
