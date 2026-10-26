import { useCallback, useEffect, useState } from 'react';
import { Copy, Link2, Mail, Share2, X } from 'lucide-react';
import { cloudAvailable, useAccount } from '@/app/cloud';
import { useApp } from '@/app/app-store';
import { dialogs } from '@/app/dialog-store';
import {
  fetchInfo,
  leaveShare,
  shareUrl,
  startSharing,
  stopSharing,
  updateSharing,
  useShares,
  type LinkRole,
  type ShareInfo,
} from '@/app/share';
import { toast, toastError } from '@/app/toast-store';
import type { EntryId } from '@/domain/types';
import { isNativeApp } from '@/platform';
import { Dialog } from '../components/Dialog';
import { SignIn } from './SignIn';

const LINK_OPTIONS: [LinkRole, string][] = [
  ['off', 'Only people I invite'],
  ['view', 'Anyone with the link can view'],
  ['edit', 'Anyone with the link can edit'],
];

export function ShareDialog({ entryId, onClose }: { entryId: EntryId; onClose(): void }) {
  const user = useAccount((s) => s.user);
  const binding = useShares((s) => s.bindings[entryId]);
  const name = useApp((s) => s.session?.workspace.get(entryId)?.name ?? '');
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [memberRole, setMemberRole] = useState<'view' | 'edit'>('edit');

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!binding || !user) return setInfo(null);
    let live = true;
    void run(() => fetchInfo(binding)).then((i) => live && i && setInfo(i));
    return () => {
      live = false;
    };
  }, [binding, user, run]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ message: 'Link copied.', tone: 'success' });
    } catch {
      toastError('Could not copy. Select the link and copy it by hand.');
    }
  };

  let body;
  if (!cloudAvailable) {
    body = (
      <p className="text-[14px] text-steel">
        {isNativeApp
          ? 'Open My Doc in your browser to share documents. Sharing needs Google sign-in, which works on the web version.'
          : 'Sharing is not set up on this site yet.'}
      </p>
    );
  } else if (!user) {
    body = (
      <>
        <p className="mb-3 text-[14px] text-steel">
          Sign in with Google to share this document and edit it together. Nothing is shared until
          you choose to.
        </p>
        <SignIn />
      </>
    );
  } else if (!binding) {
    body = (
      <>
        <p className="mb-3 text-[14px] text-steel">
          Sharing puts a live copy of <strong className="text-ink">{name}</strong> online so you can
          send a link or invite people by email. Your copy here stays yours; it keeps saving on this
          device.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void run(() => startSharing(entryId))}
        >
          Share this document
        </button>
      </>
    );
  } else if (!info) {
    body = <p className="text-[14px] text-steel">{error ? '' : 'Loading…'}</p>;
  } else if (info.role !== 'owner') {
    body = (
      <>
        <p className="text-[14px] text-charcoal">
          Shared by <strong>{info.owner.name}</strong>. You can{' '}
          <strong>{info.role === 'edit' ? 'edit' : 'view'}</strong> this document.
        </p>
        <button
          type="button"
          className="btn btn-secondary mt-4 mr-2"
          onClick={() => void dialogs.shareHistory(entryId)}
        >
          Who changed what
        </button>
        <button
          type="button"
          className="btn btn-secondary mt-4"
          onClick={() => {
            leaveShare(entryId);
            toast({ message: 'Stopped syncing. This copy is now just yours.' });
            onClose();
          }}
        >
          Stop syncing this copy
        </button>
      </>
    );
  } else {
    const link = info.linkKey ? shareUrl(binding.id, info.linkKey) : '';
    const message = `${name}: ${link}`;
    const set = (patch: Parameters<typeof updateSharing>[1]) =>
      void run(() => updateSharing(binding.id, patch)).then((i) => i && setInfo(i));
    body = (
      <div className="space-y-5">
        <section>
          <label htmlFor="link-role" className="section-label mb-1.5 block">
            Link access
          </label>
          <select
            id="link-role"
            className="input w-full"
            value={info.linkRole}
            disabled={busy}
            onChange={(e) => set({ linkRole: e.target.value as LinkRole })}
          >
            {LINK_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          {info.linkRole === 'edit' && (
            <p className="mt-1 text-caption text-steel">
              People need to sign in with Google to edit; without signing in they can only read.
            </p>
          )}
          {info.linkRole !== 'off' && (
            <>
              <div className="mt-2 flex gap-2">
                <input
                  readOnly
                  aria-label="Share link"
                  className="input min-w-0 flex-1"
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button type="button" className="btn btn-primary" onClick={() => void copy(link)}>
                  <Copy size={15} aria-hidden /> Copy
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {'share' in navigator && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void navigator.share({ title: name, url: link }).catch(() => {})}
                  >
                    <Share2 size={15} aria-hidden /> Share…
                  </button>
                )}
                <a
                  className="btn btn-secondary"
                  href={`https://wa.me/?text=${encodeURIComponent(message)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Link2 size={15} aria-hidden /> WhatsApp
                </a>
                <a
                  className="btn btn-secondary"
                  href={`mailto:?subject=${encodeURIComponent(name)}&body=${encodeURIComponent(link)}`}
                >
                  <Mail size={15} aria-hidden /> Email
                </a>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  title="Stops every link already sent from working"
                  onClick={async () => {
                    if (
                      await dialogs.confirm({
                        title: 'Make a new link?',
                        message: 'Links you already sent will stop working.',
                        confirmLabel: 'Make new link',
                      })
                    )
                      set({ rotateKey: true });
                  }}
                >
                  New link
                </button>
              </div>
            </>
          )}
        </section>

        <section>
          <h3 className="section-label mb-1.5">Invite people</h3>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!email.trim()) return;
              set({ addMember: { email, role: memberRole } });
              setEmail('');
            }}
          >
            <input
              className="input w-auto min-w-0 flex-1"
              type="email"
              aria-label="Email address"
              placeholder="name@gmail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <select
              className="input w-auto"
              aria-label="Role"
              value={memberRole}
              onChange={(e) => setMemberRole(e.target.value as 'view' | 'edit')}
            >
              <option value="edit">Can edit</option>
              <option value="view">Can view</option>
            </select>
            <button type="submit" className="btn btn-secondary" disabled={busy}>
              Invite
            </button>
          </form>
          <p className="mt-1 text-caption text-steel">
            They sign in with that Google account and find it under Shared with me. No email is
            sent, so send them the link too.
          </p>
          <ul className="mt-2 divide-y divide-hairline-soft">
            {Object.entries(info.members ?? {}).map(([addr, role]) => (
              <li key={addr} className="flex items-center gap-2 py-1.5 text-[14px]">
                <span className="min-w-0 flex-1 truncate">{addr}</span>
                <select
                  className="input h-8 w-auto"
                  aria-label={`Role for ${addr}`}
                  value={role}
                  disabled={busy}
                  onChange={(e) =>
                    set({ addMember: { email: addr, role: e.target.value as 'view' | 'edit' } })
                  }
                >
                  <option value="edit">Can edit</option>
                  <option value="view">Can view</option>
                </select>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove ${addr}`}
                  disabled={busy}
                  onClick={() => set({ removeMember: addr })}
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <button
          type="button"
          className="btn btn-secondary mr-2"
          onClick={() => void dialogs.shareHistory(entryId)}
        >
          Who changed what
        </button>
        <button
          type="button"
          className="btn btn-secondary text-danger"
          disabled={busy}
          onClick={async () => {
            if (
              await dialogs.confirm({
                title: 'Stop sharing?',
                message:
                  'The online copy is deleted and everyone loses access. Your copy on this device stays.',
                confirmLabel: 'Stop sharing',
                danger: true,
              })
            ) {
              await run(() => stopSharing(entryId));
              onClose();
            }
          }}
        >
          Stop sharing
        </button>
      </div>
    );
  }

  return (
    <Dialog title="Share" onClose={onClose} size="md">
      {body}
      {error && (
        <p role="alert" className="mt-3 text-caption text-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}
