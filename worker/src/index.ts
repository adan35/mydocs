import { callProvider, estimateInput, parseAiRequest, ProviderError } from './ai';
import {
  randomToken,
  signSession,
  verifyGoogleToken,
  verifySession,
  type Jwk,
  type SessionUser,
} from './auth';
import type { Env } from './env';

export { Room } from './room';
export { UserState } from './user';

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const getGoogleKeys = async (): Promise<Jwk[]> => {
  const res = await fetch(GOOGLE_CERTS, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) throw new Error('Could not load Google signing keys');
  return ((await res.json()) as { keys: Jwk[] }).keys;
};

const origins = (env: Env) => env.APP_ORIGINS.split(',').map((s) => s.trim());

function cors(req: Request, env: Env): HeadersInit {
  const origin = req.headers.get('origin');
  return origin && origins(env).includes(origin)
    ? {
        'access-control-allow-origin': origin,
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
        vary: 'origin',
      }
    : {};
}

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function authenticate(req: Request, env: Env, url: URL): Promise<SessionUser | null> {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer /, '');
  // Browsers can't set headers on a WebSocket, so that one route also accepts ?token=.
  const token = bearer || (url.pathname.startsWith('/ws/') ? url.searchParams.get('token') : null);
  return token ? verifySession(token, env.SESSION_SECRET, Date.now()) : null;
}

const need = (u: SessionUser | null): SessionUser => {
  if (!u) throw new HttpError(401, 'Sign in to continue.');
  return u;
};

/** Forwards to a share's Room with the identity this Worker verified. */
function room(
  env: Env,
  id: string,
  path: string,
  user: SessionUser | null,
  key: string | null,
  init: RequestInit = {},
) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) throw new HttpError(404, 'Not found');
  const stub = env.ROOM.get(env.ROOM.idFromName(id));
  const headers = new Headers(init.headers);
  headers.delete('x-email');
  headers.delete('x-name');
  headers.delete('x-key');
  if (user) {
    headers.set('x-email', user.email);
    headers.set('x-name', encodeURIComponent(user.name));
  }
  if (key) headers.set('x-key', key);
  return stub.fetch(`https://room${path}${path.includes('?') ? '&' : '?'}id=${id}`, {
    ...init,
    headers,
  });
}

async function handle(req: Request, env: Env, url: URL): Promise<Response> {
  const { pathname: p } = url;
  const m = req.method;
  const user = await authenticate(req, env, url);
  const key = url.searchParams.get('k');

  if (p === '/api/auth/google' && m === 'POST') {
    const { credential } = (await req.json()) as { credential?: string };
    if (!credential || !env.GOOGLE_CLIENT_ID)
      throw new HttpError(400, 'Sign-in is not configured.');
    let u: SessionUser;
    try {
      u = await verifyGoogleToken(credential, env.GOOGLE_CLIENT_ID, getGoogleKeys);
    } catch {
      throw new HttpError(401, 'Google sign-in could not be verified.');
    }
    return reply({ token: await signSession(u, env.SESSION_SECRET), user: u });
  }

  if (p === '/api/auth/dev' && m === 'POST' && env.DEV_AUTH === '1') {
    const { email, name } = (await req.json()) as { email: string; name?: string };
    const u = { email: email.toLowerCase(), name: name || email, picture: '' };
    return reply({ token: await signSession(u, env.SESSION_SECRET), user: u });
  }

  if (p === '/api/me' && m === 'GET') {
    const u = need(user);
    const limit = Number(env.AI_MONTHLY_TOKENS) || 0;
    const usage = (await (
      await env.USER.get(env.USER.idFromName(u.email)).fetch('https://user/ai/usage')
    ).json()) as { used: number; resetsAt: string };
    return reply({ user: u, ai: { defaultKey: !!env.AI_API_KEY, limit, ...usage } });
  }

  if (p === '/api/shares' && m === 'GET') {
    const u = need(user);
    return new Response(
      (await env.USER.get(env.USER.idFromName(u.email)).fetch('https://user/inbox')).body,
      { headers: { 'content-type': 'application/json' } },
    );
  }

  if (p === '/api/shares' && m === 'POST') {
    const u = need(user);
    const { name, text } = (await req.json()) as { name?: string; text?: string };
    if (typeof name !== 'string' || typeof text !== 'string' || text.length > 1_000_000)
      throw new HttpError(
        400,
        'This document is too large to share live (limit 1,000,000 characters).',
      );
    const id = randomToken(16);
    const r = await room(env, id, '/init', u, null, {
      method: 'POST',
      body: JSON.stringify({ name: name.slice(0, 200), text }),
    });
    const { linkKey } = (await r.json()) as { linkKey: string };
    return reply({ id, linkKey });
  }

  let match = p.match(/^\/api\/shares\/([^/]+)$/);
  if (match) {
    const id = match[1]!;
    if (m === 'GET') return room(env, id, '/info', user, key);
    if (m === 'DELETE') return room(env, id, '/', need(user), null, { method: 'DELETE' });
  }
  match = p.match(/^\/api\/shares\/([^/]+)\/history$/);
  if (match && m === 'GET') return room(env, match[1]!, '/history', user, key);
  match = p.match(/^\/api\/shares\/([^/]+)\/settings$/);
  if (match && m === 'POST')
    return room(env, match[1]!, '/settings', need(user), null, {
      method: 'POST',
      body: await req.text(),
    });

  match = p.match(/^\/ws\/([^/]+)$/);
  if (match && m === 'GET') {
    const origin = req.headers.get('origin');
    if (origin && !origins(env).includes(origin)) throw new HttpError(403, 'Origin not allowed');
    return room(env, match[1]!, '/ws', user, key, { headers: req.headers });
  }

  if (p === '/api/ai' && m === 'POST') {
    const u = need(user);
    if (!env.AI_API_KEY) throw new HttpError(503, 'The default AI key is not set up.');
    const r = parseAiRequest(await req.json().catch(() => null));
    if (!r) throw new HttpError(400, 'That request is malformed or too large.');
    const limit = Number(env.AI_MONTHLY_TOKENS) || 0;
    const want = estimateInput(r) + r.maxTokens;
    const stub = env.USER.get(env.USER.idFromName(u.email));
    const post = (path: string, body: unknown) =>
      stub.fetch(`https://user${path}`, { method: 'POST', body: JSON.stringify(body) });
    const res = (await (await post('/ai/reserve', { limit, want })).json()) as {
      ok: boolean;
      used: number;
      key: string;
    };
    if (!res.ok)
      throw new HttpError(
        429,
        'You have used your free AI allowance for this month. Add your own API key in Settings to keep going.',
      );
    try {
      const out = await callProvider(env, r);
      const actual = out.input + out.output;
      await post('/ai/settle', { key: res.key, reserved: want, actual });
      return reply({
        text: out.text,
        usage: { input: out.input, output: out.output },
        remaining: Math.max(0, limit - (res.used - want + actual)),
      });
    } catch (err) {
      await post('/ai/settle', { key: res.key, reserved: want, actual: 0 });
      if (err instanceof ProviderError) throw new HttpError(err.status, err.message);
      throw err;
    }
  }

  throw new HttpError(404, 'Not found');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const headers = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    try {
      const res = await handle(req, env, url);
      if (res.status === 101) return res;
      const out = new Response(res.body, res);
      for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
      return out;
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const body = JSON.stringify({
        error: err instanceof HttpError ? err.message : 'Something went wrong.',
      });
      return new Response(body, {
        status,
        headers: { ...headers, 'content-type': 'application/json' },
      });
    }
  },
} satisfies ExportedHandler<Env>;
