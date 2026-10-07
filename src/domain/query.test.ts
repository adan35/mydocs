import { describe, expect, it } from 'vitest';
import { inRange, parseDateRange, parseQuery } from './query';

const NOW = new Date(2026, 9, 5, 15, 30).getTime();
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

describe('search queries', () => {
  it('splits free text from operators', () => {
    const q = parseQuery(
      'auth tag:backend #Security folder:"Team notes/Projects" type:md "token refresh" -draft',
      NOW,
    );
    expect(q.text).toBe('auth');
    expect(q.tags).toEqual(['backend', 'security']);
    expect(q.folders).toEqual(['team notes/projects']);
    expect(q.types).toEqual(['markdown']);
    expect(q.phrases).toEqual(['token refresh']);
    expect(q.exclude).toEqual(['draft']);
    expect(q.hasOperators).toBe(true);
  });

  it('leaves unknown operators and plain text alone', () => {
    const q = parseQuery('http://example.com note:thing type:banana', NOW);
    expect(q.text).toBe('http://example.com note:thing type:banana');
    expect(q.hasOperators).toBe(false);
  });

  it('understands relative and absolute dates', () => {
    expect(parseDateRange('today', NOW)).toEqual({ from: day(2026, 10, 5) });
    expect(parseDateRange('7d', NOW)).toEqual({ from: day(2026, 9, 29) });
    const sept = parseDateRange('2026-09', NOW)!;
    expect(inRange(day(2026, 9, 30), sept)).toBe(true);
    expect(inRange(day(2026, 10, 1), sept)).toBe(false);
    expect(parseDateRange('>2026-10-01', NOW)).toEqual({ from: day(2026, 10, 2) });
    expect(parseDateRange('<2026', NOW)).toEqual({ to: day(2026, 1, 1) - 1 });
    expect(parseDateRange('soon', NOW)).toBeNull();
    const q = parseQuery('modified:week created:2026', NOW);
    expect(q.modified).toEqual({ from: day(2026, 9, 29) });
    expect(q.created?.from).toBe(day(2026, 1, 1));
  });
});
