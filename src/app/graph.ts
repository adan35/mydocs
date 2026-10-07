import type { EntryId } from '@/domain/types';
import type { Tree } from '@/domain/tree';
import { baseName, isMarkdownName } from '@/domain/names';
import type { KnowledgeIndex } from './knowledge';

export interface GraphOptions {
  /** Only documents inside this folder. */
  folderId?: EntryId | null;
  /** Only documents with this tag (or a nested tag below it). */
  tag?: string;
  /** Local graph: this document and its neighbours up to `depth` links away. */
  focusId?: EntryId;
  depth?: number;
  /** Include documents with no links. */
  orphans?: boolean;
}

export interface GraphData {
  ids: EntryId[];
  labels: string[];
  degree: number[];
  edges: [number, number][];
}

/** Builds the link graph between Markdown documents from the knowledge index. */
export function buildGraph(tree: Tree, knowledge: KnowledgeIndex, opts: GraphOptions): GraphData {
  const docs = tree.liveFiles().filter((e) => isMarkdownName(e.name));
  const adjacency = new Map<EntryId, Set<EntryId>>();
  const link = (a: EntryId, b: EntryId) => {
    if (a === b) return;
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };
  const live = new Set(docs.map((d) => d.id));
  for (const d of docs) {
    for (const o of knowledge.outgoing(tree, d.id)) {
      if (o.link.kind !== 'image' && o.targetId && live.has(o.targetId)) link(d.id, o.targetId);
    }
  }

  let keep = new Set(docs.map((d) => d.id));
  if (opts.folderId) keep = new Set([...keep].filter((id) => tree.isWithin(id, opts.folderId!)));
  if (opts.tag) {
    const tag = opts.tag;
    keep = new Set(
      [...keep].filter((id) =>
        knowledge.tagsOf(id).some((t) => t === tag || t.startsWith(`${tag}/`)),
      ),
    );
  }
  if (opts.focusId && live.has(opts.focusId)) {
    const depth = opts.depth ?? 1;
    const near = new Set([opts.focusId]);
    let frontier = [opts.focusId];
    for (let i = 0; i < depth; i++) {
      const next: EntryId[] = [];
      for (const id of frontier)
        for (const n of adjacency.get(id) ?? [])
          if (!near.has(n)) {
            near.add(n);
            next.push(n);
          }
      frontier = next;
    }
    keep = new Set([...keep].filter((id) => near.has(id)));
    keep.add(opts.focusId);
  }
  if (!opts.orphans) {
    keep = new Set(
      [...keep].filter(
        (id) => id === opts.focusId || [...(adjacency.get(id) ?? [])].some((n) => keep.has(n)),
      ),
    );
  }

  const ids = [...keep];
  const index = new Map(ids.map((id, i) => [id, i]));
  const edges: [number, number][] = [];
  const degree = ids.map(() => 0);
  for (const [i, id] of ids.entries()) {
    for (const n of adjacency.get(id) ?? []) {
      const j = index.get(n);
      if (j !== undefined && j > i) {
        edges.push([i, j]);
        degree[i]!++;
        degree[j]!++;
      }
    }
  }
  return { ids, labels: ids.map((id) => baseName(tree.get(id)!.name)), degree, edges };
}
