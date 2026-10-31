import { useEffect, useState } from 'react';
import { AlertCircle, FolderSync, HardDrive, Loader2 } from 'lucide-react';
import type { EntryId } from '@/domain/types';
import { useDiskLinks } from '@/app/disk-links';
import { useFolderLinks } from '@/app/folder-sync';
import { useSettings } from '@/app/settings-store';
import * as A from '@/app/actions';
import { ws } from '@/app/app-store';
import { openMenuAt } from './Menu';
import { folderSyncItems } from '../entry-menu';

function ago(t: number | undefined, now: number): string {
  if (!t) return 'not synced yet';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  return s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
}

/** Whether a folder imported from disk is in step with it, and when it last was. */
export function FolderSyncStatus({ id }: { id: EntryId }) {
  const link = useFolderLinks((s) => s.links[id]);
  const globalLive = useSettings((s) => s.liveFolderSync);
  const conflicts = useDiskLinks(
    (s) =>
      Object.entries(s.links).filter(
        ([f, l]) => l.state === 'conflict' && ws().tree.isWithin(f, id),
      ).length,
  );
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  if (!link) return null;
  const live = link.live ?? globalLive;
  const act = (tone: string, icon: React.ReactNode, label: string, title: string) => (
    <button
      type="button"
      className="status-pill"
      data-tone={tone}
      title={title}
      data-testid="folder-sync-status"
      onClick={() => void A.syncFolder(id)}
    >
      {icon} {label}
    </button>
  );
  if (link.state === 'missing')
    return act(
      'danger',
      <AlertCircle size={13} aria-hidden />,
      'Folder deleted from disk',
      `"${link.name}" was deleted from your computer. Click to check again.`,
    );
  if (link.state === 'needs-permission')
    return act(
      'warning',
      <HardDrive size={13} aria-hidden />,
      'Allow disk access',
      `Allow access to "${link.name}" on your computer to sync it.`,
    );
  if (link.state === 'error')
    return act(
      'danger',
      <AlertCircle size={13} aria-hidden />,
      'Sync failed · Retry',
      link.error ?? 'Unable to read the folder.',
    );
  const text = link.state === 'syncing' ? 'Syncing…' : `Synced ${ago(link.lastSync, now)}`;
  return (
    <button
      type="button"
      className="status-pill"
      data-tone={conflicts ? 'warning' : live ? 'primary' : undefined}
      title={
        live
          ? `Live sync with "${link.name}" on your computer: edits, new files and deletions are mirrored here.`
          : `Linked to "${link.name}" on your computer. New files are added when you come back to this window.`
      }
      data-testid="folder-sync-status"
      aria-haspopup="menu"
      onClick={(e) => openMenuAt(e.currentTarget, folderSyncItems(id), 'Sync with disk')}
    >
      {link.state === 'syncing' ? (
        <Loader2 size={13} className="animate-spin" aria-hidden />
      ) : (
        <FolderSync size={13} aria-hidden />
      )}
      {live ? 'Live sync' : 'Linked'} · {text}
      {conflicts ? ` · ${conflicts} changed on both sides` : ''}
    </button>
  );
}
