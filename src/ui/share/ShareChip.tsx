import { Users } from 'lucide-react';
import { cloudAvailable } from '@/app/cloud';
import { useCollab } from '@/app/collab-state';
import { dialogs } from '@/app/dialog-store';
import { useShares } from '@/app/share';
import type { EntryId } from '@/domain/types';

/** Share button for a document; once shared, shows who is in it and whether it can be edited. */
export function ShareChip({ id }: { id: EntryId }) {
  const bound = useShares((s) => !!s.bindings[id]);
  const live = useCollab((s) => s.live[id]);
  if (!cloudAvailable) return null;
  const open = () => void dialogs.share(id);
  if (!bound) {
    return (
      <button type="button" className="btn btn-ghost h-8 text-steel" onClick={open} title="Share">
        <Users size={15} aria-hidden /> <span className="hidden sm:inline">Share</span>
      </button>
    );
  }
  const status = live?.status ?? 'connecting';
  const readOnly = status === 'live' && live?.role === 'view';
  const label =
    status === 'live'
      ? readOnly
        ? 'View only'
        : live?.people.length
          ? `Live · ${live.people.length + 1}`
          : 'Live'
      : status === 'offline'
        ? 'Offline · read-only'
        : status === 'signin'
          ? 'Sign in to sync'
          : status === 'denied'
            ? 'No access'
            : 'Connecting…';
  const tone =
    status === 'live'
      ? readOnly
        ? undefined
        : 'success'
      : status === 'connecting'
        ? 'primary'
        : 'warning';
  return (
    <button
      type="button"
      className="status-pill"
      data-tone={tone}
      onClick={open}
      title={
        live?.message ??
        (live?.people.length ? `Also here: ${live.people.join(', ')}` : 'Sharing settings')
      }
    >
      <Users size={13} aria-hidden /> {label}
    </button>
  );
}
