import { describe, expect, it } from 'vitest';
import { findFirstMatch, markdownToPlainText, SearchIndex } from './search';
import { Tree } from '@/domain/tree';
import type { Entry } from '@/domain/types';

describe('search snippets', () => {
  it('strip Markdown syntax but keep the words', () => {
    const plain = markdownToPlainText(
      [
        '---',
        'tags: [exam]',
        '---',
        '# Heading **bold**',
        '> quote with [a link](./a.md), [[Note#Part|an alias]] and ![a picture](x.png)',
        '- [ ] task _em_ snake_case *star* `code`',
        '| a | b |',
        '| --- | --- |',
        '```js',
        'const RATE_LIMIT = 1;',
        '```',
      ].join('\n'),
    );
    expect(plain.split('\n')).toEqual([
      'Heading bold',
      'quote with a link, an alias and a picture',
      'task em snake_case star code',
      'a · b',
      'const RATE_LIMIT = 1;',
    ]);
  });

  it('find the first match, preferring the longest term, ignoring case', () => {
    expect(findFirstMatch('Alpha BETAMAX beta', ['beta', 'betamax'])).toEqual({
      from: 6,
      to: 13,
    });
    expect(findFirstMatch('nothing here', ['zebra'])).toBeNull();
  });
});

describe('search operators', () => {
  const now = Date.now();
  const mk = (
    id: string,
    name: string,
    parentId: string | null,
    kind: 'file' | 'folder' = 'file',
    age = 0,
  ): Entry => ({
    id,
    kind,
    parentId,
    name,
    createdAt: now - age,
    updatedAt: now - age,
    size: 0,
  });
  const entries = [
    mk('f1', 'Projects', null, 'folder'),
    mk('a', 'Product Requirements.md', 'f1'),
    mk('b', 'Auth design.md', 'f1', 'file', 40 * 86_400_000),
    mk('c', 'Ideas.md', null),
  ];
  const tree = new Tree(entries);
  const index = new SearchIndex();
  index.upsert(
    'a',
    'Product Requirements.md',
    'Projects/Product Requirements.md',
    'Login uses a token refresh flow. Draft.',
    ['spec'],
  );
  index.upsert(
    'b',
    'Auth design.md',
    'Projects/Auth design.md',
    'We refresh the token on expiry.',
    ['spec', 'security/auth'],
  );
  index.upsert('c', 'Ideas.md', 'Ideas.md', 'Token ideas and refresh thoughts.', ['idea']);
  const ids = (q: string) =>
    index
      .search(q, tree)
      .map((h) => h.id)
      .sort();

  it('finds documents by name fragments', () => {
    expect(ids('prod req')).toEqual(['a']);
  });

  it('filters by tag (including nested tags), folder, phrase, exclusion and date', () => {
    expect(ids('token tag:spec')).toEqual(['a', 'b']);
    expect(ids('tag:security')).toEqual(['b']);
    expect(ids('token folder:projects')).toEqual(['a', 'b']);
    expect(ids('"token refresh"')).toEqual(['a']);
    expect(ids('token -draft')).toEqual(['b', 'c']);
    expect(ids('token modified:month')).toEqual(['a', 'c']);
    expect(ids('type:md tag:idea')).toEqual(['c']);
  });
});
