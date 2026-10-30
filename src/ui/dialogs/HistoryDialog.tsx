import { useEffect, useMemo, useState } from 'react';
import { Copy, Download, History, Maximize2, Minimize2, Search } from 'lucide-react';
import type { EntryId, Version } from '@/domain/types';
import {
  diffLines,
  hunks,
  pairRows,
  summarizeChange,
  type ChangeSummary,
  type DiffLine,
} from '@/domain/diff';
import { formatBytes, isMarkdownName } from '@/domain/names';
import { ws } from '@/app/app-store';
import { restoreVersion } from '@/app/actions';
import { downloadBlob } from '@/app/exporter';
import { toast } from '@/app/toast-store';
import { useEditor } from '@/app/editor-store';
import { Dialog } from '../components/Dialog';
import { StaticMarkdown } from '../convert/StaticMarkdown';
import { relativeTime, useMediaQuery } from '../hooks';

const REASON: Record<Version['reason'], string> = {
  edit: '',
  restore: 'Before restore',
  recovery: 'Before recovery',
  import: 'Before import',
  manual: 'Saved',
};

const HEAD = 'current';
const PREV = 'prev';

type View = 'diff' | 'source' | 'preview';

interface Commit {
  id: string;
  at: number;
  text: string;
  blob?: Blob;
  reason?: Version['reason'];
  /** The change this commit made to the one before it (none for file copies). */
  change?: ChangeSummary;
}

const title = (c: Commit) =>
  c.id === HEAD
    ? 'Current version'
    : c.blob
      ? `File copy · ${formatBytes(c.blob.size)}`
      : c.change!.message;

