import type { EntryId } from '@/domain/types';
import type { Tree } from '@/domain/tree';
import { baseName, isMarkdownName } from '@/domain/names';
import { findMentions } from '@/domain/mentions';
import { formatOf } from '@/lib/convert/capabilities';
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
  /** Only these document types (all when empty). Missing documents stay with their links. */
  types?: readonly DocType[];
  /** Add a node for each link target that doesn't exist yet. */
  unresolved?: boolean;
  /**
   * Add dashed edges where one document names another in plain text without linking.
   * Needs the document texts; skipped above `SUGGEST_LIMIT` documents.
   */
  suggested?: ReadonlyMap<EntryId, string>;
}

/** Above this many documents, suggested links aren't computed (it's a text scan per pair). */
export const SUGGEST_LIMIT = 400;

export type NodeKind = 'doc' | 'ghost';

/** The document types the graph shows. Images and other files aren't documents here. */
export type DocType = 'markdown' | 'word' | 'sheet' | 'pdf' | 'web' | 'text';

export const DOC_TYPES: { id: DocType; label: string }[] = [
  { id: 'markdown', label: 'Markdown' },
  { id: 'word', label: 'Word' },
  { id: 'sheet', label: 'Spreadsheets' },
  { id: 'pdf', label: 'PDF' },
  { id: 'web', label: 'HTML' },
  { id: 'text', label: 'Plain text' },
];

export function docTypeOf(name: string): DocType | null {
  switch (formatOf(name)?.id) {
    case 'md':
      return 'markdown';
    case 'docx':
      return 'word';
    case 'xlsx':
    case 'csv':
    case 'tsv':
    case 'unl':
      return 'sheet';
    case 'pdf':
      return 'pdf';
    case 'html':
      return 'web';
    case 'txt':
      return 'text';
    default:
      return null;
  }
}

export interface GraphData {
  /** Entry ids for documents; `ghost:<name>` for link targets that don't exist. */
  ids: string[];
  kinds: NodeKind[];
  /** Document type; null for missing documents. */
  types: (DocType | null)[];
  labels: string[];
  /** Folder path for documents, or the written target for ghosts. */
  details: string[];
  degree: number[];
  /** Real links (either direction), each pair once. */
  edges: [number, number][];
  /** Plain-text mentions that aren't links yet. */
  suggested: [number, number][];
  /** Whether suggestions were skipped because the graph is too big. */
  suggestSkipped: boolean;
  /** For each missing target: the first document linking to it and the link as written. */
  ghosts: ReadonlyMap<string, GhostSource>;
}

export interface GhostSource {
  from: EntryId;
  kind: 'wiki' | 'markdown';
  target: string;
}

/** Markdown documents go by their title; other files keep their extension (a.pdf vs a.docx). */
const nodeName = (name: string) => (isMarkdownName(name) ? baseName(name) : name);

export const ghostId = (target: string) => `ghost:${target.trim().toLowerCase()}`;
export const isGhost = (id: string) => id.startsWith('ghost:');

/**
 * Builds the link graph from the knowledge index: links are read from Markdown documents
 * and may point at any document (a Word file, a spreadsheet, a PDF…).
 */
