import { unzipSync } from 'fflate';
import type { EntryId, FileContent } from '@/domain/types';
import { fileTypeOf, isTextType, sanitizeName, extensionOf, mediaKindOf } from '@/domain/names';
import { normalizePath } from '@/domain/paths';
import type { ConflictChoice } from './dialog-store';
import { canSaveToDisk } from './disk-links';
import { MAX_TEXT_BYTES, type Workspace } from './workspace';

export const MAX_IMPORT_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_IMPORT_TOTAL_BYTES = 1024 * 1024 * 1024;
const MAX_ZIP_BYTES = 200 * 1024 * 1024;

/** Paths that are never useful to import (OS junk, VCS internals, dependency folders). */
export const IGNORED_SEGMENTS = new Set([
  '.git',
  'node_modules',
  '__MACOSX',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '.svn',
  '.hg',
]);

export interface ImportItem {
  /** Path relative to the import root, using `/`. */
  path: string;
  file: Blob & { name?: string };
  /** The file on disk, when the browser gave us a writable handle (File System Access API). */
  handle?: FileSystemFileHandle;
  /** The folder on disk this file was listed from (a picked or dropped folder, File System Access API). */
  root?: FileSystemDirectoryHandle;
  /** The browser refused to open the file while listing the folder. */
  unreadable?: boolean;
}

/** Shown when a file can't be read; the import carries on without it. */
export const UNREADABLE_REASON =
  'Could not be read. It may be open in another app, not downloaded from cloud storage yet, or blocked by permissions.';

export interface ImportResult {
  files: number;
  folders: number;
  replaced: number;
  skipped: { path: string; reason: string }[];
  firstFileId?: EntryId;
  /** The top-level folder holding the first imported file, when it came inside a folder. */
  firstFolderId?: EntryId;
  /**
   * Imported files that stay linked to their original file on disk: text files are saved
   * back to it, and every linked file is refreshed when it changes there.
   */
  diskLinks: { id: EntryId; handle: FileSystemFileHandle; binary?: boolean }[];
}

export type ConflictResolver = (name: string, count: number) => Promise<ConflictChoice>;

/** Decides whether a file is text: by extension, then by sniffing for binary bytes. */
export async function readAsTextIfText(blob: Blob, name: string): Promise<string | null> {
  if (blob.size > MAX_TEXT_BYTES) return null;
  return textFromBytes(new Uint8Array(await blob.arrayBuffer()), name);
}

export function textFromBytes(buf: Uint8Array, name: string): string | null {
  if (buf.byteLength > MAX_TEXT_BYTES) return null;
  const type = fileTypeOf(name);
  if (type === 'image' || type === 'pdf' || mediaKindOf(name)) return null;
  const known = isTextType(type) && extensionOf(name) !== '';
  if (!known) {
    const sample = buf.subarray(0, 8192);
    if (sample.includes(0)) return null;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, '');
  } catch {
    // A known text format that isn't UTF-8 is most often Windows-1252/Latin-1 (database
    // exports such as .unl and .csv); decoding it that way keeps accented letters intact.
    return known ? new TextDecoder('windows-1252').decode(buf) : null;
  }
}

/** Expands .zip archives into individual items (with zip-slip protection). */
export async function expandZips(
  items: ImportItem[],
): Promise<{ items: ImportItem[]; skipped: ImportResult['skipped'] }> {
  const out: ImportItem[] = [];
  const skipped: ImportResult['skipped'] = [];
  for (const item of items) {
    if (extensionOf(item.path) !== 'zip') {
      out.push(item);
      continue;
    }
    if (item.file.size > MAX_ZIP_BYTES) {
      skipped.push({ path: item.path, reason: 'Archive is too large to unpack.' });
      continue;
    }
    try {
      const prefix = item.path.replace(/\.zip$/i, '');
      let total = 0;
      const files = unzipSync(new Uint8Array(await item.file.arrayBuffer()), {
        filter: (f) => {
          total += f.originalSize;
          return total <= MAX_IMPORT_TOTAL_BYTES && !f.name.endsWith('/');
        },
      });
      for (const [name, data] of Object.entries(files)) {
        // Zip-slip: entries must stay inside the archive's folder.
        if (normalizePath(name) === null) {
          skipped.push({ path: `${item.path}/${name}`, reason: 'Unsafe path.' });
          continue;
        }
        out.push({ path: `${prefix}/${name}`, file: new Blob([data as Uint8Array<ArrayBuffer>]) });
      }
    } catch {
      skipped.push({ path: item.path, reason: 'This archive could not be read.' });
    }
  }
  return { items: out, skipped };
}

/**
 * Reads a file into memory. A `File` from disk is only a reference: if the file changed,
 * was locked or went offline since it was listed, reading it throws NotReadableError.
 * A file with a disk handle gets one fresh read through the handle; otherwise it's skipped.
 * Reading up front also means IndexedDB never has to read the disk file lazily, where one
 * failure would abort a whole batch.
 */
