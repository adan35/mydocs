import MiniSearch, { type SearchResult as MiniResult } from 'minisearch';
import type { EntryId } from '@/domain/types';
import type { Tree } from '@/domain/tree';
import { fileTypeOf, type FileType } from '@/domain/names';
import { inRange, parseQuery } from '@/domain/query';

/** Content beyond this many characters isn't indexed (the file still opens fine). */
const MAX_INDEXED_CHARS = 1_000_000;

interface IndexedDoc {
  id: EntryId;
  name: string;
  path: string;
  content: string;
  tags: string;
}

/** Plain-text versions of Markdown content for snippets, built on first use. */
const plainCache = new WeakMap<IndexedDoc, string>();

export interface SearchFilters {
  types?: FileType[];
  folderId?: EntryId | null;
  tag?: string;
  /** Only documents modified at or after this time (epoch ms). */
  modifiedAfter?: number;
}

export interface SearchHit {
  id: EntryId;
  score: number;
  /** Which fields matched: used to label results. */
  fields: string[];
  terms: string[];
  snippet?: Snippet;
}

export interface Snippet {
  text: string;
  /** [start, end) ranges within `text` to highlight. */
  highlights: [number, number][];
}

/**
 * Full-text search over names, paths, tags and content. Pluggable by design: a
 * semantic ranker can be added later behind the same `search()` signature.
 */
export class SearchIndex {
  private mini = this.createMini();
  private docs = new Map<EntryId, IndexedDoc>();