/** A small pill group for choosing one of a few values. */
function Seg<T extends string | boolean>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange(v: T): void;
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-md bg-surface p-0.5">
      {options.map(([v, text]) => (
        <button
          key={String(v)}
          type="button"
          aria-pressed={value === v}
          className={`h-7 rounded px-2 text-xs font-medium ${value === v ? 'bg-canvas text-ink shadow-[var(--shadow-1)]' : 'text-steel hover:text-ink'}`}
          onClick={() => onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** Version history as a commit log: newest first, each with what it changed. */
export function HistoryDialog({ entryId, onClose }: { entryId: EntryId; onClose(): void }) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [query, setQuery] = useState('');
  /** What the selected version is compared with: the one before it, or any other. */
  const [against, setAgainst] = useState(PREV);
  const [view, setView] = useState<View>('diff');
  const [split, setSplit] = useState(false);
  const [whole, setWhole] = useState(false);
  const wide = useMediaQuery('(min-width: 640px)');
  const current = useEditor((s) => s.buffers[entryId]?.text) ?? ws().allTexts().get(entryId) ?? '';
  const entry = ws().get(entryId);
  const markdown = isMarkdownName(entry?.name ?? '');

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

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commits;
    return commits.filter((c) =>
      [title(c), c.id === HEAD ? 'now' : c.id, c.reason ? REASON[c.reason] : '']
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [commits, query]);

  const index = commits.findIndex((c) => c.id === selected);
  const commit = commits[index];
  const isHead = commit?.id === HEAD;
  const other = against === commit?.id ? undefined : commits.find((c) => c.id === against);
  /** The older and newer side of the diff being shown. */
  const [older, newer] = useMemo<[Commit | undefined, Commit | undefined]>(() => {
    if (!commit) return [undefined, undefined];
    if (!other) return [commits[index + 1], commit];
    return commits.indexOf(other) > index ? [other, commit] : [commit, other];
  }, [commit, other, commits, index]);
  const diff = useMemo(() => {
    if (!commit || commit.blob || !newer) return [];
    return diffLines(older?.text ?? '', newer.text);
  }, [commit, older, newer]);
  const rows = useMemo(() => (whole ? diff : hunks(diff)), [diff, whole]);
  const splitRows = useMemo(() => (split && wide ? pairRows(rows) : null), [rows, split, wide]);
  const changes = diff.filter((d) => d.type !== 'same').length;
  const name = (c?: Commit) => (!c ? 'the start' : c.id === HEAD ? 'now' : c.id.slice(0, 7));
  const plural = `${changes} changed line${changes === 1 ? '' : 's'}`;
  const tall = maximized
    ? 'max-h-[calc(100dvh-17rem)] sm:max-h-[calc(100dvh-15rem)]'
    : 'max-h-[50vh]';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(commit!.text);
      toast({ message: 'Version copied' });
    } catch {
      toast({ message: 'Could not copy' });
    }
  };
  const download = () =>
    void downloadBlob(
      commit!.blob ?? new Blob([commit!.text], { type: 'text/plain' }),
      (entry?.name ?? 'document').replace(
        /(\.[^.]+)?$/,
        `-${isHead ? 'current' : commit!.id.slice(0, 7)}$1`,
      ),
    );

  return (
    <Dialog
      title="Version history"
      description={<span className="break-all">{entry?.name ?? ''}</span>}
      onClose={onClose}
      size="lg"
      fullscreen={maximized}
      actions={
        <button
          type="button"
          className="icon-btn -mt-1"
          aria-label={maximized ? 'Restore size' : 'Maximize'}
          title={maximized ? 'Restore size' : 'Maximize'}
          onClick={() => setMaximized(!maximized)}
        >
          {maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      }
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
        <div
          className={`flex flex-col gap-4 pb-2 sm:flex-row ${maximized ? 'h-full' : 'min-h-[340px]'}`}
        >
          <div className="flex shrink-0 flex-col gap-2 sm:w-64">
            <label className="relative block">
              <Search
                size={14}
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-stone"
                aria-hidden
              />
              <input
                type="search"
                className="input h-8 w-full pl-8 text-[13px]"
                placeholder="Filter versions"
                aria-label="Filter versions"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <ol
              className={`history-log min-h-0 overflow-y-auto ${maximized ? 'max-h-[30vh] sm:max-h-none sm:flex-1' : 'max-h-[30vh] sm:max-h-[58vh]'}`}
              aria-label="Versions"
            >
              {shown.map((c) => (
                <li key={c.id} className="history-commit" data-head={c.id === HEAD || undefined}>
                  <button
                    type="button"
                    className="history-commit-btn"
                    data-active={c.id === selected}
                    aria-pressed={c.id === selected}
                    onClick={() => setSelected(c.id)}
                  >
                    <span className="block truncate text-[13px] font-medium text-ink">
                      {title(c)}
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
              {!shown.length && <li className="px-2 py-3 text-caption text-steel">No match.</li>}
            </ol>
          </div>
          {commit && (
            <div className={`flex min-w-0 flex-1 flex-col ${maximized ? 'min-h-0' : ''}`}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-ink">{title(commit)}</p>
                  <p className="text-xs text-steel">{new Date(commit.at).toLocaleString()}</p>
                </div>
                {!commit.blob && (
                  <button
                    type="button"
                    className="btn btn-secondary h-7 px-2 text-xs"
                    onClick={copy}
                  >
                    <Copy size={13} aria-hidden /> Copy
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-secondary h-7 px-2 text-xs"
                  onClick={download}
                >
                  <Download size={13} aria-hidden /> Download
                </button>
              </div>
              {commit.blob ? (
                <p className="text-caption text-steel">
                  A saved copy of the whole file ({formatBytes(commit.blob.size)}). Restoring it
                  replaces the current file; the current file is kept as a version too.
                </p>
              ) : (
                <>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Seg<View>
                      label="View"
                      value={view}
                      onChange={setView}
                      options={[
                        ['diff', 'Changes'],
                        ['source', 'Source'],
                        ...(markdown ? ([['preview', 'Preview']] as [View, string][]) : []),
                      ]}
                    />
                    {view === 'diff' && (
                      <>
                        <label className="flex items-center gap-1.5 text-xs whitespace-nowrap text-steel">
                          Compare with
                          <select
                            className="input h-7 max-w-44 py-0 text-xs"
                            value={other ? other.id : PREV}
                            onChange={(e) => setAgainst(e.target.value)}
                          >
                            <option value={PREV}>Previous version</option>
                            {commits
                              .filter((c) => c.id !== commit.id)
                              .map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.id === HEAD
                                    ? 'Current version'
                                    : `${title(c)} · ${c.id.slice(0, 7)}`}
                                </option>
                              ))}
                          </select>
                        </label>
                        {wide && (
                          <Seg<boolean>
                            label="Layout"
                            value={split}
                            onChange={setSplit}
                            options={[
                              [false, 'Inline'],
                              [true, 'Side by side'],
                            ]}
                          />
                        )}
                        <Seg<boolean>
                          label="Lines"
                          value={whole}
                          onChange={setWhole}
                          options={[
                            [false, 'Changed only'],
                            [true, 'Whole document'],
                          ]}
                        />
                      </>
                    )}
                  </div>
                  {view === 'diff' && (
                    <>
                      <p className="mb-2 text-caption text-steel">
                        {!other
                          ? changes
                            ? `${plural} in this version.`
                            : 'No text changes in this version.'
                          : changes
                            ? `${plural} between ${name(older)} and ${name(newer)}.`
                            : `${name(older)} and ${name(newer)} are identical.`}
                      </p>
                      <pre
                        className={`${tall} min-h-0 overflow-auto rounded-md border border-hairline bg-surface-soft py-2 font-mono text-[12.5px] leading-relaxed ${maximized ? 'flex-1' : ''}`}
                      >
                        {(splitRows ?? rows).map((d, i) =>
                          'type' in d && d.type === 'gap' ? (
                            <div key={i} className="history-gap">
                              ⋯ {d.count} unchanged line{d.count === 1 ? '' : 's'}
                            </div>
                          ) : splitRows ? (
                            <div key={i} className="grid grid-cols-2 divide-x divide-hairline">
                              {[
                                (d as { left?: DiffLine }).left,
                                (d as { right?: DiffLine }).right,
                              ].map((side, k) => (
                                <div
                                  key={k}
                                  className="min-w-0 px-3 break-words whitespace-pre-wrap"
                                  data-diff={side && side.type !== 'same' ? side.type : undefined}
                                >
                                  {side?.text || ' '}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div key={i} className="px-3" data-diff={(d as DiffLine).type}>
                              <span
                                className="mr-2 inline-block w-3 select-none text-stone"
                                aria-hidden
                              >
                                {(d as DiffLine).type === 'add'
                                  ? '+'
                                  : (d as DiffLine).type === 'del'
                                    ? '−'
                                    : ' '}
                              </span>
                              {(d as DiffLine).text || ' '}
                            </div>
                          ),
                        )}
                      </pre>
                      <p className="mt-2 text-xs text-stone">
                        {other
                          ? `Red lines exist only in ${name(older)}; green lines exist only in ${name(newer)}.`
                          : 'Red lines were removed and green lines were added in this version.'}
                      </p>
                    </>
                  )}
                  {view === 'source' && (
                    <pre
                      className={`${tall} min-h-0 overflow-auto rounded-md border border-hairline bg-surface-soft px-3 py-2 font-mono text-[12.5px] leading-relaxed ${maximized ? 'flex-1' : ''}`}
                    >
                      {commit.text}
                    </pre>
                  )}
                  {view === 'preview' && (
                    <div
                      className={`${tall} min-h-0 overflow-auto rounded-md border border-hairline px-4 py-2 ${maximized ? 'flex-1' : ''}`}
                    >
                      <StaticMarkdown text={commit.text} />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
