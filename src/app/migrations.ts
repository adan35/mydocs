import type { WorkspaceStore } from '@/storage/types';

/**
 * Version of the stored workspace format. Bump it with a migration whenever stored
 * records change shape; documents themselves are plain files and never migrate.
 *
 * 1: entries, contents, versions (text snapshots).
 * 2: versions may also carry `blob`, a snapshot of a binary file (spreadsheets edited
 *    in place). Older records are valid as they are, so the step only records the version.
 */
export const SCHEMA_VERSION = 2;

const KEY = 'schemaVersion';

const steps: Record<number, (store: WorkspaceStore) => Promise<void>> = {
  2: async () => {},
};

export class NewerWorkspaceError extends Error {
  override name = 'NewerWorkspaceError';
}

/** Brings a workspace up to the current format, one step at a time. */
export async function migrateWorkspace(store: WorkspaceStore): Promise<void> {
  const current = (await store.getMeta<number>(KEY)) ?? 1;
  if (current > SCHEMA_VERSION) {
    // Opening it would risk writing records this version doesn't understand.
    throw new NewerWorkspaceError(
      'This workspace was saved by a newer version of My Doc. Update the app to open it.',
    );
  }
  for (let v = current + 1; v <= SCHEMA_VERSION; v++) {
    await steps[v]?.(store);
    await store.setMeta(KEY, v);
  }
}
