import type { Entry } from '@/domain/types';
import type { Tree } from '@/domain/tree';

/** Folders AON leaves alone: other features own their files. */
const PROTECTED_FOLDERS = new Set(['notes', 'templates', 'assets']);
// eslint-disable-next-line no-control-regex
const BAD_NAME = /[\\:*?"<>|\u0000-\u001f]/;
const MAX_DEPTH = 3;

/** A folder path the model proposed, cleaned: '' is the root, null is unusable. */
export function cleanFolderPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const parts = raw
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > MAX_DEPTH) return null;
  for (const p of parts)
    if (p === '.' || p === '..' || p.length > 60 || BAD_NAME.test(p)) return null;
  if (parts.some((p) => PROTECTED_FOLDERS.has(p.toLowerCase()))) return null;
  return parts.join('/');
}

/** A file name with the wanted extension, or null. */
export function cleanFileName(raw: unknown, ext: string): string | null {
  if (typeof raw !== 'string') return null;
  let name = raw.trim().replace(/^.*[\\/]/, '');
  if (!name.toLowerCase().endsWith(ext.toLowerCase())) name += ext;
  const stem = name.slice(0, -ext.length).trim();
  if (!stem || stem.startsWith('.') || name.length > 80 || BAD_NAME.test(name)) return null;
  return stem + ext;
}

/** Files tidy-up may rename or move: ordinary documents outside the folders other features own. */
export function isTidyable(tree: Tree, e: Entry): boolean {
  if (e.kind !== 'file' || tree.isTrashed(e.id) || e.name.toLowerCase() === 'aon.md') return false;
  return !tree.ancestors(e.id).some((a) => PROTECTED_FOLDERS.has(a.name.toLowerCase()));
}
