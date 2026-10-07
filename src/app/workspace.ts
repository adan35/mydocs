import type { Entry, EntryId, FileContent, Version } from '@/domain/types';
import { createId } from '@/domain/ids';
import { Tree } from '@/domain/tree';
import {
  NAME_ERROR_MESSAGES,
  baseName,
  fileTypeOf,
  isMarkdownName,
  isTextType,
  mimeOf,
  uniqueName,
  validateName,
} from '@/domain/names';
import { extractLinks, rewriteLinks, type RawLink } from '@/domain/links';
import { encodeHrefPath, relativePath, resolvePath } from '@/domain/paths';
import { addTag, removeTag, replaceTag } from '@/domain/tags';
import { linkFirstMention } from '@/domain/mentions';
import type { ChangeSet, WorkspaceStore } from '@/storage/types';

/** Snapshot the previous content when the last snapshot is older than this. */
export const VERSION_INTERVAL_MS = 5 * 60 * 1000;
export const MAX_VERSIONS_PER_DOC = 50;
/** Largest text file opened in the editor. Bigger files are treated as binary. */
export const MAX_TEXT_BYTES = 20 * 1024 * 1024;

export class WorkspaceError extends Error {
  override name = 'WorkspaceError';
}

export type WorkspaceEvent =
  { type: 'tree' } | { type: 'content'; ids: EntryId[]; source: 'save' | 'external' };

type Listener = (event: WorkspaceEvent) => void;

let writeGuard: () => boolean = () => true;

/** Lets the app block writes, for example while another browser tab owns the data. */
export function setWriteGuard(fn: () => boolean) {
  writeGuard = fn;
}

const textBytes = (s: string) => new Blob([s]).size;

/**
 * The application-level model of one open workspace. All mutations go through here:
 * it validates them, persists them atomically through the store, then updates its
 * in-memory state and notifies listeners. The UI never talks to storage directly.
 */
export class Workspace {
  private entries = new Map<EntryId, Entry>();
  private texts = new Map<EntryId, string>();
  private treeCache: Tree | null = null;
  private listeners = new Set<Listener>();
  private queue: Promise<unknown> = Promise.resolve();
  private snapshotAt = new Map<EntryId, number>();

  private constructor(readonly store: WorkspaceStore) {}

  static async open(store: WorkspaceStore): Promise<Workspace> {
    const ws = new Workspace(store);
    const [entries, texts] = await Promise.all([store.listEntries(), store.readAllText()]);
    for (const e of entries) ws.entries.set(e.id, e);
    for (const [id, text] of texts) if (ws.entries.has(id)) ws.texts.set(id, text);
    return ws;
  }

  get id(): string {
    return this.store.info.id;
  }

  get name(): string {
    return this.store.info.name;
  }

  get tree(): Tree {
    this.treeCache ??= new Tree(this.entries.values());
    return this.treeCache;
  }

