import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { cloudAvailable, useAccount } from '@/app/cloud';
import { navigate } from '@/app/router';
import {
  fetchInfo,
  listInvites,
  openShared,
  useShares,
  type Invite,
  type ShareInfo,
} from '@/app/share';
import { toastError } from '@/app/toast-store';
import { Page } from '../components/Page';
import { SignIn } from './SignIn';

/** What a share link opens: who shared what, with a button to open it here. */
export function ShareLanding({ id, secret }: { id: string; secret?: string }) {
  const user = useAccount((s) => s.user);
  const bound = useShares((s) => Object.values(s.bindings).some((b) => b.id === id));
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [error, setError] = useState<{ text: string; status: number } | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!cloudAvailable) return;
    let live = true;
    setError(null);
    fetchInfo({ id, key: secret, role: 'view' }).then(
      (i) => live && setInfo(i),
      (e: { message: string; status?: number }) =>
        live && setError({ text: e.message, status: e.status ?? 0 }),
    );
    return () => {
      live = false;
    };
    // Signing in can turn "no access" into access.
  }, [id, secret, user?.email]);

  const open = async () => {
    setOpening(true);
    try {
      await openShared(id, secret);
    } catch (e) {
      toastError('Could not open the shared document.', e);
      setOpening(false);
    }
  };

  // Already here: go straight to it.
  useEffect(() => {
    if (bound) void openShared(id, secret).catch(() => {});
  }, [bound, id, secret]);

  return (
    <Page title="Shared document" icon={<Users />}>
      <div className="max-w-md rounded-lg border border-hairline p-5">
        {!cloudAvailable ? (
          <p className="text-[14px] text-steel">
            Sharing is not available in this app. Open the link in your browser.
          </p>
        ) : info ? (
          <>
            <h2 className="text-[16px] font-semibold text-ink">{info.name}</h2>
            <p className="mt-1 text-[14px] text-steel">
              Shared by {info.owner.name}. You can {info.role === 'view' ? 'view' : 'edit'} it.
            </p>
            {info.role === 'view' && !user && (
              <div className="mt-3">
                <p className="mb-2 text-caption text-steel">
                  Sign in with Google if this link lets you edit.
                </p>
                <SignIn />
              </div>
            )}
            <button
              type="button"
              className="btn btn-primary mt-4"
              disabled={opening}
              onClick={() => void open()}
            >
              Open in My Doc
            </button>
            <p className="mt-2 text-caption text-steel">
              A copy is added to a "Shared with me" folder here and stays in sync while you are
              online.
            </p>
          </>
        ) : error ? (
          <>
            <p role="alert" className="text-[14px] text-danger">
              {error.status === 401
                ? 'Sign in with the Google account this was shared with.'
                : error.status === 403 || error.status === 404
                  ? 'This link does not work. It may have been turned off, or this account has no access.'
                  : error.text}
            </p>
            {error.status === 401 && !user && (
              <div className="mt-3">
                <SignIn />
              </div>
            )}
            <button
              type="button"
              className="btn btn-secondary mt-4"
              onClick={() => navigate({ name: 'home' })}
            >
              Go home
            </button>
          </>
        ) : (
          <p className="text-[14px] text-steel">Loading…</p>
        )}
      </div>
    </Page>
  );
}

/** Documents invited to this account. */
export function SharedWithMe() {
  const user = useAccount((s) => s.user);
  const [items, setItems] = useState<Invite[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!cloudAvailable || !user) return;
    listInvites().then(setItems, (e: Error) => setError(e.message));
  }, [user]);
  return (
    <Page title="Shared with me" icon={<Users />}>
      {!cloudAvailable ? (
        <p className="text-[14px] text-steel">Sharing is not set up on this site.</p>
      ) : !user ? (
        <div className="max-w-md">
          <p className="mb-3 text-[14px] text-steel">Sign in to see documents shared with you.</p>
          <SignIn />
        </div>
      ) : error ? (
        <p role="alert" className="text-[14px] text-danger">
          {error}
        </p>
      ) : !items ? (
        <p className="text-[14px] text-steel">Loading…</p>
      ) : !items.length ? (
        <p className="text-[14px] text-steel">Nothing has been shared with {user.email} yet.</p>
      ) : (
        <ul className="divide-y divide-hairline-soft rounded-lg border border-hairline">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] text-ink">{i.name}</div>
                <div className="text-caption text-steel">
                  {i.ownerName} · can {i.role === 'edit' ? 'edit' : 'view'}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() =>
                  void openShared(i.id).catch((e: unknown) => toastError('Could not open it.', e))
                }
              >
                Open
              </button>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
