import { describe, expect, it } from 'vitest';
import { findMentions, linkFirstMention } from './mentions';

describe('unlinked mentions', () => {
  const text = [
    '---',
    'title: Roadmap notes',
    '---',
    'The roadmap is in `roadmap.md` and [the Roadmap](./Roadmap.md) or [[Roadmap]].',
    'See https://x.com/roadmap too. Roadmaps are plural; roadmap again.',
    '```',
    'roadmap in code',
    '```',
  ].join('\n');

  it('finds whole-word prose mentions only', () => {
    const hits = findMentions(text, 'Roadmap').map((h) => text.slice(h.from, h.to));
    expect(hits).toEqual(['roadmap', 'roadmap']);
  });

  it('links the first mention, keeping its wording', () => {
    const out = linkFirstMention(text, 'Roadmap')!;
    expect(out).toContain('The [[Roadmap|roadmap]] is in');
    expect(linkFirstMention('nothing here', 'Roadmap')).toBeNull();
    expect(findMentions('a ab', 'ab')).toEqual([]);
  });
});
