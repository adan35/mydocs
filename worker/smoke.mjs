// Local end-to-end check of the Worker with real websockets and the same y-websocket client
// the app uses. Start it first: `npm run worker:dev` (with DEV_AUTH=1 in worker/.dev.vars).
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import assert from 'node:assert/strict';

const BASE = process.env.API ?? 'http://localhost:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (path, { token, body, method } = {}) => {
  const res = await fetch(BASE + path, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email) =>
  (await call('/api/auth/dev', { body: { email, name: email.split('@')[0] } })).body.token;
const join = (id, { token, k }) => {
  const doc = new Y.Doc();
  const q = new URLSearchParams({ ...(token ? { token } : {}), ...(k ? { k } : {}) });
  const provider = new WebsocketProvider(BASE.replace('http', 'ws') + '/ws', id, doc, {
    params: Object.fromEntries(q),
    WebSocketPolyfill: WebSocket,
    disableBc: true,
  });
  return { doc, text: doc.getText('text'), provider, closes: [] };
};
const synced = (c) => new Promise((r) => (c.provider.synced ? r() : c.provider.once('sync', r)));

const stamp = Date.now();
const [alice, bob, carol] = await Promise.all(
  ['alice', 'bob', 'carol'].map((n) => login(`${n}${stamp}@x.com`)),
);
const bobEmail = `bob${stamp}@x.com`;

// Create, then share by link (view) and with Bob (edit).
const made = await call('/api/shares', { token: alice, body: { name: 'Plan.md', text: 'hello' } });
assert.equal(made.status, 200);
const { id, linkKey } = made.body;
assert.equal((await call(`/api/shares/${id}`, {})).status, 401, 'signed out, no key: no access');
assert.equal(
  (await call(`/api/shares/${id}`, { token: carol })).status,
  403,
  'stranger: no access',
);
assert.equal(
  (await call(`/api/shares/${id}/settings`, { token: bob, body: { linkRole: 'edit' } })).status,
  403,
  'non-owner cannot change settings',
);
let s = await call(`/api/shares/${id}/settings`, {
  token: alice,
  body: { linkRole: 'view', addMember: { email: bobEmail, role: 'edit' } },
});
assert.equal(s.status, 200);
assert.equal(
  (await call(`/api/shares/${id}?k=${linkKey}`, {})).body.role,
  'view',
  'link viewer without sign-in',
);
assert.equal((await call(`/api/shares/${id}`, { token: bob })).body.role, 'edit');
assert.deepEqual(
  (await call('/api/shares', { token: bob })).body.map((i) => i.id),
  [id],
  'Bob sees it in his inbox',
);
assert.equal((await call('/api/shares', { token: alice })).body.length, 0);

// Live editing: Alice and Bob edit, Carol views through the link.
const a = join(id, { token: alice });
const b = join(id, { token: bob });
const c = join(id, { k: linkKey });
await Promise.all([synced(a), synced(b), synced(c)]);
assert.equal(a.text.toString(), 'hello');
assert.equal(c.text.toString(), 'hello');
a.text.insert(5, ' world');
await sleep(300);
assert.equal(b.text.toString(), 'hello world', 'Bob sees Alice');
assert.equal(c.text.toString(), 'hello world', 'link viewer sees Alice');
b.text.insert(0, '>> ');
await sleep(300);
assert.equal(a.text.toString(), '>> hello world', 'Alice sees Bob');
c.text.insert(0, 'HACK ');
await sleep(300);
assert.equal(a.text.toString(), '>> hello world', 'a viewer cannot write');
assert.equal(b.text.toString(), '>> hello world');

// History: who changed what, visible to everyone with access; emails only to the owner.
const hist = (await call(`/api/shares/${id}/history`, { token: alice })).body;
assert.deepEqual(hist.authors.map((x) => x.name.replace(/\d+/, '')).sort(), ['alice', 'bob']);
assert.ok(
  hist.authors.every((x) => x.email),
  'owner sees emails',
);
const bobIdx = hist.authors.findIndex((x) => x.name.startsWith('bob'));
const bobSession = hist.sessions.find((x) => x.a === bobIdx);
assert.deepEqual(
  bobSession.lines.map((l) => l.type),
  ['del', 'add'],
  "Bob's change replaced a line",
);
assert.equal(hist.blame.map((l) => l.text).join('\n'), '>> hello world');
const seen = (await call(`/api/shares/${id}/history?k=${linkKey}`, {})).body;
assert.ok(
  seen.authors.every((x) => !('email' in x)),
  'link viewers never see email addresses',
);
assert.equal((await call(`/api/shares/${id}/history`, {})).status, 401);

// Persistence: everyone leaves, a new client still sees the text.
for (const x of [a, b, c]) x.provider.destroy();
await sleep(300);
const d = join(id, { token: bob });
await synced(d);
assert.equal(d.text.toString(), '>> hello world', 'state survives');

// Revoking the link closes the viewer; stopping sharing closes everyone.
const c2 = join(id, { k: linkKey });
await synced(c2);
let closed = false;
c2.provider.on('connection-close', (e) => e?.code === 4403 && (closed = true));
await call(`/api/shares/${id}/settings`, { token: alice, body: { linkRole: 'off' } });
await sleep(400);
assert.ok(closed, 'link viewer is disconnected when the link is turned off');
assert.equal((await call(`/api/shares/${id}?k=${linkKey}`, {})).status, 401);
c2.provider.destroy();
await call(`/api/shares/${id}/settings`, { token: alice, body: { removeMember: bobEmail } });
assert.equal(
  (await call(`/api/shares/${id}`, { token: bob })).status,
  403,
  'removed member loses access',
);
assert.equal((await call('/api/shares', { token: bob })).body.length, 0);
d.provider.destroy();
assert.equal((await call(`/api/shares/${id}`, { token: alice, method: 'DELETE' })).status, 200);
assert.equal((await call(`/api/shares/${id}`, { token: alice })).status, 404);

// AI: signed-in only, quota enforced, failed provider calls are refunded.
assert.equal(
  (await call('/api/ai', { body: { messages: [{ role: 'user', content: 'hi' }] } })).status,
  401,
);
const big = await call('/api/ai', {
  token: alice,
  body: { messages: [{ role: 'user', content: 'hi' }], maxTokens: 2000 },
});
assert.equal(big.status, 429, 'over the monthly allowance');
const ok = await call('/api/ai', {
  token: alice,
  body: { messages: [{ role: 'user', content: 'hi' }], maxTokens: 100 },
});
assert.ok([502, 429].includes(ok.status), `fake provider key is rejected (${ok.status})`);
assert.equal(
  (await call('/api/me', { token: alice })).body.ai.used,
  0,
  'rejected calls cost nothing',
);
console.log('worker smoke test: all checks passed');
process.exit(0);
