import type { EntryId } from '@/domain/types';
import type { Tree } from '@/domain/tree';
import { extractLinks, type RawLink } from '@/domain/links';
import { extractTags } from '@/domain/tags';
import { baseName, isMarkdownName } from '@/domain/names';
import { findMentions } from '@/domain/mentions';
import { resolvePath } from '@/domain/paths';
import { resolveWikiLink } from './workspace';

interface DocFacts {
  links: RawLink[];
  tags: string[];
}

/**
 * Derived knowledge: tags and links parsed from Markdown. Nothing here is stored;
 * the documents themselves are the source of truth, so exports lose nothing.
 */
export class KnowledgeIndex {
  private facts = new Map<EntryId, DocFacts>();

  update(id: EntryId, name: string, text: string) {
    if (!isMarkdownName(name)) {
      this.facts.delete(id);
      return;
    }
    this.facts.set(id, { links: extractLinks(text), tags: extractTags(text) });
  }

  remove(id: EntryId) {
    this.facts.delete(id);
  }

  tagsOf(id: EntryId): string[] {
    return this.facts.get(id)?.tags ?? [];
  }

  /** All tags with counts, over live documents only. */
  allTags(tree: Tree): { tag: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const [id, f] of this.facts) {
      if (tree.isTrashed(id)) continue;
      for (const t of f.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => a.tag.localeCompare(b.tag));
  }

  docsWithTag(tree: Tree, tag: string): EntryId[] {
    const out: EntryId[] = [];
    for (const [id, f] of this.facts) if (!tree.isTrashed(id) && f.tags.includes(tag)) out.push(id);
    return out;
  }

  /** Resolves a link written in document `fromId` to an entry id. */
  resolve(
    tree: Tree,
    fromId: EntryId,
    link: Pick<RawLink, 'kind' | 'target'>,
  ): EntryId | undefined {
    if (link.kind === 'wiki') return resolveWikiLink(tree, link.target)?.id;
    const path = resolvePath(tree.dirOf(fromId), link.target);
    if (path === null) return undefined;
    const hit = tree.findByPath(path);
    if (hit) return hit.id;
    // Allow extension-less links: [x](./notes/today) → today.md
    return tree.findByPath(`${path}.md`)?.id;
  }

  outgoing(tree: Tree, id: EntryId): { link: RawLink; targetId?: EntryId }[] {
    return (this.facts.get(id)?.links ?? []).map((link) => ({
      link,
      targetId: this.resolve(tree, id, link),
    }));
  }

  /** Documents linking to `id`. */
  backlinks(tree: Tree, id: EntryId): EntryId[] {
    const out: EntryId[] = [];
    for (const [from, f] of this.facts) {
      if (from === id || tree.isTrashed(from)) continue;
      if (f.links.some((l) => l.kind !== 'image' && this.resolve(tree, from, l) === id))
        out.push(from);
    }
    return out;
  }

  /**
   * Documents that mention `id`'s name in plain text without linking to it.
   * Scans text only on demand (when the panel is open), capped for big workspaces.
   */
  unlinkedMentions(
    tree: Tree,
    id: EntryId,
    texts: ReadonlyMap<EntryId, string>,
    limit = 30,
  ): { id: EntryId; count: number }[] {
    const target = tree.get(id);
    if (!target) return [];
    const name = baseName(target.name);
    if (name.length < 3) return [];
    const linked = new Set(this.backlinks(tree, id));
    const needle = name.toLocaleLowerCase();
    const out: { id: EntryId; count: number }[] = [];
    for (const from of this.facts.keys()) {
      if (from === id || linked.has(from) || tree.isTrashed(from)) continue;
      const text = texts.get(from);
      // Cheap pre-check before the precise scan.
      if (!text || !text.toLocaleLowerCase().includes(needle)) continue;
      const count = findMentions(text, name).length;
      if (count) out.push({ id: from, count });
      if (out.length >= limit) break;
    }
    return out.sort((a, b) => b.count - a.count);
  }

  /**
   * Related documents, ranked by direct links, shared tags, shared link targets
   * and sharing a folder. Quiet suggestions, never stored.
   */
  related(tree: Tree, id: EntryId, limit = 6): EntryId[] {
    const mine = this.facts.get(id);
    if (!mine) return [];
    const myTags = new Set(mine.tags);
    const myTargets = new Set(
      this.outgoing(tree, id)
        .map((o) => o.targetId)
        .filter((t): t is EntryId => !!t),
    );
    const linkedFrom = new Set(this.backlinks(tree, id));
    const folder = tree.get(id)?.parentId ?? null;
    const scores: { id: EntryId; score: number }[] = [];
    for (const [other, f] of this.facts) {
      if (other === id || tree.isTrashed(other)) continue;
      let score = 0;
      if (myTargets.has(other)) score += 3;
      if (linkedFrom.has(other)) score += 3;
      for (const t of f.tags) if (myTags.has(t)) score += 2;
      if (score === 0 && !f.links.length) continue;
      for (const l of f.links) {
        const target = l.kind === 'image' ? undefined : this.resolve(tree, other, l);
        if (target && target !== id && myTargets.has(target)) score += 1;
      }
      if (score > 0 && tree.get(other)?.parentId === folder) score += 1;
      if (score > 0) scores.push({ id: other, score });
    }
    return scores
      .sort(
        (a, b) =>
          b.score - a.score || (tree.get(b.id)?.updatedAt ?? 0) - (tree.get(a.id)?.updatedAt ?? 0),
      )
      .slice(0, limit)
      .map((s) => s.id);
  }

  /** Links that point at nothing (useful for "broken link" hints). */
  brokenLinks(tree: Tree, id: EntryId): RawLink[] {
    return this.outgoing(tree, id)
      .filter((o) => !o.targetId)
      .map((o) => o.link);
  }
}
