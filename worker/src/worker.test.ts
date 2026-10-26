// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveRole, settle, tryReserve, type ShareMeta } from './access';
import { signSession, verifyGoogleToken, verifySession } from './auth';
import { parseAiRequest } from './ai';

const meta: ShareMeta = {
  name: 'Plan',
  ownerEmail: 'owner@x.com',
  ownerName: 'Owner',
  linkRole: 'off',
  linkKey: 'secret-key',
  members: { 'ann@x.com': 'edit', 'bob@x.com': 'view' },
  createdAt: 0,
};

describe('resolveRole', () => {
  it('knows the owner, members and strangers', () => {
    expect(resolveRole(meta, 'OWNER@x.com', null)).toBe('owner');
    expect(resolveRole(meta, 'ann@x.com', null)).toBe('edit');
    expect(resolveRole(meta, 'bob@x.com', null)).toBe('view');
    expect(resolveRole(meta, 'eve@x.com', null)).toBeNull();
    expect(resolveRole(meta, null, null)).toBeNull();
  });
  it('lets a link grant access only while it is on and the key matches', () => {
    expect(resolveRole(meta, 'eve@x.com', 'secret-key')).toBeNull();
    const on = { ...meta, linkRole: 'edit' as const };
    expect(resolveRole(on, 'eve@x.com', 'secret-key')).toBe('edit');
    expect(resolveRole(on, 'eve@x.com', 'wrong')).toBeNull();
    expect(resolveRole(on, null, 'secret-key')).toBe('view');
  });
  it('takes the stronger of a member role and the link role', () => {
    expect(resolveRole({ ...meta, linkRole: 'edit' }, 'bob@x.com', 'secret-key')).toBe('edit');
    expect(resolveRole({ ...meta, linkRole: 'view' }, 'ann@x.com', 'secret-key')).toBe('edit');
  });
});

describe('AI quota', () => {
  it('reserves, refuses past the limit and settles to real usage', () => {
    expect(tryReserve(0, 1000, 600)).toEqual({ ok: true, used: 600 });
    expect(tryReserve(600, 1000, 600).ok).toBe(false);
    expect(settle(600, 600, 150)).toBe(150);
    expect(settle(100, 600, 0)).toBe(0);
  });
  it('rejects malformed or oversized requests and caps output tokens', () => {
    expect(parseAiRequest(null)).toBeNull();
    expect(parseAiRequest({ messages: [] })).toBeNull();
    expect(parseAiRequest({ messages: [{ role: 'system', content: 'x' }] })).toBeNull();
    expect(
      parseAiRequest({ messages: [{ role: 'user', content: 'x'.repeat(70_000) }] }),
    ).toBeNull();
    expect(
      parseAiRequest({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 999999 })?.maxTokens,
    ).toBe(4096);
  });
});

describe('sessions', () => {
  const user = { email: 'a@x.com', name: 'A', picture: '' };
  it('round-trips and rejects tampering, wrong secrets and expiry', async () => {
    const t = await signSession(user, 's1', 1000);
    expect(await verifySession(t, 's1', 2000)).toEqual(user);
    expect(await verifySession(t, 's2', 2000)).toBeNull();
    expect(await verifySession(t.replace(/^./, 'x'), 's1', 2000)).toBeNull();
    expect(await verifySession(t, 's1', 1000 + 31 * 86_400_000)).toBeNull();
    expect(await verifySession('garbage', 's1')).toBeNull();
  });
});

describe('Google ID token', () => {
  const b64 = (o: unknown) =>
    Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
  async function setup(claims: Record<string, unknown>) {
    const pair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );
    const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1' } as never;
    const head = b64({ alg: 'RS256', kid: 'k1' });
    const body = b64({
      iss: 'https://accounts.google.com',
      aud: 'cid',
      exp: 2000,
      email: 'A@X.com',
      email_verified: true,
      name: 'A',
      ...claims,
    });
    const sig = Buffer.from(
      await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        pair.privateKey,
        new TextEncoder().encode(`${head}.${body}`),
      ),
    ).toString('base64url');
    return { token: `${head}.${body}.${sig}`, keys: async () => [jwk] };
  }
  it('accepts a valid token', async () => {
    const { token, keys } = await setup({});
    expect((await verifyGoogleToken(token, 'cid', keys, 1_000_000)).email).toBe('a@x.com');
  });
  it('rejects wrong audience, expiry, unverified email, bad signature', async () => {
    for (const [claims, msg] of [
      [{ aud: 'other' }, 'audience'],
      [{ exp: 1 }, 'Expired'],
      [{ email_verified: false }, 'verified'],
      [{ iss: 'evil.com' }, 'issuer'],
    ] as const) {
      const { token, keys } = await setup(claims);
      await expect(verifyGoogleToken(token, 'cid', keys, 1_000_000)).rejects.toThrow(
        new RegExp(msg, 'i'),
      );
    }
    const { token, keys } = await setup({});
    const [h, , s] = token.split('.');
    await expect(
      verifyGoogleToken(
        `${h}.${b64({ iss: 'accounts.google.com', aud: 'cid', exp: 2000, email: 'e@x.com', email_verified: true })}.${s}`,
        'cid',
        keys,
        1_000_000,
      ),
    ).rejects.toThrow(/signature/i);
  });
});
