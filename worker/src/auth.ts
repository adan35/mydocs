/** Google sign-in verification and the app's own signed session tokens. */
export interface SessionUser {
  email: string;
  name: string;
  picture: string;
}

const enc = new TextEncoder();
const b64url = (b: ArrayBuffer | Uint8Array) => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (const c of bytes) s += String.fromCharCode(c);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const json = (s: string) => JSON.parse(new TextDecoder().decode(unb64url(s))) as unknown;

export const randomToken = (bytes = 16) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

export interface Jwk {
  kid?: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

/**
 * Verifies a Google ID token: signature against Google's published keys, then issuer,
 * audience (this app's client id), expiry and a verified email.
 */
export async function verifyGoogleToken(
  token: string,
  clientId: string,
  getKeys: () => Promise<Jwk[]>,
  now = Date.now(),
): Promise<SessionUser> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [h, p, s] = parts as [string, string, string];
  const header = json(h) as { alg?: string; kid?: string };
  if (header.alg !== 'RS256') throw new Error('Unsupported algorithm');
  const jwk = (await getKeys()).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Unknown signing key');
  const key = await crypto.subtle.importKey(
    'jwk',
    { ...jwk, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    unb64url(s),
    enc.encode(`${h}.${p}`),
  );
  if (!ok) throw new Error('Bad signature');
  const c = json(p) as Record<string, unknown>;
  if (c.iss !== 'https://accounts.google.com' && c.iss !== 'accounts.google.com')
    throw new Error('Wrong issuer');
  if (c.aud !== clientId) throw new Error('Wrong audience');
  if (typeof c.exp !== 'number' || c.exp * 1000 < now) throw new Error('Expired');
  if (c.email_verified !== true || typeof c.email !== 'string')
    throw new Error('Email not verified');
  return {
    email: c.email.toLowerCase(),
    name: typeof c.name === 'string' ? c.name : c.email,
    picture: typeof c.picture === 'string' ? c.picture : '',
  };
}

const hmacKey = (secret: string, usage: ('sign' | 'verify')[]) =>
  crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usage,
  );

export const SESSION_DAYS = 30;

export async function signSession(user: SessionUser, secret: string, now = Date.now()) {
  const payload = b64url(
    enc.encode(JSON.stringify({ ...user, exp: now + SESSION_DAYS * 86_400_000 })),
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret, ['sign']),
    enc.encode(payload),
  );
  return `${payload}.${b64url(sig)}`;
}

export async function verifySession(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<SessionUser | null> {
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret, ['verify']),
      unb64url(sig),
      enc.encode(payload),
    );
    if (!ok) return null;
    const c = json(payload) as SessionUser & { exp: number };
    if (c.exp < now) return null;
    return { email: c.email, name: c.name, picture: c.picture };
  } catch {
    return null;
  }
}
