import { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  HardDrive,
  HardDriveDownload,
  HardDriveUpload,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { openMenuAt } from '../components/Menu';
import { useEditor } from '@/app/editor-store';
import { editorActions } from '@/app/editor-store';
import { diskLinks, useDiskLinks } from '@/app/disk-links';
import { ws } from '@/app/app-store';
import type { EntryId } from '@/domain/types';
import { useOnline } from '../hooks';

/** Always tells the user what is happening to their data. */
export function SaveStatus({ id }: { id: EntryId }) {
  const status = useEditor((s) => s.buffers[id]?.status);
  const error = useEditor((s) => s.buffers[id]?.error);
  const online = useOnline();
  if (!status || status === 'loading' || status === 'load-error') return null;
  const label =
    status === 'error'
      ? 'Not saved'
      : status === 'saving'
        ? 'Saving…'
        : status === 'unsaved'
          ? 'Unsaved'
          : 'Saved';
  const tone =
    status === 'error'
      ? 'danger'
      : status === 'unsaved'
        ? 'warning'
        : status === 'saved'
          ? 'success'
          : undefined;
  const title =
    status === 'error'
      ? `${error ?? 'Unable to save.'} Keep this document open, retry, or export your changes.`
      : status === 'saved'
        ? `${online ? '' : 'Offline: '}Saved on this device. Export a backup for another copy.`
        : status === 'saving'
          ? 'Saving your changes on this device…'
          : 'Your latest changes have not been saved yet.';
  return (
    <span role="status" aria-live="polite" className="flex shrink-0" title={title}>
      {status === 'error' ? (
        <button
          type="button"
          className="status-pill"
          data-tone={tone}
          onClick={() => void editorActions.flush(id)}
        >
          <AlertCircle size={13} aria-hidden /> {label} · Retry
        </button>
      ) : (
        <span className="status-pill" data-tone={tone}>
          {status === 'saving' ? (
            <Loader2 size={13} className="animate-spin" aria-hidden />
          ) : status === 'saved' ? (
            <Check size={13} strokeWidth={2.5} aria-hidden />
          ) : (
            <span className="status-dot" aria-hidden />
          )}
          <span>{label}</span>
        </span>
      )}
    </span>
  );
}

/** For documents imported from the user's computer: is the original file up to date? */
export function DiskStatus({ id }: { id: EntryId }) {
  const link = useDiskLinks((s) => s.links[id]);
  const [fresh, setFresh] = useState(false);
  const refreshedAt = link?.refreshedAt;
  // "Updated from disk" shows for a moment after the file changed on disk.
  useEffect(() => {
    if (!refreshedAt || Date.now() - refreshedAt > 4000) return;
    setFresh(true);
    const t = setTimeout(() => setFresh(false), 4000);
    return () => clearTimeout(t);
  }, [refreshedAt]);
  if (!link) return null;
  const allow = () => {
    if (link.binary) {
      void diskLinks.allow(id);
      return;
    }
    const b = useEditor.getState().buffers[id];
    const text = b?.savedText ?? ws().allTexts().get(id);
    if (text !== undefined) void diskLinks.allow(id, text);
  };
  if (link.state === 'conflict') {
    return (
      <button
        type="button"
        className="status-pill"
        data-tone="warning"
        title={`"${link.fileName}" changed on your computer while this document had edits that aren't in the file. Choose which version to keep.`}
        aria-haspopup="menu"
        data-testid="disk-conflict"
        onClick={(e) =>
          openMenuAt(
            e.currentTarget,
            [
              {
                label: 'Load the version on disk',
                icon: <HardDriveDownload />,
                onSelect: () => void diskLinks.resolve(id, 'disk'),
              },
              {
                label: link.binary ? 'Keep the version in My Doc' : 'Keep mine and save it to disk',
                icon: <HardDriveUpload />,
                onSelect: () => void diskLinks.resolve(id, 'mine'),
              },
            ],
            'Changed on disk',
          )
        }
      >
        <AlertTriangle size={13} aria-hidden /> Changed on disk
      </button>
    );
  }
  if (link.state === 'needs-permission' || link.state === 'error') {
    const permissionNeeded = link.state === 'needs-permission';
    return (
      <button
        type="button"
        className="status-pill"
        data-tone={permissionNeeded ? 'warning' : 'danger'}
        title={
          permissionNeeded
            ? link.binary
              ? `Allow access to "${link.fileName}" on your computer so changes made there show here.`
              : `Your edits are saved in My Doc. Allow access to also save them to "${link.fileName}" on your computer, and to see changes made there.`
            : `${link.error ?? 'Unable to write the file.'} Your edits are still saved in My Doc.`
        }
        onClick={allow}
      >
        {permissionNeeded ? (
          <HardDrive size={13} aria-hidden />
        ) : (
          <AlertCircle size={13} aria-hidden />
        )}
        {permissionNeeded
          ? link.binary
            ? 'Allow disk access'
            : 'Allow saving to disk'
          : link.binary
            ? 'Disk file unavailable · Retry'
            : 'Disk save failed · Retry'}
      </button>
    );
  }
  return (
    <span
      className="status-pill shrink-0"
      data-tone="primary"
      title={
        link.binary
          ? `Linked to "${link.fileName}" on your computer. Changes made there show here.`
          : `Also saved to "${link.fileName}" on your computer. Changes made there show here.`
      }
      data-testid="disk-status"
      role={fresh ? 'status' : undefined}
    >
      {link.state === 'writing' ? (
        <Loader2 size={13} className="animate-spin" aria-hidden />
      ) : fresh ? (
        <RefreshCw size={13} aria-hidden />
      ) : (
        <HardDrive size={13} aria-hidden />
      )}
      <span className={fresh ? 'inline' : 'hidden md:inline'}>
        {fresh ? 'Updated from disk' : 'On disk'}
      </span>
    </span>
  );
}
