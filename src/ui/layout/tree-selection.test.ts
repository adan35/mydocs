import { describe, expect, it } from 'vitest';
import { rangeBetween, topLevel } from './tree-selection';

describe('tree selection', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];

  it('selects a range in either direction, inclusive', () => {
    expect(rangeBetween(order, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(rangeBetween(order, 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(rangeBetween(order, 'c', 'c')).toEqual(['c']);
  });

  it('falls back to the clicked row when the anchor is no longer visible', () => {
    expect(rangeBetween(order, 'gone', 'c')).toEqual(['c']);
  });

  it('keeps only top-level items of the selection', () => {
    const parent: Record<string, string> = { f1: 'f', f2: 'f1' };
    const within = (id: string, anc: string): boolean =>
      id === anc || (parent[id] !== undefined && within(parent[id]!, anc));
    expect(topLevel(['f', 'f1', 'f2', 'x'], within)).toEqual(['f', 'x']);
  });
});
