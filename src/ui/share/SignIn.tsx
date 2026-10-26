import { useEffect, useRef, useState } from 'react';
import { cloudAvailable, devSignIn, renderGoogleButton } from '@/app/cloud';

/** Google's sign-in button. Signing in updates the account store, which the caller watches. */
export function SignIn() {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  useEffect(() => {
    if (!cloudAvailable || !host.current) return;
    renderGoogleButton(host.current, (e) =>
      setError(e instanceof Error ? e.message : 'Sign-in failed.'),
    ).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Sign-in failed.'));
  }, []);
  if (!cloudAvailable) return null;
  return (
    <div>
      <div ref={host} className="min-h-10" />
      {error && (
        <p role="alert" className="mt-2 text-caption text-danger">
          {error}
        </p>
      )}
      {import.meta.env.DEV && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            devSignIn(email).catch((err: unknown) => setError(String(err)));
          }}
        >
          <input
            className="input"
            placeholder="dev sign-in email"
            aria-label="Dev sign-in email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button className="btn btn-secondary" type="submit">
            Dev sign-in
          </button>
        </form>
      )}
    </div>
  );
}
