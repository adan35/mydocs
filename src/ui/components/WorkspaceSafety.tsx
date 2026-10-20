import { useState } from 'react';
import { ArrowRight, Download, HardDrive, AlertCircle } from 'lucide-react';
import { useEditor } from '@/app/editor-store';
import { exportEntry, openEntry } from '@/app/actions';
import { navigate } from '@/app/router';

/** A clear boundary between a local save and a separate backup. */
export function WorkspaceSafety() {
  const unsaved = useEditor(
    (s) => Object.values(s.buffers).filter((b) => b.text !== b.savedText).length,
  );
  const [exporting, setExporting] = useState(false);
  const exportBackup = async () => {
    setExporting(true);
    try {
      await exportEntry(null, 'zip');
    } finally {
      setExporting(false);
    }
  };
  return (
    <section aria-label="Workspace safety" className="workspace-safety mb-6">
      <span className="workspace-safety-icon" aria-hidden>
        {unsaved ? <AlertCircle size={21} /> : <HardDrive size={21} />}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[14px] font-semibold text-ink">
          {unsaved ? 'Some changes still need saving' : 'Your workspace lives on this device'}
        </h2>
        <p className="mt-1 text-caption text-steel">
          {unsaved
            ? 'Keep My Doc open or export your latest work as a backup.'
            : 'No account needed. Export a backup to keep a separate copy of your documents.'}
        </p>
        <button
          type="button"
          className="mt-2 inline-flex items-center gap-1 text-caption font-medium text-primary hover:underline"
          onClick={() => {
            const dirty = Object.values(useEditor.getState().buffers).find(
              (b) => b.text !== b.savedText,
            );
            if (dirty) void openEntry(dirty.id);
            else navigate({ name: 'settings' });
          }}
        >
          {unsaved ? 'Review unsaved changes' : 'Storage & backups'}{' '}
          <ArrowRight size={13} aria-hidden />
        </button>
      </div>
      <button
        type="button"
        className="btn btn-secondary workspace-backup"
        disabled={exporting}
        onClick={() => void exportBackup()}
      >
        <Download size={15} aria-hidden /> {exporting ? 'Exporting…' : 'Export backup'}
      </button>
    </section>
  );
}
