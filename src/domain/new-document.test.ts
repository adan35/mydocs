import { describe, expect, it } from 'vitest';
import { NEW_FILE_BODIES, NEW_KINDS, isNewKindId, lastNewKind } from './new-document';

describe('new document kinds', () => {
  it('has unique ids and leads with Markdown', () => {
    const ids = NEW_KINDS.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('md');
  });

  it('falls back to Markdown for a missing or unknown remembered choice', () => {
    expect(lastNewKind(undefined)).toBe('md');
    expect(lastNewKind('docx')).toBe('md');
    expect(lastNewKind('csv')).toBe('csv');
    expect(isNewKindId('xlsx')).toBe(true);
  });

  it('builds file bodies for the text kinds', () => {
    expect(NEW_FILE_BODIES.txt()).toBe('');
    expect(NEW_FILE_BODIES.csv().split('\n')[0]).toBe('Column A,Column B,Column C');
    expect(NEW_FILE_BODIES.html('A<b>&')).toContain('<title>Ab</title>');
  });
});
