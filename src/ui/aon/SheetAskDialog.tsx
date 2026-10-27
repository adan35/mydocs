import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { aiSource } from '@/app/ai';
import { navigate } from '@/app/router';
import { askSheet, type SheetAnswer, type SheetContext, type SheetEdit } from '@/app/aon/sheet';
import { addr } from '@/lib/convert/workbook';
import { MicButton } from './MicButton';

const IDEAS = [
  'Explain the formulas in the selected cells',
  'Write a formula that ',
  'Clean up the selected column',
  'Categorize each row in a new column',
];

const SHOWN = 40;

/** "Ask AON" for a sheet: AON answers and proposes cell changes; nothing is written until Apply. */
export function SheetAskDialog({
  ctx,
  allowed,
  canApply,
  onApply,
  onClose,
}: {
  ctx: SheetContext;
  /** False when the document sits in a folder that AON stays out of. */
  allowed: boolean;
  canApply: boolean;
  onApply(edits: SheetEdit[]): void;
  onClose(): void;
}) {
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SheetAnswer | null>(null);
  const [error, setError] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const abort = useRef<AbortController | null>(null);
  const source = aiSource();
  const setup = source === 'none' || source === 'sign-in';
  useEffect(() => () => abort.current?.abort(), []);

  const ask = async () => {
    if (!request.trim() || busy) return;
    abort.current = new AbortController();
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setResult(await askSheet(request, ctx, abort.current.signal));
    } catch (e) {
      if (!abort.current.signal.aborted)
        setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const edits = result?.edits ?? [];
  const before = (e: SheetEdit) =>
    e.r < ctx.rowCount && e.c < ctx.colCount ? ctx.cell(e.r, e.c) : '';
  const footer = (
    <>
      <button type="button" className="btn btn-secondary" onClick={onClose}>
        {edits.length && canApply ? 'Cancel' : 'Close'}
      </button>
      <button
        type="button"
        className={`btn ${edits.length && canApply ? 'btn-secondary' : 'btn-primary'}`}
        disabled={!request.trim() || busy || setup || !allowed}
        onClick={() => void ask()}
      >
        {busy ? 'Working…' : result ? 'Ask again' : 'Ask'}
      </button>
      {edits.length > 0 && canApply && (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            onApply(edits);
            onClose();
          }}
        >
          Apply {edits.length} change{edits.length === 1 ? '' : 's'}
        </button>
      )}
    </>
  );

  return (
    <Dialog
      title="Ask AON about this sheet"
      size="lg"
      onClose={onClose}
      initialFocus={input}
      description={`AON sees the first ${Math.min(ctx.rowCount, 120)} rows (or your selection) of "${ctx.name}". It explains, or proposes changes that you check before they are written.`}
      footer={footer}
    >
      {!allowed ? (
        <p className="rounded-lg border border-hairline bg-surface p-3 text-caption text-steel">
          This document is in a folder that AON stays out of.
        </p>
      ) : setup ? (
        <p className="rounded-lg border border-hairline bg-surface p-3 text-caption text-steel">
          AON needs an API key or a local model.{' '}
          <button
            type="button"
            className="font-medium text-primary underline"
            onClick={() => {
              onClose();
              navigate({ name: 'settings' });
            }}
          >
            Open settings
          </button>
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {IDEAS.map((idea) => (
              <button
                key={idea}
                type="button"
                className="rounded-md border border-hairline px-2.5 py-1 text-caption text-charcoal hover:bg-hover"
                onClick={() => {
                  setRequest(idea);
                  input.current?.focus();
                }}
              >
                {idea.trim()}
                {idea.endsWith(' ') ? '…' : ''}
              </button>
            ))}
          </div>
          <div className="flex items-start gap-2">
            <textarea
              ref={input}
              className="input min-h-[64px] flex-1 resize-none py-2"
              aria-label="What should AON do?"
              placeholder="What should AON do with this sheet?"
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void ask();
                }
              }}
            />
            <MicButton onText={(t) => setRequest((r) => (r ? `${r} ${t}` : t))} />
          </div>
          {error && (
            <p role="alert" className="text-caption text-danger">
              {error}
            </p>
          )}
          {result && (
            <div className="flex flex-col gap-2" data-testid="sheet-ask-result">
              {result.answer && <p className="whitespace-pre-wrap text-ink">{result.answer}</p>}
              {edits.length > 0 ? (
                <ul className="divide-y divide-hairline-soft rounded-lg border border-hairline text-caption">
                  {edits.slice(0, SHOWN).map((e) => (
                    <li key={`${e.r}:${e.c}`} className="flex items-baseline gap-2 px-3 py-1.5">
                      <span className="w-12 shrink-0 font-medium text-charcoal">
                        {addr(e.r, e.c)}
                      </span>
                      <span className="min-w-0 flex-1 break-words text-steel">
                        {before(e) ? <s>{before(e)}</s> : <i>empty</i>}
                        {' → '}
                        <span className="text-ink">{e.value || <i>empty</i>}</span>
                      </span>
                    </li>
                  ))}
                  {edits.length > SHOWN && (
                    <li className="px-3 py-1.5 text-steel">and {edits.length - SHOWN} more</li>
                  )}
                </ul>
              ) : (
                <p className="text-caption text-steel">No cells would change.</p>
              )}
              {result.skipped > 0 && (
                <p className="text-caption text-steel">
                  {result.skipped} proposed change{result.skipped === 1 ? ' was' : 's were'} left
                  out: outside the rows AON can see, or not allowed in this file.
                </p>
              )}
              {edits.length > 0 && !canApply && (
                <p className="text-caption text-steel">
                  This workbook is open for viewing only, so the changes cannot be applied.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
