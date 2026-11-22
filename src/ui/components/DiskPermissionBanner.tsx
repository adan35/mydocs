import { useState } from 'react';
import { File, Folder, HardDrive, X } from 'lucide-react';
import { accessPlan, allowAllDiskAccess } from '@/app/disk-access';
import { useDiskLinks } from '@/app/disk-links';
import { useFolderLinks } from '@/app/folder-sync';
import { Dialog } from './Dialog';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** After a restart: a banner with an "Allow all" button, and a dialog that says what it will ask. */
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
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void allowAllDiskAccess()}
          >
            Allow all
          </button>
          <button type="button" className="btn" onClick={() => setOpen(true)}>
            Details
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
  // Re-read on every change: each restored item takes itself off the list.
  useDiskLinks((s) => s.links);
  useFolderLinks((s) => s.links);
  const { folders, files, prompts, items } = accessPlan();
  const listed = [
    ...folders.map((f) => ({ ...f, folder: true })),
    ...files.map((f) => ({ ...f, folder: false })),
  ];
  const shown = listed.slice(0, 8);
  const allow = () => {
    // The browser's own prompt or folder picker takes over; the app stays usable meanwhile.
    onClose();
    void allowAllDiskAccess();
  };
  return (
    <Dialog
      title="Allow access to your files"
      size="md"
      onClose={onClose}
      description={
        <>
          Your browser forgets file access when it closes.{' '}
          <strong>{plural(items, 'linked item')}</strong> need it again.{' '}
          {prompts > 1
            ? 'Choose the folder that contains them (for example your projects folder) and allow it once: that one permission covers everything inside.'
            : 'The browser will ask once.'}
        </>
      }
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Not now
          </button>
          <button type="button" className="btn btn-primary" onClick={allow}>
            Allow all
          </button>
        </>
      }
    >
      <ul className="max-h-[300px] space-y-1 overflow-auto text-[14px]" data-testid="access-list">
        {shown.map((f) => (
          <li key={f.id} className="flex items-center gap-2">
            {f.folder ? (
              <Folder size={14} className="shrink-0 opacity-60" aria-hidden />
            ) : (
              <File size={14} className="shrink-0 opacity-60" aria-hidden />
            )}
            <span className="min-w-0 truncate">{f.name}</span>
            {f.folder && <span className="shrink-0 text-ink/50">and the files inside</span>}
          </li>
        ))}
        {listed.length > shown.length && (
          <li className="text-ink/60">and {listed.length - shown.length} more</li>
        )}
      </ul>
      <p className="mt-3 text-[13px] text-ink/60">
        In Chrome, choose “Allow on every visit” to stop being asked after each restart. Your edits
        are always kept in My Doc, whatever you choose.
      </p>
    </Dialog>
  );
}