async function readItem(
  file: Blob,
  handle: FileSystemFileHandle | undefined,
  unreadable: boolean,
): Promise<{ bytes: Uint8Array; type: string } | null> {
  if (!unreadable) {
    try {
      return { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type };
    } catch {
      // Fall through to a fresh read.
    }
  }
  if (!handle) return null;
  try {
    const fresh = await handle.getFile();
    if (fresh.size > MAX_IMPORT_FILE_BYTES) return null;
    return { bytes: new Uint8Array(await fresh.arrayBuffer()), type: fresh.type };
  } catch {
    return null;
  }
}

/**
 * Imports files into `targetId`, recreating their folder structure. Never overwrites
 * silently: name conflicts are resolved through `resolveConflict`.
 */
export async function importItems(
  ws: Workspace,
  targetId: EntryId | null,
  rawItems: ImportItem[],
  resolveConflict: ConflictResolver,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  const result: ImportResult = { files: 0, folders: 0, replaced: 0, skipped: [], diskLinks: [] };
  const expanded = await expandZips(rawItems);
  result.skipped.push(...expanded.skipped);

  // Normalize and validate paths before touching the workspace.
  const items: {
    segments: string[];
    file: Blob;
    handle?: FileSystemFileHandle;
    unreadable?: boolean;
  }[] = [];
  let total = 0;
  for (const item of expanded.items) {
    const normalized = normalizePath(item.path);
    if (!normalized) {
      result.skipped.push({ path: item.path, reason: 'Unsafe path.' });
      continue;
    }
    const segments = normalized.split('/').map((s) => sanitizeName(s));
    if (segments.some((s) => IGNORED_SEGMENTS.has(s))) continue;
    if (item.file.size > MAX_IMPORT_FILE_BYTES) {
      result.skipped.push({ path: normalized, reason: 'File is larger than 100 MB.' });
      continue;
    }
    total += item.file.size;
    if (total > MAX_IMPORT_TOTAL_BYTES) {
      result.skipped.push({ path: normalized, reason: 'Import is larger than 1 GB.' });
      continue;
    }
    items.push({ segments, file: item.file, handle: item.handle, unreadable: item.unreadable });
  }

  const folderCache = new Map<string, EntryId | null>([['', targetId]]);
  const folderFor = async (segments: string[]): Promise<EntryId | null> => {
    let key = '';
    let parent = targetId;
    for (const seg of segments) {
      key = key ? `${key}/${seg}` : seg;
      const cached = folderCache.get(key);
      if (cached !== undefined) {
        parent = cached;
        continue;
      }
      const existing = ws.tree
        .childrenOf(parent)
        .find((e) => e.kind === 'folder' && e.name.toLowerCase() === seg.toLowerCase());
      if (existing) parent = existing.id;
      else {
        parent = (await ws.createFolder(parent, seg, { uniquify: true })).id;
        result.folders++;
      }
      folderCache.set(key, parent);
    }
    return parent;
  };

  // New files are created in batches: one commit and one tree event per batch keeps
  // large imports linear instead of rebuilding indexes after every file.
  const BATCH = 250;
  /** Batches also flush by size, since file contents are held in memory until written. */
  const BATCH_BYTES = 64 * 1024 * 1024;
  let pendingBytes = 0;
  let done = 0;
  let pending: {
    parentId: EntryId | null;
    name: string;
    content: FileContent;
    handle?: FileSystemFileHandle;
  }[] = [];
  const pendingNames = new Set<string>();
  const flush = async () => {
    if (!pending.length) return;
    const created = await ws.createFiles(
      pending.map(({ parentId, name, content }) => ({ parentId, name, content })),
    );
    created.forEach((e, i) => {
      const handle = pending[i]?.handle;
      if (handle)
        result.diskLinks.push({
          id: e.id,
          handle,
          binary: typeof pending[i]?.content !== 'string',
        });
    });
    result.files += created.length;
    result.firstFileId ??= created[0]?.id;
    done += created.length;
    pending = [];
    pendingBytes = 0;
    pendingNames.clear();
    onProgress?.(done, items.length);
  };

  let applyAll: ConflictChoice | null = null;
  for (const { segments, file, handle, unreadable } of items) {
    const name = segments[segments.length - 1]!;
    const read = await readItem(file, handle, !!unreadable);
    if (!read) {
      result.skipped.push({ path: segments.join('/'), reason: UNREADABLE_REASON });
      done++;
      continue;
    }
    const parentId = await folderFor(segments.slice(0, -1));
    const text = textFromBytes(read.bytes, name);
    const content = text ?? new Blob([read.bytes as Uint8Array<ArrayBuffer>], { type: read.type });
    // A clash with a file queued in this batch is resolved like any other clash.
    if (pendingNames.has(`${parentId}/${name.toLowerCase()}`)) await flush();
    const clash = ws.tree
      .childrenOf(parentId)
      .find((e) => e.name.toLowerCase() === name.toLowerCase());
    if (clash) {
      await flush();
      let choice: ConflictChoice | null = applyAll;
      if (!choice) {
        choice = await resolveConflict(name, items.length - done);
        if (choice.applyToAll) applyAll = choice;
      }
      if (choice.action === 'cancel') {
        result.skipped.push({ path: segments.join('/'), reason: 'Import cancelled.' });
        break;
      }
      if (choice.action === 'skip' || (choice.action === 'replace' && clash.kind === 'folder')) {
        result.skipped.push({ path: segments.join('/'), reason: 'Already exists.' });
        done++;
        continue;
      }
      if (choice.action === 'replace') {
        await ws.replaceContent(clash.id, content);
        if (handle) result.diskLinks.push({ id: clash.id, handle, binary: text === null });
        result.replaced++;
        result.firstFileId ??= clash.id;
        if (segments.length > 1)
          result.firstFolderId ??= folderCache.get(segments[0]!) ?? undefined;
        done++;
        onProgress?.(done, items.length);
        continue;
      }
    }
    pending.push({ parentId, name, content, handle });
    if (segments.length > 1) result.firstFolderId ??= folderCache.get(segments[0]!) ?? undefined;
    pendingBytes += read.bytes.byteLength;
    pendingNames.add(`${parentId}/${name.toLowerCase()}`);
    if (pending.length >= BATCH || pendingBytes >= BATCH_BYTES) await flush();
  }
  await flush();
  return result;
}

