import { useEffect, useMemo, useState } from 'react';
import { History } from 'lucide-react';
import type { EntryId, Version } from '@/domain/types';
import { diffLines } from '@/domain/diff';
import { formatBytes } from '@/domain/names';
import { ws } from '@/app/app-store';
import { restoreVersion } from '@/app/actions';
import { useEditor } from '@/app/editor-store';
import { Dialog } from '../components/Dialog';
import { relativeTime } from '../hooks';

const REASON: Record<Version['reason'], string> = {
  edit: 'Before editing',
  restore: 'Before restoring',
  recovery: 'Before recovery',
  import: 'Before import',
  manual: 'Saved',
};

export function HistoryDialog({ entryId, onClose }: { entryId: EntryId; onClose(): void }) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const current = useEditor((s) => s.buffers[entryId]?.text) ?? ws().allTexts().get(entryId) ?? '';
  const name = ws().get(entryId)?.name ?? '';

  useEffect(() => {
    ws()
      .listVersions(entryId)
      .then((v) => {
        setVersions(v);
        setSelected(v[0]?.id ?? null);
      })
      .catch(() => setError(true));
  }, [entryId]);

  const version = versions?.find((v) => v.id === selected);
  const diff = useMemo(
    () => (version && !version.blob ? diffLines(version.text, current) : []),
    [version, current],
  );
  const changes = diff.filter((d) => d.type !== 'same').length;

  return (
    <Dialog
      title="Version history"
      description={<span className="break-all">{name}</span>}
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
            disabled={!version}
            onClick={async () => {
              if (!version) return;
              await restoreVersion(entryId, version.id);
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
            My Doc keeps a snapshot of the previous text when you start editing again after a few
            minutes, and before every restore or import.
          </p>
        </div>
      )}
      {!!versions?.length && (
        <div className="flex min-h-[320px] flex-col gap-3 pb-2 sm:flex-row">
          <ul
            className="flex shrink-0 gap-1 overflow-x-auto sm:max-h-[55vh] sm:w-52 sm:flex-col sm:overflow-y-auto"
            aria-label="Versions"
          >
            {versions.map((v) => (
              <li key={v.id} className="shrink-0">
                <button
                  type="button"
                  className="menu-item flex-col !items-start !gap-0"
                  data-active={v.id === selected}
                  aria-pressed={v.id === selected}
                  onClick={() => setSelected(v.id)}
                >
                  <span className="text-ink">{relativeTime(v.createdAt)}</span>
                  <span className="text-xs text-steel">
                    {new Date(v.createdAt).toLocaleString()} · {REASON[v.reason]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {version?.blob ? (
            <div className="min-w-0 flex-1">
              <p className="text-caption text-steel">
                A saved copy of the whole file ({formatBytes(version.blob.size)}). Restoring it
                replaces the current file; the current file is kept as a version too.
              </p>
            </div>
          ) : (
            <div className="min-w-0 flex-1">
              <p className="mb-2 text-caption text-steel">
                {changes
                  ? `${changes} changed line${changes === 1 ? '' : 's'} compared with the current text.`
                  : 'Identical to the current text.'}
              </p>
              <pre className="max-h-[50vh] overflow-auto rounded-md border border-hairline bg-surface-soft p-3 font-mono text-[12.5px] leading-relaxed">
                {diff.map((d, i) => (
                  <div
                    key={i}
                    className={
                      d.type === 'add'
                        ? 'bg-[color-mix(in_srgb,var(--success)_14%,transparent)]'
                        : d.type === 'del'
                          ? 'bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] line-through decoration-[color-mix(in_srgb,var(--danger)_50%,transparent)]'
                          : ''
                    }
                  >
                    <span className="mr-2 inline-block w-3 select-none text-stone" aria-hidden>
                      {d.type === 'add' ? '+' : d.type === 'del' ? '−' : ' '}
                    </span>
                    {d.text || ' '}
                  </div>
                ))}
              </pre>
              <p className="mt-2 text-xs text-stone">
                Red lines exist only in the selected version; green lines exist only in the current
                text.
              </p>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