  /** Text of every loaded text file (used by indexes). */
  allTexts(): ReadonlyMap<EntryId, string> {
    return this.texts;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(event: WorkspaceEvent) {
    for (const fn of this.listeners) fn(event);
  }

  /** Runs mutations one at a time so they never interleave. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async apply(changes: ChangeSet, texts?: Map<EntryId, string>): Promise<void> {
    if (!writeGuard()) {
      throw new WorkspaceError(
        'My Doc is open in another tab, so changes here are paused. Choose "Use here" to continue in this tab.',
      );
    }
    await this.store.commit(changes);
    for (const e of changes.putEntries ?? []) this.entries.set(e.id, e);
    for (const id of changes.deleteEntries ?? []) {
      this.entries.delete(id);
      this.texts.delete(id);
      this.snapshotAt.delete(id);
    }
    for (const [id, text] of texts ?? []) this.texts.set(id, text);
    if (changes.putEntries?.length || changes.deleteEntries?.length) this.treeCache = null;
  }

  // ---------------------------------------------------------------- reads

  get(id: EntryId): Entry | undefined {
    return this.entries.get(id);
  }

  async readText(id: EntryId): Promise<string> {
    const cached = this.texts.get(id);
    if (cached !== undefined) return cached;
    const data = await this.store.readContent(id);
    if (typeof data === 'string') {
      this.texts.set(id, data);
      return data;
    }
    if (data instanceof Blob) return data.text();
    return '';
  }

  async readBlob(id: EntryId): Promise<Blob | undefined> {
    const e = this.entries.get(id);
    const data = await this.store.readContent(id);
    if (data === undefined) return undefined;
    if (data instanceof Blob) return data;
    return new Blob([data], { type: e ? mimeOf(e.name) : 'text/plain' });
  }

  isTextEntry(e: Entry): boolean {
    return e.kind === 'file' && e.encoding !== 'binary';
  }

  // ---------------------------------------------------------------- helpers

  private assertName(name: string): string {
    const err = validateName(name);
    if (err) throw new WorkspaceError(NAME_ERROR_MESSAGES[err]);
    return name.trim();
  }

  private assertFolder(parentId: EntryId | null) {
    if (parentId === null) return;
    const p = this.entries.get(parentId);
    if (!p || p.kind !== 'folder' || this.tree.isTrashed(parentId)) {
      throw new WorkspaceError('The destination folder no longer exists.');
    }
  }

  private siblingNames(parentId: EntryId | null, exceptId?: EntryId): string[] {
    return this.tree
      .childrenOf(parentId)
      .filter((e) => e.id !== exceptId)
      .map((e) => e.name);
  }

  /** A name that's free in `parentId`. */
  freeName(parentId: EntryId | null, desired: string, exceptId?: EntryId): string {
    return uniqueName(desired, this.siblingNames(parentId, exceptId));
  }

  // ---------------------------------------------------------------- create

  createFile(
    parentId: EntryId | null,
    name: string,
    content: FileContent = '',
    opts: { uniquify?: boolean } = {},
  ): Promise<Entry> {
    return this.serial(async () => {
      this.assertFolder(parentId);
      let clean = this.assertName(name);
      if (opts.uniquify !== false) clean = this.freeName(parentId, clean);
      else if (this.siblingNames(parentId).some((n) => n.toLowerCase() === clean.toLowerCase())) {
        throw new WorkspaceError(`"${clean}" already exists in this folder.`);
      }
      const now = Date.now();
      const text = typeof content === 'string' ? content : null;
      const entry: Entry = {
        id: createId(),
        kind: 'file',
        parentId,
        name: clean,
        createdAt: now,
        updatedAt: now,
        size: text !== null ? textBytes(text) : (content as Blob).size,
        encoding: text !== null ? 'text' : 'binary',
        mime: typeof content === 'string' ? mimeOf(clean) : (content as Blob).type || mimeOf(clean),
      };
      await this.apply(
        { putEntries: [entry], putContents: [{ id: entry.id, data: content }] },
        text !== null ? new Map([[entry.id, text]]) : undefined,
      );
      this.emit({ type: 'tree' });
      return entry;
    });
  }

  /**
   * Creates many files in one atomic commit and one tree event (used by import).
   * Names are made unique against existing siblings and each other.
   */
  createFiles(
    specs: { parentId: EntryId | null; name: string; content: FileContent }[],
  ): Promise<Entry[]> {
    return this.serial(async () => {
      const taken = new Map<EntryId | null, string[]>();
      const now = Date.now();
      const created: Entry[] = [];
      const texts = new Map<EntryId, string>();
      for (const { parentId, name, content } of specs) {
        this.assertFolder(parentId);
        let siblings = taken.get(parentId);
        if (!siblings) taken.set(parentId, (siblings = this.siblingNames(parentId)));
        const clean = uniqueName(this.assertName(name), siblings);
        siblings.push(clean);
        const text = typeof content === 'string' ? content : null;
        const entry: Entry = {
          id: createId(),
          kind: 'file',
          parentId,
          name: clean,
          createdAt: now,
          updatedAt: now,
          size: text !== null ? textBytes(text) : (content as Blob).size,
          encoding: text !== null ? 'text' : 'binary',
          mime: text !== null ? mimeOf(clean) : (content as Blob).type || mimeOf(clean),
        };
        created.push(entry);
        if (text !== null) texts.set(entry.id, text);
      }
      if (!created.length) return created;
      await this.apply(
        {
          putEntries: created,
          putContents: created.map((e, i) => ({ id: e.id, data: specs[i]!.content })),
        },
        texts,
      );
      this.emit({ type: 'tree' });
      return created;
    });
  }

  createFolder(parentId: EntryId | null, name: string, opts: { uniquify?: boolean } = {}) {
    return this.serial(async () => {
      this.assertFolder(parentId);
      let clean = this.assertName(name);
      if (opts.uniquify !== false) clean = this.freeName(parentId, clean);
      else if (this.siblingNames(parentId).some((n) => n.toLowerCase() === clean.toLowerCase())) {
        throw new WorkspaceError(`"${clean}" already exists in this folder.`);
      }
      const now = Date.now();
      const entry: Entry = {
        id: createId(),
        kind: 'folder',
        parentId,
        name: clean,
        createdAt: now,
        updatedAt: now,
        size: 0,
      };
      await this.apply({ putEntries: [entry] });
      this.emit({ type: 'tree' });
      return entry;
    });
  }

  /** Finds a live folder by name in `parentId`, creating it if needed. */
  async ensureFolder(parentId: EntryId | null, name: string): Promise<Entry> {
    const existing = this.tree
      .childrenOf(parentId)
      .find((e) => e.kind === 'folder' && e.name.toLowerCase() === name.toLowerCase());
    return existing ?? this.createFolder(parentId, name, { uniquify: true });
  }

  // ---------------------------------------------------------------- save

  /** Persists text content. Snapshots the previous version when enough time has passed. */
  saveText(id: EntryId, text: string, reason: Version['reason'] = 'edit'): Promise<Entry> {
    return this.serial(async () => {
      const entry = this.entries.get(id);
      if (!entry || entry.kind !== 'file') throw new WorkspaceError('This file no longer exists.');
      const previous = await this.readText(id);
      if (previous === text) return entry;
      const changes: ChangeSet = {};
      const snapshot = await this.maybeSnapshot(entry, previous, reason);
      if (snapshot) Object.assign(changes, snapshot);
      const next: Entry = { ...entry, updatedAt: Date.now(), size: textBytes(text) };
      changes.putEntries = [next];
      changes.putContents = [{ id, data: text }];
      await this.apply(changes, new Map([[id, text]]));
      this.emit({ type: 'content', ids: [id], source: 'save' });
      return next;
    });
  }

  private async maybeSnapshot(
    entry: Entry,
    previous: string,
    reason: Version['reason'],
    force = false,
  ): Promise<Pick<ChangeSet, 'putVersions' | 'deleteVersions'> | null> {
    if (!previous.trim()) return null;
    const now = Date.now();
    let versions: Version[] | null = null;
    let last = this.snapshotAt.get(entry.id);
    if (last === undefined) {
      versions = await this.store.listVersions(entry.id);
      last = Math.max(0, ...versions.map((v) => v.createdAt));
    }
    if (!force && reason === 'edit' && now - last < VERSION_INTERVAL_MS) return null;
    versions ??= await this.store.listVersions(entry.id);
    if (versions.some((v) => v.text === previous && now - v.createdAt < VERSION_INTERVAL_MS)) {
      return null;
    }
    const version: Version = {
      id: createId(),
      entryId: entry.id,
      createdAt: entry.updatedAt,
      text: previous,
      reason,
    };
    this.snapshotAt.set(entry.id, now);
    const sorted = [...versions].sort((a, b) => a.createdAt - b.createdAt);
    const excess = sorted.length + 1 - MAX_VERSIONS_PER_DOC;
    return {
      putVersions: [version],
      deleteVersions: excess > 0 ? sorted.slice(0, excess).map((v) => v.id) : [],
    };
  }

  async listVersions(id: EntryId): Promise<Version[]> {
    const versions = await this.store.listVersions(id);
    return versions.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Restores a version, snapshotting the current content first so nothing is lost. */
  restoreVersion(id: EntryId, versionId: string): Promise<Entry> {
    return this.serial(async () => {
      const entry = this.entries.get(id);
      if (!entry) throw new WorkspaceError('This file no longer exists.');
      const versions = await this.store.listVersions(id);
      const version = versions.find((v) => v.id === versionId);
      if (!version) throw new WorkspaceError('That version is no longer available.');
      const current = await this.readText(id);
      const snapshot = await this.maybeSnapshot(entry, current, 'restore', true);
      const next: Entry = { ...entry, updatedAt: Date.now(), size: textBytes(version.text) };
      await this.apply(
        { ...snapshot, putEntries: [next], putContents: [{ id, data: version.text }] },
        new Map([[id, version.text]]),
      );
      this.emit({ type: 'content', ids: [id], source: 'external' });
      return next;
    });
  }

  /** Overwrites a file's content (used by import "replace"), keeping a version of the old text. */
  replaceContent(id: EntryId, content: FileContent): Promise<Entry> {
    return this.serial(async () => {
      const entry = this.entries.get(id);
      if (!entry || entry.kind !== 'file') throw new WorkspaceError('This file no longer exists.');
      const text = typeof content === 'string' ? content : null;
      const changes: ChangeSet = {};
      if (text !== null && this.isTextEntry(entry)) {
        Object.assign(
          changes,
          await this.maybeSnapshot(entry, await this.readText(id), 'import', true),
        );
      }
      const next: Entry = {
        ...entry,
        updatedAt: Date.now(),
        size: text !== null ? textBytes(text) : (content as Blob).size,
        encoding: text !== null ? 'text' : 'binary',
      };
      changes.putEntries = [next];
      changes.putContents = [{ id, data: content }];
      if (text === null) this.texts.delete(id);
      await this.apply(changes, text !== null ? new Map([[id, text]]) : undefined);
      this.emit({ type: 'content', ids: [id], source: 'external' });
      return next;
    });
  }

  // ---------------------------------------------------------------- rename / move

  rename(id: EntryId, newName: string): Promise<Entry> {
    return this.serial(async () => {
      const entry = this.entries.get(id);
      if (!entry) throw new WorkspaceError('This item no longer exists.');
      const clean = this.assertName(newName);
      if (clean === entry.name) return entry;
      const clash = this.siblingNames(entry.parentId, id).some(
        (n) => n.toLowerCase() === clean.toLowerCase(),
      );
      if (clash) throw new WorkspaceError(`"${clean}" already exists in this folder.`);
      const next: Entry = { ...entry, name: clean, updatedAt: Date.now() };
      await this.relocate([next]);
      return next;
    });
  }

  move(ids: EntryId[], targetParentId: EntryId | null): Promise<Entry[]> {
    return this.serial(async () => {
      this.assertFolder(targetParentId);
      const tree = this.tree;
      // Drop items nested inside other moved items: moving the parent moves them.
      const roots = ids.filter((id) => !ids.some((o) => o !== id && tree.isWithin(id, o)));
      const taken = this.siblingNames(targetParentId);
      const moved: Entry[] = [];
      for (const id of roots) {
        const e = this.entries.get(id);
        if (!e) continue;
        if (!tree.canMove(id, targetParentId)) {
          throw new WorkspaceError(`"${e.name}" can't be moved into itself.`);
        }
        if (e.parentId === targetParentId) continue;
        const name = uniqueName(e.name, taken);
        taken.push(name);
        moved.push({ ...e, parentId: targetParentId, name });
      }
      if (moved.length) await this.relocate(moved);
      return moved;
    });
  }

  /**
   * Applies renamed/moved entries and rewrites relative links in every Markdown
   * document so links keep pointing at the same documents.
   */
  private async relocate(changed: Entry[]): Promise<void> {
    const oldTree = this.tree;
    const nextEntries = new Map(this.entries);
    for (const e of changed) nextEntries.set(e.id, e);
    const newTree = new Tree(nextEntries.values());
    const rewritten = this.rewriteLinksForRelocation(oldTree, newTree);
    const now = Date.now();
    const putEntries = [...changed];
    for (const [id, text] of rewritten) {
      const e = nextEntries.get(id)!;
      const updated = { ...e, size: textBytes(text), updatedAt: now };
      const i = putEntries.findIndex((p) => p.id === id);
      if (i >= 0) putEntries[i] = { ...putEntries[i]!, size: updated.size };
      else putEntries.push(updated);
    }
    await this.apply(
      {
        putEntries,
        putContents: [...rewritten].map(([id, data]) => ({ id, data })),
      },
      rewritten,
    );
    this.emit({ type: 'tree' });
    if (rewritten.size)
      this.emit({ type: 'content', ids: [...rewritten.keys()], source: 'external' });
  }

  private rewriteLinksForRelocation(oldTree: Tree, newTree: Tree): Map<EntryId, string> {
    const out = new Map<EntryId, string>();
    for (const [id, text] of this.texts) {
      const doc = oldTree.get(id);
      if (!doc || !isMarkdownName(doc.name) || oldTree.isTrashed(id)) continue;
      if (!text.includes('](') && !text.includes('[[')) continue;
      const oldDir = oldTree.dirOf(id);
      const newDir = newTree.dirOf(id);
      const next = rewriteLinks(text, (link) => {
        if (link.kind === 'wiki') {
          const target = resolveWikiLink(oldTree, link.target);
          if (!target) return null;
          if (link.target.includes('/')) return null;
          const newName = newTree.get(target.id)!.name;
          // [[photo.png]] was written with its extension; [[Note]] without.
          if (link.target.trim().toLowerCase() === target.name.toLowerCase())
            return newName === target.name ? null : newName;
          const newBase = baseName(newName);
          return baseName(target.name) !== newBase ? newBase : null;
        }
        const resolved = resolvePath(oldDir, link.target);
        if (resolved === null) return null;
        const target = oldTree.findByPath(resolved);
        if (!target) return null;
        const oldTargetPath = oldTree.pathOf(target.id);
        const newTargetPath = newTree.pathOf(target.id);
        if (oldDir === newDir && oldTargetPath === newTargetPath) return null;
        return formatHref(link, text, relativePath(newDir, newTargetPath));
      });
      if (next !== text) out.set(id, next);
    }
    return out;
  }

  // ---------------------------------------------------------------- duplicate

  duplicate(id: EntryId): Promise<Entry> {
    return this.serial(async () => {
      const src = this.entries.get(id);
      if (!src) throw new WorkspaceError('This item no longer exists.');
      const tree = this.tree;
      const now = Date.now();
      const ext =
        src.kind === 'file' && src.name.includes('.')
          ? src.name.slice(src.name.lastIndexOf('.'))
          : '';
      const stem = ext ? src.name.slice(0, -ext.length) : src.name;
      const rootName = this.freeName(src.parentId, `${stem} copy${ext}`);
      const putEntries: Entry[] = [];
      const putContents: { id: EntryId; data: FileContent }[] = [];
      const texts = new Map<EntryId, string>();
      const copy = async (e: Entry, parentId: EntryId | null, name: string) => {
        const clone: Entry = {
          ...e,
          id: createId(),
          parentId,
          name,
          createdAt: now,
          updatedAt: now,
          favorite: undefined,
          trashedAt: undefined,
        };
        putEntries.push(clone);
        if (e.kind === 'file') {
          const data = this.texts.get(e.id) ?? (await this.store.readContent(e.id)) ?? '';
          putContents.push({ id: clone.id, data });
          if (typeof data === 'string') texts.set(clone.id, data);
        } else {
          for (const child of tree.childrenOf(e.id)) await copy(child, clone.id, child.name);
        }
        return clone;
      };
      const root = await copy(src, src.parentId, rootName);
      await this.apply({ putEntries, putContents }, texts);
      this.emit({ type: 'tree' });
      return root;
    });
  }

  // ---------------------------------------------------------------- favorites

  setFavorite(id: EntryId, favorite: boolean): Promise<void> {
    return this.serial(async () => {
      const e = this.entries.get(id);
      if (!e) return;
      await this.apply({ putEntries: [{ ...e, favorite: favorite || undefined }] });
      this.emit({ type: 'tree' });
    });
  }

  // ---------------------------------------------------------------- trash

  trash(ids: EntryId[]): Promise<EntryId[]> {
    return this.serial(async () => {
      const tree = this.tree;
      const roots = ids.filter(
        (id) => this.entries.has(id) && !ids.some((o) => o !== id && tree.isWithin(id, o)),
      );
      const now = Date.now();
      const putEntries = roots.map((id) => ({ ...this.entries.get(id)!, trashedAt: now }));
      await this.apply({ putEntries });
      this.emit({ type: 'tree' });
      return roots;
    });
  }

  restore(ids: EntryId[]): Promise<Entry[]> {
    return this.serial(async () => {
      const tree = this.tree;
      const restored: Entry[] = [];
      for (const id of ids) {
        const e = this.entries.get(id);
        if (!e || e.trashedAt === undefined) continue;
        // If the original folder is gone or itself trashed, restore to the root.
        const parentLive =
          e.parentId !== null && this.entries.has(e.parentId) && !tree.isTrashed(e.parentId);
        const parentId = parentLive ? e.parentId : null;
        const taken = [
          ...this.siblingNames(parentId),
          ...restored.filter((r) => r.parentId === parentId).map((r) => r.name),
        ];
        restored.push({ ...e, parentId, trashedAt: undefined, name: uniqueName(e.name, taken) });
      }
      await this.apply({ putEntries: restored });
      this.emit({ type: 'tree' });
      return restored;
    });
  }

  /** Permanently deletes trashed items (and everything beneath them). Irreversible. */
  deletePermanently(ids: EntryId[]): Promise<void> {
    return this.serial(async () => {
      const tree = this.tree;
      const all = new Set<EntryId>();
      for (const id of ids) {
        if (!this.entries.has(id)) continue;
        all.add(id);
        for (const d of tree.descendants(id)) all.add(d.id);
      }
      const versionIds: string[] = [];
      for (const id of all) {
        if (this.entries.get(id)?.kind === 'file') {
          for (const v of await this.store.listVersions(id)) versionIds.push(v.id);
        }
      }
      await this.apply({
        deleteEntries: [...all],
        deleteContents: [...all],
        deleteVersions: versionIds,
      });
      this.emit({ type: 'tree' });
    });
  }

  emptyTrash(): Promise<void> {
    return this.deletePermanently(this.tree.trashedRoots().map((e) => e.id));
  }

  // ---------------------------------------------------------------- tags

  private async editTexts(ids: EntryId[], fn: (text: string) => string): Promise<EntryId[]> {
    const changed = new Map<EntryId, string>();
    for (const id of ids) {
      const text = await this.readText(id);
      const next = fn(text);
      if (next !== text) changed.set(id, next);
    }
    if (!changed.size) return [];
    const now = Date.now();
    await this.apply(
      {
        putEntries: [...changed].map(([id, t]) => ({
          ...this.entries.get(id)!,
          size: textBytes(t),
          updatedAt: now,
        })),
        putContents: [...changed].map(([id, data]) => ({ id, data })),
      },
      changed,
    );
    this.emit({ type: 'content', ids: [...changed.keys()], source: 'external' });
    return [...changed.keys()];
  }

  addTag(id: EntryId, tag: string) {
    return this.serial(() => this.editTexts([id], (t) => addTag(t, tag)));
  }

  removeTag(id: EntryId, tag: string) {
    return this.serial(() => this.editTexts([id], (t) => removeTag(t, tag)));
  }

  renameTag(docIds: EntryId[], from: string, to: string) {
    return this.serial(() => this.editTexts(docIds, (t) => replaceTag(t, from, to)));
  }

  /** Turns the first plain-text mention of `name` in a document into a wiki link. */
  linkMention(id: EntryId, name: string) {
    return this.serial(() => this.editTexts([id], (t) => linkFirstMention(t, name) ?? t));
  }
}

/** Live files keyed by lower-case name and (for text files) extension-less name, per tree snapshot. */
const wikiIndexes = new WeakMap<Tree, Map<string, Entry[]>>();

function wikiIndex(tree: Tree): Map<string, Entry[]> {
  let index = wikiIndexes.get(tree);
  if (index) return index;
  index = new Map();
  const add = (key: string, e: Entry) => {
    const list = index!.get(key);
    if (!list) index!.set(key, [e]);
    else if (list[list.length - 1] !== e) list.push(e);
  };
  for (const e of tree.liveFiles()) {
    const name = e.name.toLowerCase();
    add(name, e);
    if (isTextType(fileTypeOf(e.name))) add(baseName(name), e);
  }
  wikiIndexes.set(tree, index);
  return index;
}

/** Resolves `[[Name]]` / `[[Folder/Name]]` to a live document. */
export function resolveWikiLink(tree: Tree, target: string): Entry | undefined {
  const t = target.trim().toLowerCase();
  if (t.includes('/')) {
    return tree.findByPath(t) ?? tree.findByPath(`${t}.md`);
  }
  let best: Entry | undefined;
  for (const e of wikiIndex(tree).get(t) ?? []) {
    // Prefer Markdown files on a tie.
    if (!best || (isMarkdownName(e.name) && !isMarkdownName(best.name))) best = e;
  }
  return best;
}

/** Formats a rewritten href in the same style as the original link. */
function formatHref(link: RawLink, src: string, rel: string): string {
  const original = src.slice(link.start, link.end);
  const bracketed = src[link.start - 1] === '<';
  let href = original.startsWith('./') || rel.startsWith('../') ? rel : rel.replace(/^\.\//, '');
  if (!bracketed && (/[\s()]/.test(href) || original.includes('%'))) href = encodeHrefPath(href);
  return href;
}

export { extractLinks };
