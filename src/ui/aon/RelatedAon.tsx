import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { EntryId } from '@/domain/types';
import { aiSource } from '@/app/ai';
import { openEntry } from '@/app/actions';
import { ws } from '@/app/app-store';
import { editorActions } from '@/app/editor-store';
import { baseName } from '@/domain/names';
import { addRelatedLink, suggestRelated, type Related } from '@/app/aon/related';
import { toast, toastError } from '@/app/toast-store';

/** "Ask AON" for notes worth linking from this one, with a one-click link. */
export function RelatedAon({ docId }: { docId: EntryId }) {
  const [items, setItems] = useState<Related[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const noKey = ['none', 'sign-in'].includes(aiSource());
  useEffect(() => {
    setItems(null);
    setError('');
    return () => abort.current?.abort();
  }, [docId]);

  const ask = async () => {
    setBusy(true);
    setError('');
    abort.current = new AbortController();
    try {
      await editorActions.flush(docId);
      setItems(await suggestRelated(docId, abort.current.signal));
    } catch (e) {
      if (!abort.current.signal.aborted)
        setError(e instanceof Error ? e.message : 'AON could not find related documents.');
    } finally {
      setBusy(false);
    }
  };
  const link = async (r: Related) => {
    const target = ws().get(r.id);
    if (!target) return;
    try {
      if (!(await editorActions.saveBeforeAction([docId]))) return;
      await ws().updateTexts([docId], (t) => addRelatedLink(t, baseName(target.name)) ?? t);
      toast({ message: `Linked to ${baseName(target.name)} under Related.`, tone: 'success' });
    } catch (e) {
      toastError('Unable to add the link.', e);
    }
  };

  return (
    <section>
      <h3 className="section-label mb-1.5 flex items-center gap-1 px-1">
        <Sparkles size={12} aria-hidden /> AON suggestions
      </h3>
      {items === null ? (
        <button
          type="button"
          className="btn btn-secondary h-8 px-2 text-caption"
          disabled={busy || noKey}
          title={noKey ? 'Add an API key in Settings first' : undefined}
          onClick={() => void ask()}
        >
          {busy ? 'Looking…' : 'Find notes worth linking'}
        </button>
      ) : items.length ? (
        <ul className="space-y-2" aria-label="Suggested links">
          {items.map((r) => (
            <li key={r.id} className="rounded-md border border-hairline p-2">
              <button
                type="button"
                className="block max-w-full truncate text-left text-[13px] font-medium text-ink hover:underline"
                onClick={() => void openEntry(r.id)}
              >
                {r.path}
              </button>
              {r.why && <p className="text-caption text-steel">{r.why}</p>}
              <button
                type="button"
                className="mt-1 text-caption text-primary underline"
                onClick={() => void link(r)}
              >
                Add link under Related
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-1 text-caption text-steel">AON found nothing worth linking.</p>
      )}
      {error && (
        <p role="alert" className="px-1 text-caption text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
