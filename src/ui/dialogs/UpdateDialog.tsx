import { dismissPrompt, installUpdate, useUpdates } from '@/app/updates';
import { Dialog } from '../components/Dialog';

/** "Update available" prompt for the desktop app. Renders nothing elsewhere. */
export function UpdatePrompt() {
  const open = useUpdates((s) => s.promptOpen);
  const status = useUpdates((s) => s.status);
  if (!open || (status.phase !== 'available' && status.phase !== 'installing')) return null;
  const installing = status.phase === 'installing';
  const notes = status.phase === 'available' ? status.notes?.trim() : undefined;
  return (
    <Dialog
      title={`My Doc ${status.version} is available`}
      description="Your documents stay on this device. My Doc saves your open edits, installs the update, and restarts."
      onClose={() => !installing && dismissPrompt()}
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={installing}
            onClick={() => dismissPrompt(true)}
          >
            Skip this version
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={installing}
            onClick={() => dismissPrompt()}
          >
            Later
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={installing}
            onClick={() => void installUpdate()}
          >
            {installing ? 'Installing…' : 'Install and restart'}
          </button>
        </>
      }
    >
      {installing && (
        <div
          role="progressbar"
          aria-label="Downloading update"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={status.progress === null ? undefined : Math.round(status.progress * 100)}
          className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface"
        >
          <div
            className={`h-full bg-primary transition-[width] ${status.progress === null ? 'w-1/3 animate-pulse' : ''}`}
            style={status.progress === null ? undefined : { width: `${status.progress * 100}%` }}
          />
        </div>
      )}
      {notes && (
        <pre className="max-h-48 overflow-auto font-sans text-caption whitespace-pre-wrap text-charcoal">
          {notes}
        </pre>
      )}
    </Dialog>
  );
}
