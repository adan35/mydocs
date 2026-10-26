import { useCallback, useEffect, useState } from 'react';
import { fetchHistory, useShares, type SharedHistory } from '@/app/share';
import type { EntryId } from '@/domain/types';
import { Dialog } from '../components/Dialog';
import { relativeTime } from '../hooks';

const COLORS = ['#5645d4', '#1f8a5b', '#c2570c', '#b83280', '#0b7285', '#7048e8', '#a61e4d'];
const colorOf = (i: number) => COLORS[i % COLORS.length]!;
const when = (t: number) => new Date(t).toLocaleString();
const SHOWN = 8;

function Who({ h, a }: { h: SharedHistory; a: number }) {
  const author = h.authors[a];
  return (
    <span className="inline-flex items-center gap-1.5 font-medium text-ink" title={author?.email}>
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ background: colorOf(a) }}
      />
      {author?.name ?? 'Unknown'}
    </span>
  );
}

/** Who changed a shared document, and which person last wrote each line. */
export function SharedHistoryDialog({ entryId, onClose }: { entryId: EntryId; onClose(): void }) {
  const binding = useShares((s) => s.bindings[entryId]);
  const [h, setH] = useState<SharedHistory | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'changes' | 'lines'>('changes');
  const [open, setOpen] = useState<Record<number, boolean>>({});

  const load = useCallback(() => {
    if (!binding) return;
    setError('');
    fetchHistory(binding).then(setH, (e: Error) => setError(e.message));
  }, [binding]);
  useEffect(load, [load]);

  return (
    <Dialog title="Shared history" onClose={onClose} size="lg">
      {!binding ? (
        <p className="text-[14px] text-steel">This document is not shared.</p>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2">
            <div role="tablist" className="flex rounded-md bg-surface p-0.5">
              {(
                [
                  ['changes', 'Changes'],
                  ['lines', 'Line by line'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  className={`tap h-7 rounded-[5px] px-3 text-caption font-medium ${tab === id ? 'bg-canvas text-ink shadow-1' : 'text-steel hover:text-ink'}`}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-ghost ml-auto h-8 text-steel" onClick={load}>
              Refresh
            </button>
          </div>
          {error && (
            <p role="alert" className="text-[14px] text-danger">
              {error}
            </p>
          )}
          {!h && !error && <p className="text-[14px] text-steel">Loading…</p>}
          {h && tab === 'changes' && (
            <ol className="divide-y divide-hairline-soft">
              {!h.sessions.length && <li className="py-3 text-[14px] text-steel">No edits yet.</li>}
              {h.sessions.map((s, i) => {
                const expanded = open[i] || s.lines.length <= SHOWN;
                return (
                  <li key={i} className="py-3">
                    <div className="flex flex-wrap items-baseline gap-x-2 text-[14px]">
                      <Who h={h} a={s.a} />
                      <span
                        className="text-caption text-steel"
                        title={`${when(s.start)} to ${when(s.end)}`}
                      >
                        {relativeTime(s.end)} · {s.edits} {s.edits === 1 ? 'edit' : 'edits'}
                      </span>
                    </div>
                    {s.lines.length === 0 ? (
                      <p className="mt-1 text-caption text-steel">No net change to the text.</p>
                    ) : (
                      <div className="mt-1.5 overflow-x-auto rounded-md border border-hairline-soft font-mono text-[12.5px] leading-relaxed">
                        {(expanded ? s.lines : s.lines.slice(0, SHOWN)).map((l, j) => (
                          <div
                            key={j}
                            className="flex gap-2 whitespace-pre px-2"
                            style={{
                              background: `color-mix(in srgb, var(--${l.type === 'add' ? 'success' : 'danger'}) 12%, transparent)`,
                            }}
                          >
                            <span
                              aria-label={l.type === 'add' ? 'Added' : 'Removed'}
                              className="select-none"
                            >
                              {l.type === 'add' ? '+' : '−'}
                            </span>
                            <span>{l.text || ' '}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {!expanded && (
                      <button
                        type="button"
                        className="mt-1 text-caption text-steel underline"
                        onClick={() => setOpen((o) => ({ ...o, [i]: true }))}
                      >
                        Show {s.lines.length - SHOWN} more lines
                      </button>
                    )}
                    {expanded && s.truncated && (
                      <p className="mt-1 text-caption text-steel">
                        Only the first lines are shown.
                      </p>
                    )}
                  </li>
                );
              })}
              {h.older > 0 && (
                <li className="py-3 text-caption text-steel">
                  {h.older} earlier changes are not listed.
                </li>
              )}
            </ol>
          )}
          {h && tab === 'lines' && (
            <div className="overflow-x-auto rounded-md border border-hairline-soft font-mono text-[12.5px] leading-relaxed">
              {h.blame.map((l, i) => {
                const first = i === 0 || h.blame[i - 1]!.a !== l.a || h.blame[i - 1]!.t !== l.t;
                return (
                  <div
                    key={i}
                    className={`flex gap-3 px-2 ${first && i ? 'border-t border-hairline-soft' : ''}`}
                  >
                    <span
                      className="w-40 shrink-0 truncate font-sans text-caption text-steel"
                      title={l.t ? when(l.t) : ''}
                    >
                      {first && l.t ? (
                        <>
                          <Who h={h} a={l.a} /> · {relativeTime(l.t)}
                        </>
                      ) : null}
                    </span>
                    <span className="whitespace-pre">{l.text || ' '}</span>
                  </div>
                );
              })}
              {h.blameTruncated && (
                <p className="px-2 py-1 font-sans text-caption text-steel">
                  Only the first lines are shown.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
