import { useEffect, useSyncExternalStore } from 'react';
import { Transaction } from '@codemirror/state';
import type { EntryId } from '@/domain/types';
import { sanitizeFormat } from '@/lib/convert/sheet-format';
import { ws } from './app-store';
import { docModel } from './doc-model';
import { setFormats, type DocFormats } from './sheet-format-state';

/**
 * Sheet colors of text documents (CSV, TSV, UNL, Markdown tables). The file itself can't
 * hold them, so they are saved in the workspace beside it, and travel with the document
 * when it is converted to an Excel workbook.
 */
const metaKey = (id: EntryId) => `sheetFormats:${id}`;

/** What is stored for each document, to skip saving what was just loaded. */
const stored = new Map<EntryId, string>();
const loading = new Set<EntryId>();
const EMPTY: DocFormats = {};
const timers = new Map<EntryId, ReturnType<typeof setTimeout>>();
const subscribers = new Set<() => void>();
const SAVE_DELAY = 400;

async function save(id: EntryId, formats: DocFormats) {
  const json = JSON.stringify(formats);
  if (stored.get(id) === json) return;
  stored.set(id, json);
  try {
    await ws().store.setMeta(metaKey(id), formats);
  } catch {
    // Colors are not worth interrupting the work for; they are tried again on the next change.
    stored.delete(id);
  }
}

docModel.onFormats((id, formats) => {
  subscribers.forEach((fn) => fn());
  clearTimeout(timers.get(id));
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      void save(id, formats);
    }, SAVE_DELAY),
  );
});

/** Cleans what was stored (it may come from an older or newer version). */
function clean(raw: unknown): DocFormats {
  const out: DocFormats = {};
  if (raw && typeof raw === 'object')
    for (const [k, v] of Object.entries(raw)) {
      const f = sanitizeFormat(v);
      if (f && /^\d+$/.test(k)) out[k] = f;
    }
  return out;
}

/**
 * Loads a document's saved colors into its editor state (not undoable). `text` creates the
 * state when the document has none yet.
 */
export async function loadFormats(id: EntryId, text: string) {
  if (loading.has(id)) return;
  loading.add(id);
  try {
    const formats = clean(await ws().store.getMeta<DocFormats>(metaKey(id)));
    stored.set(id, JSON.stringify(formats));
    docModel.state(id, docModel.text(id) ?? text);
    // Colors painted while this was loading win.
    if (!Object.keys(formats).length || Object.keys(docModel.formats(id)).length) return;
    docModel.dispatchRemote(id, {
      effects: setFormats.of(formats),
      annotations: Transaction.addToHistory.of(false),
    });
    subscribers.forEach((fn) => fn());
  } catch {
    // No saved colors is the same as none.
  } finally {
    loading.delete(id);
  }
}

/** Colors saved for a document, for conversions that don't go through the editor. */
export async function savedFormats(id: EntryId): Promise<DocFormats> {
  const open = docModel.formats(id);
  if (Object.keys(open).length) return open;
  try {
    return clean(await ws().store.getMeta<DocFormats>(metaKey(id)));
  } catch {
    return {};
  }
}

/** The colors of an open text document, kept current (also after undo). */
export function useDocFormats(id: EntryId, text: string): DocFormats {
  // Reopening a document recreates its editor state, so the colors are loaded again.
  useEffect(() => {
    if (!Object.keys(docModel.formats(id)).length) void loadFormats(id, text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    () => docModel.formats(id),
    () => EMPTY,
  );
}
