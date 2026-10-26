import { create } from 'zustand';
import { isNativeApp } from '@/platform';
import { prefs } from './prefs';

/** Set when building (see docs/SHARING.md). Without both, My Doc stays purely local. */
export const API_URL = String(import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
export const GOOGLE_CLIENT_ID = String(import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '');
/** Google sign-in needs a web origin, so the desktop and phone apps use the web version for it. */
export const cloudAvailable = !!API_URL && !!GOOGLE_CLIENT_ID && !isNativeApp;

export interface Account {
  email: string;
  name: string;
  picture: string;
}

export interface AiUsage {
  defaultKey: boolean;
  limit: number;
  used: number;
  resetsAt: string;
}

interface AccountState {
  user: Account | null;
  token: string | null;
  ai: AiUsage | null;
}

const KEY = 'mydoc:account';

const saved = cloudAvailable ? prefs.get<{ user: Account; token: string } | null>(KEY, null) : null;

export const useAccount = create<AccountState>(() => ({
  user: saved?.user ?? null,
  token: saved?.token ?? null,
  ai: null,
}));

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Calls the sharing API as the signed-in user. A rejected session signs the user out. */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; key?: string } = {},
): Promise<T> {
  if (!cloudAvailable) throw new ApiError('Sharing is not set up on this site.', 0);
  const { token } = useAccount.getState();
  const url = `${API_URL}${path}${init.key ? `${path.includes('?') ? '&' : '?'}k=${encodeURIComponent(init.key)}` : ''}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError('Could not reach the sharing service. Check your connection.', 0);
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) {
    if (res.status === 401 && token) signOut();
    throw new ApiError(data?.error ?? `Request failed (${res.status}).`, res.status);
  }
  return data as T;
}

function setSession(token: string, user: Account) {
  prefs.set(KEY, { token, user });
  useAccount.setState({ token, user });
  void refreshAccount();
}

export function signOut() {
  prefs.remove(KEY);
  useAccount.setState({ user: null, token: null, ai: null });
}

/** Re-checks the session and loads the AI allowance. */
export async function refreshAccount() {
  if (!useAccount.getState().token) return;
  try {
    const me = await api<{ user: Account; ai: AiUsage }>('/api/me');
    useAccount.setState({ user: me.user, ai: me.ai });
  } catch {
    /* offline: keep the saved session */
  }
}

async function exchange(credential: string) {
  const r = await api<{ token: string; user: Account }>('/api/auth/google', {
    body: { credential },
  });
  setSession(r.token, r.user);
}

interface GoogleId {
  initialize(o: { client_id: string; callback(r: { credential: string }): void }): void;
  renderButton(el: HTMLElement, o: Record<string, unknown>): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

let gsi: Promise<GoogleId> | null = null;
function loadGoogle(): Promise<GoogleId> {
  gsi ??= new Promise<GoogleId>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => {
      const id = window.google?.accounts.id;
      if (!id) return reject(new Error('Google sign-in did not load.'));
      id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (r) => void exchange(r.credential).catch(onError),
      });
      resolve(id);
    };
    s.onerror = () => {
      gsi = null;
      reject(new Error('Could not load Google sign-in. Check your connection.'));
    };
    document.head.append(s);
  });
  return gsi;
}

let onError: (e: unknown) => void = () => {};

/** Draws Google's own sign-in button into `el`. Resolves once drawn. */
export async function renderGoogleButton(el: HTMLElement, fail: (e: unknown) => void) {
  onError = fail;
  const id = await loadGoogle();
  id.renderButton(el, {
    theme: 'outline',
    size: 'large',
    text: 'signin_with',
    shape: 'rectangular',
  });
}

/** Local development only: signs in as any email against a Worker started with DEV_AUTH=1. */
export async function devSignIn(email: string) {
  const r = await api<{ token: string; user: Account }>('/api/auth/dev', {
    body: { email, name: email.split('@')[0] },
  });
  setSession(r.token, r.user);
}

if (cloudAvailable && saved) void refreshAccount();
