import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import {
  canWrite,
  normEmail,
  resolveRole,
  type LinkRole,
  type Role,
  type ShareMeta,
} from './access';
import { randomToken } from './auth';
import type { Env } from './env';
import {
  emptyState,
  mergeOps,
  replay,
  summarize,
  type Entry,
  type Op,
  type State,
} from './history';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
/** Close codes the app understands: 4401 sign-in needed, 4403 no access, 4000 permissions changed. */
const MAX_MESSAGE = 1_000_000;
const MAX_STATE = 1_800_000;
const COMPACT_EVERY = 50;
/** Recorded edits kept in full; older ones are folded into a per-character authorship snapshot. */
const MAX_ROWS = 3000;
/** Edits closer together than this by one person are one history entry. */
const MERGE_MS = 2000;

interface Conn {
  email: string | null;
  name: string;
  key: string | null;
  role: Role;
  clientIds: Set<number>;
}

const buf = (u: Uint8Array) =>
  u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * One shared document: its access list and its Yjs state. It speaks the y-websocket
 * protocol, so clients sync through the stock `y-websocket` provider. Only the Worker
 * reaches it, and the Worker has already verified the identity in the x-* headers.
 */
export class Room implements DurableObject {
  private doc = new Y.Doc();
  private awareness = new awarenessProtocol.Awareness(this.doc);
  private meta: ShareMeta | null = null;
  private conns = new Map<WebSocket, Conn>();
  private sinceCompact = 0;
  private rows = 0;
  private last: { id: number; at: number; email: string; delta: Op[] } | null = null;

  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {
    this.awareness.setLocalState(null);
    ctx.blockConcurrencyWhile(async () => {
      const sql = this.ctx.storage.sql;
      sql.exec(
        'CREATE TABLE IF NOT EXISTS updates (id INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL)',
      );
      sql.exec(
        'CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, email TEXT NOT NULL, name TEXT NOT NULL, delta TEXT NOT NULL)',
      );
      sql.exec('CREATE TABLE IF NOT EXISTS base (id INTEGER PRIMARY KEY, state TEXT NOT NULL)');
      this.rows = Number(sql.exec('SELECT COUNT(*) AS n FROM history').one().n);
      this.meta = (await ctx.storage.get<ShareMeta>('meta')) ?? null;
      for (const row of ctx.storage.sql.exec('SELECT data FROM updates ORDER BY id'))
        Y.applyUpdate(this.doc, new Uint8Array(row.data as ArrayBuffer));
    });
    // Every change a collaborator makes is recorded with who made it (see history.ts).
    this.doc.getText('text').observe((event, txn) => {
      const who = txn.origin as Conn | null;
      if (!who || typeof who !== 'object' || !('role' in who)) return;
      const delta: Op[] = [];
      for (const d of event.delta) {
        if (typeof d.insert === 'string') delta.push({ insert: d.insert });
        else if (d.delete) delta.push({ delete: d.delete });
        else if (d.retain) delta.push({ retain: d.retain });
      }
      this.record(who.email ?? 'unknown', who.name, delta);
    });
    this.doc.on('update', (update: Uint8Array) => {
      this.persist(update);
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.writeUpdate(enc, update);
      this.broadcast(encoding.toUint8Array(enc));
    });
    this.awareness.on(
      'update',
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        const conn = origin && typeof origin === 'object' ? (origin as Conn) : null;
        if (conn) {
          for (const id of added) conn.clientIds.add(id);
          for (const id of removed) conn.clientIds.delete(id);
        }
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_AWARENESS);
        encoding.writeVarUint8Array(
          enc,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
            ...added,
            ...updated,
            ...removed,
          ]),
        );
        this.broadcast(encoding.toUint8Array(enc));
      },
    );
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const email = req.headers.get('x-email') || null;
    const name = decodeURIComponent(req.headers.get('x-name') || '');
    const key = req.headers.get('x-key') || null;

    if (url.pathname === '/init' && req.method === 'POST') {
      if (this.meta || !email) return json({ error: 'Already exists' }, 409);
      const { name: title, text } = (await req.json()) as { name: string; text: string };
      this.meta = {
        name: title,
        ownerEmail: normEmail(email),
        ownerName: name || email,
        linkRole: 'off',
        linkKey: randomToken(),
        members: {},
        createdAt: Date.now(),
      };
      await this.ctx.storage.put('meta', this.meta);
      this.doc.getText('text').insert(0, text);
      if (text) this.record(this.meta.ownerEmail, this.meta.ownerName, [{ insert: text }]);
      this.compact();
      return json({ ok: true, linkKey: this.meta.linkKey });
    }

    const meta = this.meta;
    if (!meta) return json({ error: 'Not found' }, 404);
    const role = resolveRole(meta, email, key);

    if (url.pathname === '/ws') {
      if (req.headers.get('upgrade') !== 'websocket')
        return json({ error: 'Expected WebSocket' }, 426);
      if (!role)
        return json(
          { error: email ? 'No access' : 'Sign in to open this document' },
          email ? 403 : 401,
        );
      return this.accept(email, name, key, role);
    }

    if (url.pathname === '/history' && req.method === 'GET') {
      if (!role)
        return json(
          { error: email ? 'No access' : 'Sign in to open this document' },
          email ? 403 : 401,
        );
      const { base, entries } = this.loadHistory();
      // Only the owner sees collaborators' email addresses.
      return json(summarize(base, entries, role === 'owner'));
    }

    if (url.pathname === '/info' && req.method === 'GET') {
      if (!role)
        return json(
          { error: email ? 'No access' : 'Sign in to open this document' },
          email ? 403 : 401,
        );
      return json(this.info(role));
    }

    if (role !== 'owner') return json({ error: 'Only the owner can do that' }, 403);

    if (url.pathname === '/settings' && req.method === 'POST') {
      const b = (await req.json()) as {
        linkRole?: LinkRole;
        rotateKey?: boolean;
        name?: string;
        addMember?: { email: string; role: 'view' | 'edit' };
        removeMember?: string;
      };
      if (b.linkRole && ['off', 'view', 'edit'].includes(b.linkRole)) meta.linkRole = b.linkRole;
      if (b.rotateKey) meta.linkKey = randomToken();
      if (typeof b.name === 'string' && b.name.trim()) meta.name = b.name.trim().slice(0, 200);
      if (b.addMember) {
        const who = normEmail(b.addMember.email);
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(who) || who.length > 254)
          return json({ error: 'That is not an email address.' }, 400);
        if (!['view', 'edit'].includes(b.addMember.role)) return json({ error: 'Bad role' }, 400);
        if (who !== meta.ownerEmail) {
          if (!meta.members[who] && Object.keys(meta.members).length >= 100)
            return json({ error: 'A document can be shared with up to 100 people.' }, 400);
          meta.members[who] = b.addMember.role;
          await this.inbox(who, 'add', { id: this.shareId(url), role: b.addMember.role });
        }
      }
      if (b.removeMember) {
        const who = normEmail(b.removeMember);
        delete meta.members[who];
        await this.inbox(who, 'remove', { id: this.shareId(url) });
      }
      await this.ctx.storage.put('meta', meta);
      this.reauthorize();
      return json(this.info('owner'));
    }

    if (url.pathname === '/' && req.method === 'DELETE') {
      for (const who of Object.keys(meta.members))
        await this.inbox(who, 'remove', { id: this.shareId(url) });
      for (const ws of this.conns.keys()) ws.close(4403, 'Sharing stopped');
      this.conns.clear();
      this.meta = null;
      await this.ctx.storage.deleteAll();
      return json({ ok: true });
    }
    return json({ error: 'Not found' }, 404);
  }

  private shareId(url: URL) {
    return url.searchParams.get('id') ?? '';
  }

  private async inbox(email: string, op: 'add' | 'remove', extra: { id: string; role?: string }) {
    const stub = this.env.USER.get(this.env.USER.idFromName(email));
    await stub.fetch(`https://user/inbox/${op}`, {
      method: 'POST',
      body: JSON.stringify({
        ...extra,
        name: this.meta?.name,
        ownerName: this.meta?.ownerName,
      }),
    });
  }

  private info(role: Role) {
    const m = this.meta!;
    return {
      name: m.name,
      owner: { name: m.ownerName, email: m.ownerEmail },
      role,
      linkRole: m.linkRole,
      ...(role === 'owner' ? { linkKey: m.linkKey, members: m.members } : {}),
    };
  }

  private accept(email: string | null, name: string, key: string | null, role: Role): Response {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    // Newer compatibility dates default to Blob, which can't be decoded synchronously.
    server.binaryType = 'arraybuffer';
    const conn: Conn = { email, name, key, role, clientIds: new Set() };
    this.conns.set(server, conn);
    server.addEventListener('message', (ev) => this.onMessage(server, conn, ev.data));
    const gone = () => this.onClose(server, conn);
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);

    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc, this.doc);
    server.send(encoding.toUint8Array(enc));
    const states = this.awareness.getStates();
    if (states.size) {
      const a = encoding.createEncoder();
      encoding.writeVarUint(a, MSG_AWARENESS);
      encoding.writeVarUint8Array(
        a,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]),
      );
      server.send(encoding.toUint8Array(a));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  private onMessage(ws: WebSocket, conn: Conn, data: string | ArrayBuffer) {
    if (typeof data === 'string' || data.byteLength > MAX_MESSAGE) {
      ws.close(1009, 'Message too large');
      return;
    }
    try {
      const dec = decoding.createDecoder(new Uint8Array(data));
      const type = decoding.readVarUint(dec);
      if (type === MSG_SYNC) {
        const step = decoding.readVarUint(dec);
        if (step === syncProtocol.messageYjsSyncStep1) {
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, MSG_SYNC);
          syncProtocol.readSyncStep1(dec, enc, this.doc);
          ws.send(encoding.toUint8Array(enc));
        } else if (canWrite(conn.role)) {
          // The origin is the connection, so the persist step can tell a client's edit apart.
          Y.applyUpdate(this.doc, decoding.readVarUint8Array(dec), conn);
        }
        // Viewers' updates are dropped: reading is all a view link allows.
      } else if (type === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          decoding.readVarUint8Array(dec),
          conn,
        );
      }
    } catch (err) {
      console.error('bad message', err);
      ws.close(1007, 'Bad message');
    }
  }

  private onClose(ws: WebSocket, conn: Conn) {
    if (!this.conns.delete(ws)) return;
    awarenessProtocol.removeAwarenessStates(this.awareness, [...conn.clientIds], null);
    if (!this.conns.size) this.compact();
  }

  private broadcast(msg: Uint8Array) {
    for (const ws of this.conns.keys()) {
      try {
        ws.send(msg);
      } catch {
        /* closed sockets are removed by their close handler */
      }
    }
  }

  private record(email: string, name: string, delta: Op[], at = Date.now()) {
    if (!delta.length) return;
    const sql = this.ctx.storage.sql;
    const l = this.last;
    if (l && l.email === email && at - l.at <= MERGE_MS) {
      const merged = mergeOps(l.delta, delta);
      if (merged) {
        if (merged.length) {
          sql.exec(
            'UPDATE history SET at = ?, delta = ? WHERE id = ?',
            at,
            JSON.stringify(merged),
            l.id,
          );
          this.last = { ...l, at, delta: merged };
        } else {
          sql.exec('DELETE FROM history WHERE id = ?', l.id);
          this.rows--;
          this.last = null;
        }
        return;
      }
    }
    const id = Number(
      sql
        .exec(
          'INSERT INTO history (at, email, name, delta) VALUES (?, ?, ?, ?) RETURNING id',
          at,
          email,
          name,
          JSON.stringify(delta),
        )
        .one().id,
    );
    this.last = { id, at, email, delta };
    if (++this.rows > MAX_ROWS) this.fold();
  }

  private loadHistory(): { base: State; entries: Entry[] } {
    const sql = this.ctx.storage.sql;
    const b = [...sql.exec('SELECT state FROM base WHERE id = 1')][0];
    const base = b ? (JSON.parse(b.state as string) as State) : emptyState();
    const entries = [...sql.exec('SELECT at, email, name, delta FROM history ORDER BY id')].map(
      (r) => ({
        at: r.at as number,
        email: r.email as string,
        name: r.name as string,
        delta: JSON.parse(r.delta as string) as Op[],
      }),
    );
    return { base, entries };
  }

  /** Folds the oldest half of the recorded edits into the snapshot, keeping who wrote each character. */
  private fold() {
    try {
      const { base, entries } = this.loadHistory();
      const old = entries.slice(0, Math.floor(entries.length / 2));
      const upTo = Number(
        [
          ...this.ctx.storage.sql.exec(
            'SELECT id FROM history ORDER BY id LIMIT 1 OFFSET ?',
            old.length - 1,
          ),
        ][0]?.id,
      );
      const state = replay(base, old);
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          'INSERT OR REPLACE INTO base (id, state) VALUES (1, ?)',
          JSON.stringify(state),
        );
        this.ctx.storage.sql.exec('DELETE FROM history WHERE id <= ?', upTo);
      });
      this.rows -= old.length;
      if (this.last && this.last.id <= upTo) this.last = null;
    } catch (err) {
      // History is a record, not the document: never let it break editing.
      console.error('history fold failed', err);
    }
  }

  private persist(update: Uint8Array) {
    if (!this.meta) return;
    this.ctx.storage.sql.exec('INSERT INTO updates (data) VALUES (?)', buf(update));
    if (++this.sinceCompact >= COMPACT_EVERY) this.compact();
  }

  private compact() {
    this.sinceCompact = 0;
    const state = Y.encodeStateAsUpdate(this.doc);
    if (state.byteLength > MAX_STATE) {
      for (const [ws, c] of this.conns) if (canWrite(c.role)) ws.close(1009, 'Document too large');
      return;
    }
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec('DELETE FROM updates');
      this.ctx.storage.sql.exec('INSERT INTO updates (data) VALUES (?)', buf(state));
    });
  }

  /** After the access list changed: close connections that lost access or changed role. */
  private reauthorize() {
    for (const [ws, c] of this.conns) {
      const role = this.meta ? resolveRole(this.meta, c.email, c.key) : null;
      if (!role) ws.close(4403, 'Access removed');
      else if (role !== c.role) {
        c.role = role;
        ws.close(4000, 'Permissions changed');
      }
    }
  }
}