  private createMini() {
    return new MiniSearch<IndexedDoc>({
      fields: ['name', 'path', 'tags', 'content'],
      storeFields: [],
      searchOptions: {
        boost: { name: 4, tags: 3, path: 1.5, content: 1 },
        prefix: true,
        fuzzy: (term) => (term.length > 3 ? 0.2 : false),
        combineWith: 'AND',
      },
      tokenize: (text) => text.split(/[\s\-_./\\,;:!?'"()[\]{}<>|`*#=+~^@$%&]+/u).filter(Boolean),
      processTerm: (term) => term.toLocaleLowerCase(),
    });
  }

  clear() {
    this.mini = this.createMini();
    this.docs.clear();
  }

  get size() {
    return this.docs.size;
  }

  upsert(id: EntryId, name: string, path: string, content: string, tags: string[]) {
    const doc: IndexedDoc = {
      id,
      name,
      path,
      content: content.length > MAX_INDEXED_CHARS ? content.slice(0, MAX_INDEXED_CHARS) : content,
      tags: tags.join(' '),
    };
    if (this.docs.has(id)) this.mini.discard(id);
    this.docs.set(id, doc);
    this.mini.add(doc);
  }

  remove(id: EntryId) {
    if (!this.docs.has(id)) return;
    this.mini.discard(id);
    this.docs.delete(id);
  }

  /** Bulk-add in chunks so big workspaces don't block the main thread. */
  async addAll(items: IndexedDoc[]): Promise<void> {
    for (const d of items) {
      if (this.docs.has(d.id)) this.mini.discard(d.id);
      this.docs.set(d.id, d);
    }
    await this.mini.addAllAsync(items, { chunkSize: 200 });
  }

  /**
   * Ranked full-text search. The query may use operators (see `parseQuery`):
   * `tag:`, `folder:`, `type:`, `created:`, `modified:`, `"exact phrase"`, `-exclude`.
   */
  search(query: string, tree: Tree, filters: SearchFilters = {}, limit = 50): SearchHit[] {
    const q = parseQuery(query.trim());
    const text = [q.text, ...q.phrases].join(' ').trim();
    if (!text && !q.hasOperators) return [];
    let results: Pick<MiniResult, 'id' | 'score' | 'terms' | 'match'>[];
    if (text) {
      results = this.mini.search(text);
      if (!results.length && !q.phrases.length) {
        results = this.mini.search(text, { combineWith: 'OR' });
      }
    } else {
      // Operators only (e.g. "tag:idea modified:week"): newest first.
      results = [...this.docs.keys()]
        .map((id) => ({ id, score: tree.get(id)?.updatedAt ?? 0, terms: [], match: {} }))
        .sort((a, b) => b.score - a.score);
    }
    const types = [...(filters.types ?? []), ...q.types];
    const tags = [...(filters.tag ? [filters.tag] : []), ...q.tags];
    const phrases = q.phrases.map((p) => p.toLocaleLowerCase());
    const hits: SearchHit[] = [];
    for (const r of results) {
      const id = r.id as EntryId;
      const entry = tree.get(id);
      if (!entry || tree.isTrashed(id)) continue;
      if (types.length && !types.includes(fileTypeOf(entry.name))) continue;
      if (filters.folderId && !tree.isWithin(id, filters.folderId)) continue;
      if (!inRange(entry.createdAt, q.created) || !inRange(entry.updatedAt, q.modified)) continue;
      if (filters.modifiedAfter && entry.updatedAt < filters.modifiedAfter) continue;
      const doc = this.docs.get(id);
      if (!doc) continue;
      if (q.folders.length) {
        const dir = `/${tree.dirOf(id).toLocaleLowerCase()}/`;
        if (!q.folders.every((f) => dir.includes(`/${f}`))) continue;
      }
      if (tags.length) {
        const docTags = doc.tags ? doc.tags.split(' ') : [];
        const has = (t: string) => docTags.some((d) => d === t || d.startsWith(`${t}/`));
        if (!tags.every(has)) continue;
      }
      if (phrases.length || q.exclude.length) {
        const hay = `${doc.name}\n${doc.content}`.toLocaleLowerCase();
        if (!phrases.every((p) => hay.includes(p))) continue;
        if (q.exclude.some((x) => hay.includes(x))) continue;
      }
      const fields = [...new Set(Object.values(r.match).flat())];
      const terms = [...new Set([...q.phrases, ...r.terms])];
      hits.push({
        id,
        score: r.score,
        fields,
        terms,
        snippet: fields.includes('content') ? snippetFor(doc, terms) : undefined,
      });
      if (hits.length >= limit) break;
    }
    return hits;
  }

  /** Searches only names/paths: used by quick open. */
  suggestNames(query: string): EntryId[] {
    return this.mini
      .search(query, { fields: ['name', 'path'], prefix: true, fuzzy: 0.2, combineWith: 'AND' })
      .map((r) => r.id as EntryId);
  }
}

function snippetFor(doc: IndexedDoc, terms: string[]): Snippet | undefined {
  if (!/\.(md|markdown|mdx)$/i.test(doc.name)) return makeSnippet(doc.content, terms);
  let plain = plainCache.get(doc);
  if (plain === undefined) {
    plain = markdownToPlainText(doc.content);
    plainCache.set(doc, plain);
  }
  return makeSnippet(plain, terms) ?? makeSnippet(doc.content, terms);
}

/** Drops Markdown syntax (front matter, markers, link targets, HTML) so snippets read as prose. */
export function markdownToPlainText(src: string): string {
  const out: string[] = [];
  let lines = src.split(/\r?\n/);
  if (lines[0]?.trim() === '---') {
    const close = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l));
    if (close > 0) lines = lines.slice(close + 1);
  }
  for (const raw of lines) {
    let line = raw;
    if (/^\s*(```|~~~)/.test(line)) continue;
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) continue;
    if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)) continue;
    line = line
      .replace(/^\s*(>\s?)+/, '')
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '')
      .replace(
        /!?\[\[([^\]|#\n]+)(#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g,
        (_m, t: string, _f, a?: string) => (a || t).trim(),
      )
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[\^[^\]]+\]/g, '')
      .replace(/<[^>\n]+>/g, ' ')
      .replace(/\*\*|__|~~|`+|\$\$?/g, '')
      .replace(/(^|[^\w*])[*_](?=\S)/g, '$1')
      .replace(/(\S)[*_](?=[^\w*]|$)/g, '$1')
      .replace(/\s*\|\s*/g, ' · ')
      .replace(/^ · | · $/g, '');
    out.push(line);
  }
  return out.join('\n');
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Builds a short excerpt around the first match with highlight ranges. */
export function makeSnippet(content: string, terms: string[], radius = 70): Snippet | undefined {
  if (!terms.length) return undefined;
  const re = new RegExp(
    terms
      .map(escapeRe)
      .sort((a, b) => b.length - a.length)
      .join('|'),
    'giu',
  );
  const first = re.exec(content);
  if (!first) return undefined;
  let start = Math.max(0, first.index - radius);
  let end = Math.min(content.length, first.index + first[0].length + radius * 2);
  // Snap to word boundaries.
  if (start > 0) start = content.indexOf(' ', start) + 1 || start;
  if (end < content.length)
    end = content.lastIndexOf(' ', end) > first.index ? content.lastIndexOf(' ', end) : end;
  const raw = content.slice(start, end);
  // Collapse whitespace while tracking offsets.
  let text = '';
  const map: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    const space = /\s/.test(ch);
    if (space && prevSpace) continue;
    map[i] = text.length;
    text += space ? ' ' : ch;
    prevSpace = space;
  }
  const highlights: [number, number][] = [];
  re.lastIndex = 0;
  for (const m of raw.matchAll(re)) {
    const s = map[m.index!];
    const e = map[m.index! + m[0].length - 1];
    if (s !== undefined && e !== undefined) highlights.push([s, e + 1]);
  }
  return {
    text: `${start > 0 ? '…' : ''}${text}${end < content.length ? '…' : ''}`,
    highlights: start > 0 ? highlights.map(([a, b]) => [a + 1, b + 1]) : highlights,
  };
}

/** The first case-insensitive occurrence of any of the terms (longest first), for jumping to a hit. */
export function findFirstMatch(text: string, terms: string[]): { from: number; to: number } | null {
  const words = terms.filter(Boolean);
  if (!words.length) return null;
  const re = new RegExp(
    words
      .sort((a, b) => b.length - a.length)
      .map(escapeRe)
      .join('|'),
    'iu',
  );
  const m = re.exec(text);
  return m ? { from: m.index, to: m.index + m[0].length } : null;
}
