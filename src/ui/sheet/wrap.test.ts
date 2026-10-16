import { describe, expect, it } from 'vitest';
import { wrappedLines } from './SheetGrid';

// Every character 10px wide, so a 100px cell holds 10 characters per line.
const mono = (t: string) => t.length * 10;

describe('wrappedLines', () => {
  it('counts one line for short text and for each hard line break', () => {
    expect(wrappedLines('short', 100, mono)).toBe(1);
    expect(wrappedLines('a\nb\nc', 100, mono)).toBe(3);
  });
  it('wraps at spaces like the browser, not mid-word', () => {
    // "aaaa bbbb" fits (9), then "cccccc" goes to the next line.
    expect(wrappedLines('aaaa bbbb cccccc', 100, mono)).toBe(2);
    expect(wrappedLines('aaaaaa bbbbbb cccccc', 100, mono)).toBe(3);
  });
  it('breaks a word wider than the cell across lines', () => {
    expect(wrappedLines('x'.repeat(25), 100, mono)).toBe(3);
    expect(wrappedLines('ab ' + 'x'.repeat(25), 100, mono)).toBe(4);
  });
});
