import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { aiSource } from '@/app/ai';
import { useApp } from '@/app/app-store';
import { navigate } from '@/app/router';
import { closeAonDialog, useAonDialog } from '@/app/aon/dialog';
import { applyTidy, planTidy, type TidyOp, type TidyResult } from '@/app/aon/tidy';
import { MAX_CAPTURE_CHARS, planCapture, saveCapture, type CapturePlan } from '@/app/aon/capture';
import { officeText, OFFICE_TEXT_EXTENSIONS } from '@/lib/office-text';
import { toastError } from '@/app/toast-store';

export function AonDialogs() {
  const kind = useAonDialog((s) => s.kind);
  if (kind === 'tidy') return <TidyDialog />;
  if (kind === 'capture') return <CaptureDialog />;
  return null;
}

/** Shown instead of a dialog's body when no AI key is set up. */
function NeedsKey() {
  const source = aiSource();
  if (source !== 'none' && source !== 'sign-in') return null;
  return (
    <p className="rounded-lg border border-hairline bg-surface p-3 text-caption text-steel">
      AON needs an API key.{' '}
      <button
        type="button"
        className="font-medium text-primary underline"
        onClick={() => {
          closeAonDialog();
          navigate({ name: 'settings' });
        }}
      >
        Open settings
      </button>
    </p>
  );
}

const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');

function describe(op: TidyOp) {
  return op.kind === 'move'
    ? `Move ${op.path} to ${op.to || 'the top level'}`
    : op.kind === 'rename'
      ? `Rename ${op.path} to ${op.to}`
      : `Add #${op.to} to ${op.path}`;
}

