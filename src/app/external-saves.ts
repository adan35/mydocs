import type { EntryId } from '@/domain/types';

/** Editors for binary formats participate in the same save guards as text buffers. */
interface ExternalSave {
  flush(): Promise<void>;
  hasUnsaved(): boolean;
  /** In-memory recovery when a view is unmounted before a failed save can be retried. */
  snapshot?(): unknown;
  /** Serializes the current draft for export without requiring a successful local save. */
  exportBlob?(): Promise<Blob>;
}

interface RegisteredSave {
  editor: ExternalSave;
  detached: boolean;
}

const editors = new Map<EntryId, RegisteredSave>();

export const externalSaves = {
  register(id: EntryId, editor: ExternalSave): () => void {
    const registered = { editor, detached: false };
    editors.set(id, registered);
    return () => {
      if (editors.get(id) !== registered) return;
      registered.detached = true;
      // A failed save must survive switching to another document. Its callback holds
      // the original workspace and draft until it can be saved or reopened.
      if (!editor.hasUnsaved()) editors.delete(id);
    };
  },

  ids(): EntryId[] {
    return [...editors.keys()];
  },

  hasUnsaved(ids: readonly EntryId[] = externalSaves.ids()): boolean {
    return ids.some((id) => editors.get(id)?.editor.hasUnsaved());
  },

  snapshot<T>(id: EntryId): T | undefined {
    const editor = editors.get(id)?.editor;
    return editor?.hasUnsaved() ? (editor.snapshot?.() as T | undefined) : undefined;
  },

  async draftBlobs(ids: readonly EntryId[] = externalSaves.ids()): Promise<Map<EntryId, Blob>> {
    const drafts = new Map<EntryId, Blob>();
    await Promise.all(
      ids.map(async (id) => {
        const editor = editors.get(id)?.editor;
        if (editor?.hasUnsaved() && editor.exportBlob) drafts.set(id, await editor.exportBlob());
      }),
    );
    return drafts;
  },

  async flush(ids: readonly EntryId[] = externalSaves.ids()): Promise<void> {
    await Promise.all(
      ids.map(async (id) => {
        const registered = editors.get(id);
        if (!registered) return;
        try {
          await registered.editor.flush();
        } catch {
          // The editor reports save failures. Save guards inspect hasUnsaved after
          // flushing, so a rejected write cannot accidentally permit an action.
        }
        if (
          editors.get(id) === registered &&
          registered.detached &&
          !registered.editor.hasUnsaved()
        )
          editors.delete(id);
      }),
    );
  },

  /** Called only when a session has been saved and handed off, or reset in tests. */
  reset() {
    editors.clear();
  },
};
