import { useEffect, useMemo, useState } from 'react';
import { History } from 'lucide-react';
import type { EntryId, Version } from '@/domain/types';
import { diffLines, summarizeChange, type ChangeSummary, type DiffLine } from '@/domain/diff';
import { formatBytes } from '@/domain/names';
import { ws } from '@/app/app-store';
import { restoreVersion } from '@/app/actions';
import { useEditor } from '@/app/editor-store';
import { Dialog } from '../components/Dialog';
import { relativeTime } from '../hooks';

const REASON: Record<Version['reason'], string> = {
  edit: '',
  restore: 'Before restore',
  recovery: 'Before recovery',
  import: 'Before import',
  manual: 'Saved',
};

const HEAD = 'current';
/** Unchanged lines kept around each change, like `git diff`. */
const CONTEXT = 3;

interface Commit {
  id: string;
  at: number;
  text: string;
  blob?: Blob;
  reason?: Version['reason'];
  /** The change this commit made to the one before it (none for file copies). */
  change?: ChangeSummary;
}

type Row = DiffLine | { type: 'gap'; count: number };

/** Long unchanged runs fold into "⋯ N unchanged lines". */
function hunks(diff: DiffLine[]): Row[] {
  const keep = diff.map(() => false);
  diff.forEach((d, i) => {
    if (d.type === 'same') return;
    for (let j = Math.max(0, i - CONTEXT); j <= Math.min(diff.length - 1, i + CONTEXT); j++)
      keep[j] = true;
  });
  const rows: Row[] = [];
  diff.forEach((d, i) => {
    if (keep[i]) rows.push(d);
    else if (rows.at(-1)?.type === 'gap') (rows.at(-1) as { count: number }).count++;
    else rows.push({ type: 'gap', count: 1 });
  });
  return rows;
}