function TidyDialog() {
  const [phase, setPhase] = useState<'working' | 'review' | 'applying' | 'done' | 'error'>(
    'working',
  );
  const [ops, setOps] = useState<TidyOp[]>([]);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [result, setResult] = useState<TidyResult | null>(null);
  const [undone, setUndone] = useState(false);
  const noKey = ['none', 'sign-in'].includes(aiSource());

  useEffect(() => {
    if (noKey) return;
    const controller = new AbortController();
    planTidy(controller.signal)
      .then((o) => {
        setOps(o);
        setPhase('review');
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setError(message(e));
        setPhase('error');
      });
    return () => controller.abort();
  }, [noKey]);

  const chosen = ops.filter((o) => !off.has(o.id));
  const apply = async () => {
    setPhase('applying');
    setResult(await applyTidy(chosen));
    setPhase('done');
  };
  const footer =
    phase === 'review' && ops.length ? (
      <>
        <button type="button" className="btn btn-secondary" onClick={closeAonDialog}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!chosen.length}
          onClick={() => void apply()}
        >
          Apply {chosen.length} change{chosen.length === 1 ? '' : 's'}
        </button>
      </>
    ) : phase === 'done' && result ? (
      <>
        {result.applied > 0 && !undone && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void result.undo().then(() => setUndone(true))}
          >
            Undo all
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={closeAonDialog}>
          Done
        </button>
      </>
    ) : (
      <button type="button" className="btn btn-secondary" onClick={closeAonDialog}>
        Close
      </button>
    );

  return (
    <Dialog
      title="Tidy up with AON"
      size="lg"
      onClose={closeAonDialog}
      description="AON looks at file names and the start of each document, then suggests moves, better names and tags. Nothing changes until you apply, and you can undo."
      footer={footer}
    >
      {noKey ? (
        <NeedsKey />
      ) : phase === 'working' || phase === 'applying' ? (
        <p role="status" className="text-steel">
          {phase === 'working' ? 'AON is looking through your documents…' : 'Applying…'}
        </p>
      ) : phase === 'error' ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : phase === 'done' && result ? (
        <p role="status">
          {undone
            ? 'Everything is back where it was.'
            : `Applied ${result.applied} change${result.applied === 1 ? '' : 's'}.${result.failed ? ` ${result.failed} could not be applied (a name was taken, or a file changed).` : ''}`}
        </p>
      ) : !ops.length ? (
        <p>Everything looks well organized. AON found nothing worth changing.</p>
      ) : (
        <ul
          className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto"
          aria-label="Suggested changes"
        >
          {ops.map((op) => (
            <li key={op.id}>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={!off.has(op.id)}
                  onChange={(e) =>
                    setOff((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.delete(op.id);
                      else n.add(op.id);
                      return n;
                    })
                  }
                />
                <span className="min-w-0">
                  <span className="block break-words text-ink">{describe(op)}</span>
                  {op.reason && <span className="block text-caption text-steel">{op.reason}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

const TEXT_FILE = /\.(txt|md|markdown|csv|tsv|json|html?|rtf|log)$/i;

async function fileText(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (OFFICE_TEXT_EXTENSIONS.has(ext))
    return officeText(new Uint8Array(await file.arrayBuffer()), file.name).join('\n\n');
  if (TEXT_FILE.test(file.name) || file.type.startsWith('text/')) return file.text();
  throw new Error('AON can read text files and PowerPoint or OpenDocument files here.');
}

function CaptureDialog() {
  const seed = useAonDialog((s) => s.seed);
  const [raw, setRaw] = useState(seed);
  const [plan, setPlan] = useState<CapturePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const tree = useApp((s) => s.session?.workspace.tree);
  const [tagsText, setTagsText] = useState('');
  const noKey = ['none', 'sign-in'].includes(aiSource());
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const organize = async () => {
    setBusy(true);
    setError('');
    abort.current = new AbortController();
    try {
      const p = await planCapture(raw, abort.current.signal);
      setTagsText(p.tags.join(', '));
      setPlan(p);
    } catch (e) {
      if (!abort.current.signal.aborted) setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      await saveCapture({
        ...plan,
        tags: tagsText
          .split(',')
          .map((t) => t.trim().replace(/^#/, ''))
          .filter(Boolean),
      });
      closeAonDialog();
    } catch (e) {
      toastError('Unable to save the document.', e);
      setBusy(false);
    }
  };
  const tooLong = raw.length > MAX_CAPTURE_CHARS;

  return (
    <Dialog
      title="Capture with AON"
      size="lg"
      onClose={closeAonDialog}
      initialFocus={input}
      description="Paste or drop anything messy: an email, meeting notes, a list. AON turns it into a clean document, picks a folder and tags, and you check it before it is saved."
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={closeAonDialog}>
            Cancel
          </button>
          {plan ? (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setPlan(null)}>
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !plan.markdown.trim()}
                onClick={() => void save()}
              >
                Save document
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || noKey || !raw.trim()}
              onClick={() => void organize()}
            >
              {busy ? 'Working…' : 'Organize with AON'}
            </button>
          )}
        </>
      }
    >
      {noKey && <NeedsKey />}
      {!plan ? (
        <div className="flex flex-col gap-2">
          <textarea
            ref={input}
            className="input min-h-[220px] resize-y py-2"
            aria-label="Text to capture"
            placeholder="Paste text here…"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3 text-caption text-steel">
            <label className="btn btn-secondary cursor-pointer">
              Add a file
              <input
                type="file"
                className="sr-only"
                accept=".txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.rtf,.log,.pptx,.odt,.ods,.odp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f)
                    void fileText(f)
                      .then((t) => setRaw((r) => (r ? r + '\n\n' : '') + t))
                      .catch((err) => setError(message(err)));
                }}
              />
            </label>
            <span>{raw.length.toLocaleString()} characters</span>
            {tooLong && (
              <span className="text-danger">
                Only the first {MAX_CAPTURE_CHARS.toLocaleString()} characters are used.
              </span>
            )}
          </div>
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-caption text-steel">
            Title
            <input
              className="input"
              value={plan.title}
              onChange={(e) => setPlan({ ...plan, title: e.target.value })}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-caption text-steel">
              Folder (empty is the top level)
              <input
                className="input"
                list="aon-folders"
                value={plan.folder}
                onChange={(e) => setPlan({ ...plan, folder: e.target.value })}
              />
              <datalist id="aon-folders">
                {tree
                  ?.liveEntries()
                  .filter((e) => e.kind === 'folder')
                  .map((f) => (
                    <option key={f.id} value={tree.pathOf(f.id)} />
                  ))}
              </datalist>
            </label>
            <label className="flex flex-col gap-1 text-caption text-steel">
              Tags (separated by commas)
              <input
                className="input"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-caption text-steel">
            Document
            <textarea
              className="input min-h-[240px] resize-y py-2 font-mono text-[13px]"
              value={plan.markdown}
              onChange={(e) => setPlan({ ...plan, markdown: e.target.value })}
            />
          </label>
        </div>
      )}
    </Dialog>
  );
}
