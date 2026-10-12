/**
 * Core domain types. These are storage-agnostic: every storage provider persists
 * exactly these shapes, and the UI only ever sees them through the application layer.
 */

export type EntryId = string;
export type EntryKind = 'folder' | 'file';

export interface Entry {
  /** Stable identity, independent of name and location. */
  id: EntryId;
  kind: EntryKind;
  /** `null` means the workspace root. */
  parentId: EntryId | null;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Byte size of the content (files only). */
  size: number;
  /** Text files are stored as strings; everything else as binary blobs. */
  encoding?: 'text' | 'binary';
  mime?: string;
  favorite?: boolean;
  /** Set on the top-most trashed entry; descendants are implicitly trashed. */
  trashedAt?: number;
}

export type FileContent = string | Blob;

export interface Version {
  id: string;
  entryId: EntryId;
  createdAt: number;
  text: string;
  /** Snapshot of a binary file (an edited spreadsheet). `text` is empty then. */
  blob?: Blob;
  /** Why the snapshot was taken, shown in the history list. */
  reason: 'edit' | 'restore' | 'recovery' | 'import' | 'manual';
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  createdAt: number;
  /** Storage provider id, e.g. `indexeddb`. */
  provider: string;
}

export const isFolder = (e: Entry): boolean => e.kind === 'folder';
export const isFile = (e: Entry): boolean => e.kind === 'file';