/** Version history as a commit log: newest first, each with what it changed. */
export function HistoryDialog({ entryId, onClose }: { entryId: EntryId; onClose(): void }) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const current = useEditor((s) => s.buffers[entryId]?.text) ?? ws().allTexts().get(entryId) ?? '';
  const entry = ws().get(entryId);

  useEffect(() => {
    ws()
      .listVersions(entryId)
      .then((v) => {
        setVersions(v);
        setSelected(v[0]?.id ?? null);
      })
      .catch(() => setError(true));
  }, [entryId]);

  const commits = useMemo<Commit[]>(() => {
    if (!versions) return [];
    const binary = versions.some((v) => v.blob);
    const list: Commit[] = [
      { id: HEAD, at: entry?.updatedAt ?? Date.now(), text: binary ? '' : current },
      ...versions.map((v) => ({
        id: v.id,
        at: v.createdAt,
        text: v.text,
        blob: v.blob,
        reason: v.reason,
      })),
    ];
    list.forEach((c, i) => {
      const parent = list[i + 1];
      if (binary) return;
      c.change = summarizeChange(parent?.text ?? '', c.text);
      // The oldest version kept may not be how the document started.
      if (!parent) c.change.message = 'Earliest saved version';
    });
    return list;
  }, [versions, current, entry?.updatedAt]);

  const index = commits.findIndex((c) => c.id === selected);
  const commit = commits[index];
  const isHead = commit?.id === HEAD;
  const comparing = compare && !isHead;
  const diff = useMemo(() => {
    if (!commit || commit.blob || (!commit.change && !comparing)) return [];
    return comparing
      ? diffLines(commit.text, current)
      : diffLines(commits[index + 1]?.text ?? '', commit.text);
  }, [commit, comparing, current, commits, index]);
  const rows = useMemo(() => hunks(diff), [diff]);
  const changes = diff.filter((d) => d.type !== 'same').length;

  return (
    <Dialog
      title="Version history"
      description={<span className="break-all">{entry?.name ?? ''}</span>}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!commit || isHead}
            title={isHead ? 'This is the current version' : undefined}
            onClick={async () => {
              if (!commit || isHead) return;
              await restoreVersion(entryId, commit.id);
              onClose();
            }}
          >
            Restore this version
          </button>
        </>
      }
    >
      {error && <p className="py-6 text-center text-slate">Version history could not be loaded.</p>}
      {!error && versions === null && <div className="skeleton h-40 w-full" />}
      {versions?.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <History className="text-stone" size={28} aria-hidden />
          <p className="font-medium text-ink">No earlier versions yet</p>
          <p className="max-w-sm text-caption text-steel">
            My Doc records a version when you start editing again after a couple of minutes, and
            before every restore or import.
          </p>
        </div>
      )}
      {!!versions?.length && (
        <div className="flex min-h-[340px] flex-col gap-4 pb-2 sm:flex-row">
          <ol
            className="history-log max-h-[30vh] shrink-0 overflow-y-auto sm:max-h-[58vh] sm:w-64"
            aria-label="Versions"
          >
            {commits.map((c) => (
              <li key={c.id} className="history-commit" data-head={c.id === HEAD || undefined}>
                <button
                  type="button"
                  className="history-commit-btn"
                  data-active={c.id === selected}
                  aria-pressed={c.id === selected}
                  onClick={() => setSelected(c.id)}
                >
                  <span className="block truncate text-[13px] font-medium text-ink">
                    {c.id === HEAD
                      ? 'Current version'
                      : c.blob
                        ? `File copy · ${formatBytes(c.blob.size)}`
                        : c.change!.message}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-steel">
                    {c.id === HEAD ? (
                      <span className="history-badge">Now</span>
                    ) : (
                      <span className="font-mono text-[11px] text-stone">{c.id.slice(0, 7)}</span>
                    )}
                    <span title={new Date(c.at).toLocaleString()}>{relativeTime(c.at)}</span>
                    {c.reason && REASON[c.reason] && <span>· {REASON[c.reason]}</span>}
                    {c.change && (c.change.added > 0 || c.change.removed > 0) && (
                      <span className="ml-auto shrink-0 font-mono text-[11px]">
                        <span className="text-success">+{c.change.added}</span>{' '}
                        <span className="text-danger">−{c.change.removed}</span>
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {commit && (
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-ink">
                    {isHead
                      ? 'Current version'
                      : commit.blob
                        ? 'File copy'
                        : commit.change!.message}
                  </p>
                  <p className="text-xs text-steel">{new Date(commit.at).toLocaleString()}</p>
                </div>
                {!isHead && !commit.blob && (
                  <div role="group" aria-label="Show" className="flex rounded-md bg-surface p-0.5">
                    {[
                      [false, 'Changes'],
                      [true, 'Compare with now'],
                    ].map(([value, label]) => (
                      <button
                        key={String(value)}
                        type="button"
                        aria-pressed={compare === value}
                        className={`h-7 rounded px-2 text-xs font-medium ${compare === value ? 'bg-canvas text-ink shadow-[var(--shadow-1)]' : 'text-steel hover:text-ink'}`}
                        onClick={() => setCompare(value as boolean)}
                      >
                        {label as string}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {commit.blob ? (
                <p className="text-caption text-steel">
                  A saved copy of the whole file ({formatBytes(commit.blob.size)}). Restoring it
                  replaces the current file; the current file is kept as a version too.
                </p>
              ) : (
                <>
                  <p className="mb-2 text-caption text-steel">
                    {comparing
                      ? changes
                        ? `${changes} changed line${changes === 1 ? '' : 's'} between this version and now.`
                        : 'Identical to the current text.'
                      : changes
                        ? `${changes} changed line${changes === 1 ? '' : 's'} in this version.`
                        : 'No text changes in this version.'}
                  </p>
                  <pre className="max-h-[50vh] overflow-auto rounded-md border border-hairline bg-surface-soft py-2 font-mono text-[12.5px] leading-relaxed">
                    {rows.map((d, i) =>
                      d.type === 'gap' ? (
                        <div key={i} className="history-gap">
                          ⋯ {d.count} unchanged line{d.count === 1 ? '' : 's'}
                        </div>
                      ) : (
                        <div key={i} className="px-3" data-diff={d.type}>
                          <span
                            className="mr-2 inline-block w-3 select-none text-stone"
                            aria-hidden
                          >
                            {d.type === 'add' ? '+' : d.type === 'del' ? '−' : ' '}
                          </span>
                          {d.text || ' '}
                        </div>
                      ),
                    )}
                  </pre>
                  <p className="mt-2 text-xs text-stone">
                    {comparing
                      ? 'Red lines exist only in this version; green lines exist only in the current text.'
                      : 'Red lines were removed and green lines were added in this version.'}
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