type HandleItem = DataTransferItem & {
  getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
};

/** A file from a picked or dropped handle; a file the browser can't open is kept as unreadable. */
export async function itemFromFileHandle(
  handle: FileSystemFileHandle,
  path: string,
): Promise<ImportItem> {
  try {
    return { path, file: await handle.getFile(), handle };
  } catch {
    return { path, file: new Blob(), handle, unreadable: true };
  }
}

/** Lists a folder picked or dropped as a File System Access handle, recursively. */
export async function itemsFromHandles(handles: FileSystemHandle[]): Promise<ImportItem[]> {
  const out: ImportItem[] = [];
  const walk = async (
    handle: FileSystemHandle,
    prefix: string,
    root?: FileSystemDirectoryHandle,
  ): Promise<void> => {
    if (IGNORED_SEGMENTS.has(handle.name)) return;
    if (handle.kind === 'file') {
      out.push({
        ...(await itemFromFileHandle(handle as FileSystemFileHandle, prefix + handle.name)),
        root,
      });
      return;
    }
    const dir = handle as FileSystemDirectoryHandle & {
      values(): AsyncIterable<FileSystemHandle>;
    };
    for await (const child of dir.values()) await walk(child, `${prefix}${dir.name}/`, root ?? dir);
  };
  for (const h of handles) await walk(h, '');
  return out;
}

/**
 * Reads a drag-and-drop DataTransfer, walking dropped folders recursively. Where the
 * browser can save back to disk, dropped files keep their handles like picked ones do.
 * Must be called synchronously from the drop event: the items are gone after it returns.
 */
export function itemsFromDataTransfer(
  dt: DataTransfer,
  withHandles = canSaveToDisk(),
): Promise<ImportItem[]> {
  const items = [...dt.items].filter((i) => i.kind === 'file') as HandleItem[];
  const files = [...dt.files];
  if (withHandles && items.length && items.every((i) => i.getAsFileSystemHandle)) {
    const handles = items.map((i) => i.getAsFileSystemHandle!());
    const entries = items.map((i) => i.webkitGetAsEntry?.() ?? null);
    return Promise.all(handles).then(
      (hs) =>
        hs.every((h) => h)
          ? itemsFromHandles(hs as FileSystemHandle[])
          : itemsFromEntries(entries, files),
      () => itemsFromEntries(entries, files),
    );
  }
  const entries = items.map((i) => i.webkitGetAsEntry?.() ?? null);
  return itemsFromEntries(entries, files);
}

async function itemsFromEntries(
  maybeEntries: (FileSystemEntry | null)[],
  files: File[],
): Promise<ImportItem[]> {
  const entries = maybeEntries.filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return files.map((file) => ({ path: file.name, file }));
  const out: ImportItem[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (IGNORED_SEGMENTS.has(entry.name)) return;
    if (entry.isFile) {
      const path = prefix + entry.name;
      try {
        const file = await new Promise<File>((res, rej) =>
          (entry as FileSystemFileEntry).file(res, rej),
        );
        out.push({ path, file });
      } catch {
        out.push({ path, file: new Blob(), unreadable: true });
      }
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries returns results in batches; keep reading until empty.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) =>
          reader.readEntries(res, rej),
        );
        if (!batch.length) break;
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      }
    }
  };
  for (const e of entries) await walk(e, '');
  return out;
}

/** Converts an <input type=file> selection (with or without webkitdirectory). */
export function itemsFromFileList(files: FileList | File[]): ImportItem[] {
  return [...files].map((file) => ({ path: file.webkitRelativePath || file.name, file }));
}
