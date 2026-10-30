import { describe, expect, it } from 'vitest';
import {
  applyColor,
  contrastText,
  deleteColsFormat,
  deleteRowsFormat,
  insertRowsFormat,
  normalizeColor,
  permuteRowsFormat,
  resolveStyle,
  sanitizeFormat,
  targetFor,
  type SheetFormat,
} from './sheet-format';

const RED = '#ff0000';
const BLUE = '#0000ff';
const cells = (r1: number, c1: number, r2 = r1, c2 = c1) => targetFor([r1, c1, r2, c2], 'cells');

describe('colors', () => {
  it('normalizes hex input and rejects the rest', () => {
    expect(normalizeColor('#FA0')).toBe('#ffaa00');
    expect(normalizeColor('00ff7f')).toBe('#00ff7f');
    expect(normalizeColor('red')).toBeNull();
    expect(normalizeColor('#12')).toBeNull();
    expect(normalizeColor(5)).toBeNull();
  });

  it('picks readable text for a fill', () => {
    expect(contrastText('#ffff00')).toBe('#1f1f1f');
    expect(contrastText('#073763')).toBe('#ffffff');
    expect(contrastText('#ffffff')).toBe('#1f1f1f');
  });
});

describe('painting', () => {
  it('paints a range of cells and reads it back', () => {
    const f = applyColor(undefined, cells(1, 1, 2, 2), 'bg', RED);
    expect(resolveStyle(f, 1, 1)).toEqual({ bg: RED });
    expect(resolveStyle(f, 2, 2)).toEqual({ bg: RED });
    expect(resolveStyle(f, 3, 3)).toEqual({});
  });

  it('keeps the fill and the text color apart', () => {
    let f = applyColor(undefined, cells(0, 0), 'bg', RED);
    f = applyColor(f, cells(0, 0), 'fg', BLUE);
    expect(resolveStyle(f, 0, 0)).toEqual({ bg: RED, fg: BLUE });
    f = applyColor(f, cells(0, 0), 'bg', null);
    expect(resolveStyle(f, 0, 0)).toEqual({ fg: BLUE });
  });

  it('does not change the format it was given', () => {
    const before = applyColor(undefined, cells(0, 0), 'bg', RED)!;
    const copy = structuredClone(before);
    applyColor(before, cells(0, 0, 3, 3), 'bg', BLUE);
    expect(before).toEqual(copy);
  });

  it('clearing the last color leaves no format at all', () => {
    const f = applyColor(undefined, cells(0, 0), 'bg', RED);
    expect(applyColor(f, cells(0, 0), 'bg', null)).toBeUndefined();
  });

  it('paints whole rows and columns as layers, for rows and columns not yet written', () => {
    const f = applyColor(undefined, targetFor([2, 0, 2, 0], 'rows'), 'bg', RED)!;
    expect(f.cells).toBeUndefined();
    expect(resolveStyle(f, 2, 500)).toEqual({ bg: RED });
    const g = applyColor(undefined, targetFor([0, 3, 0, 4], 'cols'), 'bg', BLUE)!;
    expect(resolveStyle(g, 9999, 4)).toEqual({ bg: BLUE });
    expect(resolveStyle(g, 0, 5)).toEqual({});
  });

  it('the last paint wins where a row and a column cross', () => {
    let f = applyColor(undefined, targetFor([0, 1, 0, 1], 'cols'), 'bg', BLUE)!; // column B
    f = applyColor(f, targetFor([2, 0, 2, 0], 'rows'), 'bg', RED)!; // then row 3
    expect(resolveStyle(f, 2, 1)).toEqual({ bg: RED });

    let g = applyColor(undefined, targetFor([2, 0, 2, 0], 'rows'), 'bg', RED)!; // row 3
    g = applyColor(g, targetFor([0, 1, 0, 1], 'cols'), 'bg', BLUE)!; // then column B
    expect(resolveStyle(g, 2, 1)).toEqual({ bg: BLUE });
    expect(resolveStyle(g, 2, 0)).toEqual({ bg: RED });
    expect(resolveStyle(g, 5, 1)).toEqual({ bg: BLUE });
  });

  it('painting a row replaces the colors of its cells; clearing it clears a painted column too', () => {
    let f = applyColor(undefined, cells(2, 1), 'bg', BLUE);
    f = applyColor(f, targetFor([2, 0, 2, 0], 'rows'), 'bg', RED);
    expect(resolveStyle(f, 2, 1)).toEqual({ bg: RED });

    f = applyColor(undefined, targetFor([0, 1, 0, 1], 'cols'), 'bg', BLUE);
    f = applyColor(f, targetFor([2, 0, 2, 0], 'rows'), 'bg', null);
    expect(resolveStyle(f, 2, 1)).toEqual({});
    expect(resolveStyle(f, 3, 1)).toEqual({ bg: BLUE });
  });

  it('refuses a paint that would store too many cells', () => {
    expect(() => applyColor(undefined, cells(0, 0, 100_000, 5), 'bg', RED)).toThrow(RangeError);
  });
});

describe('structural edits', () => {
  const base = (): SheetFormat =>
    applyColor(
      applyColor(undefined, cells(1, 1), 'bg', RED),
      targetFor([3, 0, 3, 0], 'rows'),
      'bg',
      BLUE,
    )!;

  it('colors move with their rows when rows are inserted', () => {
    const f = insertRowsFormat(base(), 1, 2);
    expect(resolveStyle(f, 3, 1)).toEqual({ bg: RED });
    expect(resolveStyle(f, 5, 9)).toEqual({ bg: BLUE });
    expect(resolveStyle(f, 1, 1)).toEqual({});
  });

  it('colors of deleted rows and columns are gone, the rest shifts up', () => {
    const f = deleteRowsFormat(base(), 1, 1);
    expect(resolveStyle(f, 1, 1)).toEqual({});
    expect(resolveStyle(f, 2, 0)).toEqual({ bg: BLUE });
    const g = deleteColsFormat(applyColor(undefined, cells(0, 2), 'bg', RED), 0, 1);
    expect(resolveStyle(g, 0, 1)).toEqual({ bg: RED });
    expect(deleteColsFormat(applyColor(undefined, cells(0, 2), 'bg', RED), 2, 1)).toBeUndefined();
  });

  it('sorting carries colors with their rows', () => {
    const f = applyColor(undefined, cells(1, 0), 'bg', RED);
    // old rows 0,1,2 now read 0,2,1: the row that was 1 is now 2
    const g = permuteRowsFormat(f, [0, 2, 1]);
    expect(resolveStyle(g, 2, 0)).toEqual({ bg: RED });
    expect(resolveStyle(g, 1, 0)).toEqual({});
  });
});

describe('sanitizeFormat', () => {
  it('keeps good colors and drops bad ones', () => {
    const f = sanitizeFormat({
      cells: { '0,0': { bg: '#FF0000', fg: 'javascript:alert(1)' }, nope: { bg: RED } },
      rows: { '2': { fg: BLUE } },
      cols: { x: { bg: RED } },
    });
    expect(f).toEqual({ cells: { '0,0': { bg: RED } }, rows: { '2': { fg: BLUE } } });
    expect(sanitizeFormat('x')).toBeUndefined();
  });
});
