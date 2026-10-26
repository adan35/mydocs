// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  applyEntry,
  emptyState,
  mergeOps,
  replay,
  summarize,
  type Entry,
  type Op,
} from './history';

const ann = { email: 'ann@x.com', name: 'Ann' };
const bob = { email: 'bob@x.com', name: 'Bob' };
const MIN = 60_000;
const e = (who: typeof ann, at: number, ...delta: Op[]): Entry => ({ ...who, at, delta });

describe('shared document history', () => {
  const log = [
    e(ann, 0, { insert: 'Agenda\nLaunch\n' }),
    e(bob, 10 * MIN, { retain: 14 }, { insert: 'Budget\n' }),
    e(bob, 10 * MIN + 1000, { retain: 7 }, { delete: 6 }, { insert: 'Rollout' }),
    e(ann, 30 * MIN, { retain: 7 }, { insert: '- ' }),
  ];

  it('tracks the text and who wrote each character', () => {
    const st = replay(emptyState(), log);
    expect(st.text).toBe('Agenda\n- Rollout\nBudget\n');
    expect(st.authors.map((a) => a.name)).toEqual(['Ann', 'Bob']);
    expect(st.runs.reduce((n, r) => n + r.n, 0)).toBe(st.text.length);
  });

  it('says who last wrote each line, and when', () => {
    const { blame, authors } = summarize(emptyState(), log, true);
    const who = (i: number) => `${authors[blame[i]!.a]!.name}@${blame[i]!.t / MIN}`;
    expect(blame.map((b) => b.text)).toEqual(['Agenda', '- Rollout', 'Budget', '']);
    expect([who(0), who(1), who(2)]).toEqual(['Ann@0', 'Ann@30', 'Bob@10']);
  });

  it('does not give a line to the person who pressed Enter after it', () => {
    const lines = [
      e(ann, 0, { insert: 'first' }),
      e(bob, 10 * MIN, { retain: 5 }, { insert: '\nsecond' }),
    ];
    const { blame, authors } = summarize(emptyState(), lines, true);
    expect(blame.map((b) => `${b.text}:${authors[b.a]!.name}`)).toEqual([
      'first:Ann',
      'second:Bob',
    ]);
  });

  it('lists changes per person, with the lines they added and removed', () => {
    const { sessions, authors } = summarize(emptyState(), log, true);
    expect(sessions.map((s) => authors[s.a]!.name)).toEqual(['Ann', 'Bob', 'Ann']);
    const bobs = sessions[1]!;
    expect(bobs.edits).toBe(2);
    expect(bobs.lines).toEqual([
      { type: 'del', text: 'Launch' },
      { type: 'add', text: 'Rollout' },
      { type: 'add', text: 'Budget' },
    ]);
  });

  it('keeps email addresses for the owner only', () => {
    expect(summarize(emptyState(), log, true).authors[1]).toEqual({
      name: 'Bob',
      email: 'bob@x.com',
    });
    expect(summarize(emptyState(), log, false).authors[1]).toEqual({ name: 'Bob' });
  });

  it('folding old edits into a snapshot changes nothing about authorship', () => {
    const folded = replay(emptyState(), log.slice(0, 2));
    const a = summarize(emptyState(), log, true);
    const b = summarize(folded, log.slice(2), true);
    expect(b.blame).toEqual(a.blame);
    expect(b.authors).toEqual(a.authors);
  });

  it('joins continued typing and backspacing into one entry', () => {
    expect(mergeOps([{ retain: 5 }, { insert: 'ab' }], [{ retain: 7 }, { insert: 'c' }])).toEqual([
      { retain: 5 },
      { insert: 'abc' },
    ]);
    expect(mergeOps([{ insert: 'abc' }], [{ retain: 2 }, { delete: 1 }])).toEqual([
      { insert: 'ab' },
    ]);
    expect(mergeOps([{ insert: 'a' }], [{ delete: 0 }])).toBeNull();
    // Typing somewhere else, or deleting older text, is a separate entry.
    expect(
      mergeOps([{ retain: 5 }, { insert: 'ab' }], [{ retain: 2 }, { insert: 'c' }]),
    ).toBeNull();
    expect(mergeOps([{ retain: 5 }, { insert: 'ab' }], [{ retain: 3 }, { delete: 3 }])).toBeNull();
  });

  it('applies a merged entry the same as the separate ones', () => {
    const separate = replay(emptyState(), [
      e(ann, 0, { insert: 'ab' }),
      e(ann, 5, { retain: 2 }, { insert: 'c' }),
    ]);
    const merged = applyEntry(
      emptyState(),
      e(ann, 5, ...(mergeOps([{ insert: 'ab' }], [{ retain: 2 }, { insert: 'c' }]) as Op[])),
    );
    expect(merged.text).toBe(separate.text);
    expect(merged.runs).toEqual(separate.runs);
  });
});