export function buildGraph(tree: Tree, knowledge: KnowledgeIndex, opts: GraphOptions): GraphData {
  const typeOf = new Map<string, DocType>();
  for (const e of tree.liveFiles()) {
    const t = docTypeOf(e.name);
    if (t) typeOf.set(e.id, t);
  }
  const docs = tree.liveFiles().filter((e) => isMarkdownName(e.name));
  const live = new Set<string>(typeOf.keys());
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };
  const ghostLabel = new Map<string, string>();
  const ghosts = new Map<string, GhostSource>();
  for (const d of docs) {
    for (const o of knowledge.outgoing(tree, d.id)) {
      if (o.link.kind === 'image' || o.link.embed) continue;
      if (o.targetId && live.has(o.targetId)) link(d.id, o.targetId);
      else if (!o.targetId && opts.unresolved && !/^[a-z][a-z0-9+.-]*:/i.test(o.link.target)) {
        const label = baseName(o.link.target.split('/').pop() ?? o.link.target);
        if (!label.trim()) continue;
        const id = ghostId(o.link.kind === 'wiki' ? o.link.target : label);
        if (!ghostLabel.has(id)) {
          ghostLabel.set(id, label);
          ghosts.set(id, {
            from: d.id,
            kind: o.link.kind === 'wiki' ? 'wiki' : 'markdown',
            target: o.link.target,
          });
        }
        link(d.id, id);
      }
    }
  }

  let keep = new Set<string>(live);
  if (opts.types?.length) {
    const types = new Set(opts.types);
    keep = new Set([...keep].filter((id) => types.has(typeOf.get(id)!)));
  }
  if (opts.folderId) keep = new Set([...keep].filter((id) => tree.isWithin(id, opts.folderId!)));
  if (opts.tag) {
    const tag = opts.tag;
    keep = new Set(
      [...keep].filter((id) =>
        knowledge.tagsOf(id).some((t) => t === tag || t.startsWith(`${tag}/`)),
      ),
    );
  }
  // Ghosts come with the documents that link to them.
  for (const id of ghostLabel.keys())
    if ([...adjacency.get(id)!].some((n) => keep.has(n))) keep.add(id);

  if (opts.focusId && live.has(opts.focusId)) {
    const depth = opts.depth ?? 1;
    const near = new Set<string>([opts.focusId]);
    let frontier: string[] = [opts.focusId];
    for (let i = 0; i < depth; i++) {
      const next: string[] = [];
      for (const id of frontier)
        for (const n of adjacency.get(id) ?? [])
          if (!near.has(n) && keep.has(n)) {
            near.add(n);
            // A missing document has no links of its own to follow.
            if (!isGhost(n)) next.push(n);
          }
      frontier = next;
    }
    keep = new Set([...keep].filter((id) => near.has(id)));
    keep.add(opts.focusId);
  }

  // Suggested links between the documents still in view.
  const suggestedPairs: [string, string][] = [];
  let suggestSkipped = false;
  if (opts.suggested) {
    const inView = [...keep].filter((id) => typeOf.get(id) === 'markdown');
    if (inView.length > SUGGEST_LIMIT) suggestSkipped = true;
    else {
      const texts = opts.suggested;
      const lower = new Map(inView.map((id) => [id, (texts.get(id) ?? '').toLocaleLowerCase()]));
      const seen = new Set<string>();
      for (const target of inView) {
        const name = baseName(tree.get(target as EntryId)!.name);
        if (name.length < 3) continue;
        const needle = name.toLocaleLowerCase();
        for (const from of inView) {
          if (from === target || adjacency.get(from)?.has(target)) continue;
          const key = from < target ? `${from}|${target}` : `${target}|${from}`;
          if (seen.has(key)) continue;
          if (!lower.get(from)!.includes(needle)) continue;
          if (!findMentions(texts.get(from) ?? '', name).length) continue;
          seen.add(key);
          suggestedPairs.push([from, target]);
        }
      }
    }
  }
  const suggestedNeighbours = new Map<string, number>();
  for (const [a, b] of suggestedPairs) {
    suggestedNeighbours.set(a, (suggestedNeighbours.get(a) ?? 0) + 1);
    suggestedNeighbours.set(b, (suggestedNeighbours.get(b) ?? 0) + 1);
  }

  if (!opts.orphans) {
    keep = new Set(
      [...keep].filter(
        (id) =>
          id === opts.focusId ||
          [...(adjacency.get(id) ?? [])].some((n) => keep.has(n)) ||
          suggestedNeighbours.has(id),
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
  const suggested = suggestedPairs
    .map(([a, b]) => [index.get(a), index.get(b)] as const)
    .filter((p): p is [number, number] => p[0] !== undefined && p[1] !== undefined);

  // Documents that share a name are told apart by their folder.
  const names = new Map<string, number>();
  for (const id of ids)
    if (!isGhost(id)) {
      const k = nodeName(tree.get(id as EntryId)!.name).toLowerCase();
      names.set(k, (names.get(k) ?? 0) + 1);
    }
  const kinds = ids.map((id): NodeKind => (isGhost(id) ? 'ghost' : 'doc'));
  const types = ids.map((id) => typeOf.get(id) ?? null);
  const details = ids.map((id) =>
    isGhost(id) ? ghosts.get(id)!.target : tree.dirOf(id as EntryId),
  );
  const labels = ids.map((id, i) => {
    if (isGhost(id)) return ghostLabel.get(id)!;
    const name = nodeName(tree.get(id as EntryId)!.name);
    return (names.get(name.toLowerCase()) ?? 0) > 1 && details[i]
      ? `${name} (${details[i]})`
      : name;
  });
  return {
    ids,
    kinds,
    types,
    labels,
    details,
    degree,
    edges,
    suggested,
    suggestSkipped,
    ghosts,
  };
}
