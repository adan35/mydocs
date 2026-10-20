import { describe, expect, it } from 'vitest';
import { rangeBounds, selectionSummary } from './selection';
import { markdownCellText } from './markdown-cell';

describe('sheet selection', () => {
  it('normalizes a rectangle selected backwards', () => {
    expect(rangeBounds({ r: 4, c: 3 }, { r: 1, c: 0 })).toEqual({
      from: { r: 1, c: 0 },
      to: { r: 4, c: 3 },
    });
  });
  it('counts text and booleans, aggregates numeric values and ignores spare cells', () => {
    const sheet = {
      name: 'Data',
      rows: [
        [{ v: 0 }, { v: 10 }, { v: '007' }],
        [{ v: -4 }, { v: true }, { v: '' }],
        [{ v: null }],
      ],
    };
    expect(selectionSummary(sheet, { r: 0, c: 0 }, { r: 1000000, c: 700 })).toEqual({
      count: 5,
      numbers: 3,
      sum: 6,
      average: 2,
    });
    expect(selectionSummary(sheet, { r: 1, c: 1 }, { r: 2, c: 2 })).toEqual({
      count: 1,
      numbers: 0,
      sum: 0,
      average: 0,
    });
  });
  it('includes portable CSV numbers without interpreting leading-zero identifiers', () => {
    expect(
      selectionSummary(
        { name: 'CSV', rows: [[{ v: '2' }, { v: '3.5' }, { v: '007' }]] },
        { r: 0, c: 0 },
        { r: 0, c: 2 },
      ),
    ).toEqual({ count: 3, numbers: 2, sum: 5.5, average: 2.75 });
  });
});

describe('Markdown cell display', () => {
  it('shows link labels, code and formatting without changing their source', () => {
    expect(markdownCellText('[Tauri 2](https://tauri.app) **Desktop** `src-tauri/`')).toBe(
      'Tauri 2 Desktop src-tauri/',
    );
    expect(markdownCellText('007 &amp; 0042')).toBe('007 & 0042');
  });
  it('keeps image descriptions and line breaks while treating HTML safely', () => {
    expect(markdownCellText('![Receipt](https://example.com/receipt.png)<br>Next')).toBe(
      'Receipt\nNext',
    );
    expect(markdownCellText('<script>alert(1)</script>Safe')).toBe('Safe');
  });
});
