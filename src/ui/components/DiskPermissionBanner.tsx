import { useState } from 'react';
import { File, Folder, HardDrive, X } from 'lucide-react';
import { accessPlan, allowDiskAccess } from '@/app/disk-access';
import { useDiskLinks } from '@/app/disk-links';
import { useFolderLinks } from '@/app/folder-sync';
import { Dialog } from './Dialog';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** After a restart: a banner with the count, and a dialog that says what the browser will ask. */
export function DiskPermissionBanner() {
  const files = useDiskLinks(
    (s) => Object.values(s.links).filter((l) => l.state === 'needs-permission').length,
  );
  const folders = useFolderLinks(
    (s) => Object.values(s.links).filter((l) => l.state === 'needs-permission').length,
  );
  const count = files + folders;
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  if (open && count === 0) setOpen(false);
  return (
    <>
      {count >= 2 && !hidden && (
        <div
          role="region"
          aria-label="Disk access"
          className="popover animate-in fixed top-[calc(12px+env(safe-area-inset-top))] left-1/2 z-[70] flex w-[calc(100%-24px)] max-w-[480px] -translate-x-1/2 items-center gap-3 bg-canvas py-2.5 pr-2 pl-3.5 text-[14px] text-ink"
        >
          <HardDrive size={16} className="shrink-0 text-primary" aria-hidden />
          <p className="min-w-0 flex-1 leading-snug">
            {folders ? `${count} linked files and folders` : `${count} linked files`} need
            permission to sync with your computer.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
            Review
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            className="tap flex size-7 shrink-0 items-center justify-center rounded-md opacity-60 hover:opacity-100"
            onClick={() => setHidden(true)}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {open && <AccessDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function AccessDialog({ onClose }: { onClose: () => void }) {
  // Re-read on every change: each granted prompt takes its items off the list.
  useDiskLinks((s) => s.links);
  useFolderLinks((s) => s.links);
  const { folders, files, prompts } = accessPlan();
  const [busy, setBusy] = useState(false);
  const allow = async () => {
    setBusy(true);
    try {
      await allowDiskAccess();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Allow access to your files"
      size="md"
      onClose={onClose}
      description={
        <>
          Your browser forgets file access when it closes. It will ask{' '}
          <strong>{plural(prompts, 'time')}</strong> now: once for each folder (which covers the
          files inside it) and once for each file outside a folder. Choose Allow each time.
        </>
      }
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Not now
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void allow()}
          >
            {busy ? 'Waiting for the browser…' : `Allow ${plural(prompts, 'item')}`}
          </button>
        </>
      }
    >
      <ul className="max-h-[300px] space-y-1 overflow-auto text-[14px]" data-testid="access-list">
        {folders.map((f) => (
          <li key={f.id} className="flex items-center gap-2">
            <Folder size={14} className="shrink-0 opacity-60" aria-hidden />
            <span className="min-w-0 truncate">{f.name}</span>
            <span className="shrink-0 text-ink/50">and the files inside</span>
          </li>
        ))}
        {files.map((f) => (
          <li key={f.id} className="flex items-center gap-2">
            <File size={14} className="shrink-0 opacity-60" aria-hidden />
            <span className="min-w-0 truncate">{f.name}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[13px] text-ink/60">
        If the browser stops asking part-way, press the button again to continue. Your edits are
        always kept in My Doc, whatever you choose.
      </p>
    </Dialog>
  );
}
