import { useState } from 'react';
import { HardDrive, X } from 'lucide-react';
import { allowDiskAccess } from '@/app/disk-access';
import { useDiskLinks } from '@/app/disk-links';
import { useFolderLinks } from '@/app/folder-sync';

/** After a restart: one button asks the browser for every linked file and folder at once. */
export function DiskPermissionBanner() {
  const files = useDiskLinks(
    (s) => Object.values(s.links).filter((l) => l.state === 'needs-permission').length,
  );
  const folders = useFolderLinks(
    (s) => Object.values(s.links).filter((l) => l.state === 'needs-permission').length,
  );
  const count = files + folders;
  const [hidden, setHidden] = useState(false);
  if (count < 2 || hidden) return null;
  return (
    <div
      role="region"
      aria-label="Disk access"
      className="popover animate-in fixed top-[calc(12px+env(safe-area-inset-top))] left-1/2 z-[70] flex w-[calc(100%-24px)] max-w-[480px] -translate-x-1/2 items-center gap-3 bg-canvas py-2.5 pr-2 pl-3.5 text-[14px] text-ink"
    >
      <HardDrive size={16} className="shrink-0 text-primary" aria-hidden />
      <p className="min-w-0 flex-1 leading-snug">
        {folders ? `${count} linked files and folders` : `${count} linked files`} need permission to
        sync with your computer.
      </p>
      <button type="button" className="btn btn-primary" onClick={() => void allowDiskAccess()}>
        Allow all
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
  );
}
