import { monthKey, nextMonthStart, settle, tryReserve } from './access';

interface InboxItem {
  name: string;
  ownerName: string;
  role: string;
  at: number;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Per-user state, keyed by email: documents shared with them and their AI token usage. */
export class UserState implements DurableObject {
  constructor(private ctx: DurableObjectState) {}

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const s = this.ctx.storage;
    const b = req.method === 'POST' ? ((await req.json()) as Record<string, unknown>) : {};

    switch (url.pathname) {
      case '/inbox/add': {
        const inbox = (await s.get<Record<string, InboxItem>>('inbox')) ?? {};
        if (Object.keys(inbox).length >= 500 && !inbox[String(b.id)])
          return json({ error: 'Inbox full' }, 400);
        inbox[String(b.id)] = {
          name: String(b.name ?? ''),
          ownerName: String(b.ownerName ?? ''),
          role: String(b.role ?? 'view'),
          at: Date.now(),
        };
        await s.put('inbox', inbox);
        return json({ ok: true });
      }
      case '/inbox/remove': {
        const inbox = (await s.get<Record<string, InboxItem>>('inbox')) ?? {};
        delete inbox[String(b.id)];
        await s.put('inbox', inbox);
        return json({ ok: true });
      }
      case '/inbox': {
        const inbox = (await s.get<Record<string, InboxItem>>('inbox')) ?? {};
        return json(
          Object.entries(inbox)
            .map(([id, v]) => ({ id, ...v }))
            .sort((a, c) => c.at - a.at),
        );
      }
      case '/ai/usage': {
        const used = (await s.get<number>(`ai:${monthKey()}`)) ?? 0;
        return json({ used, resetsAt: nextMonthStart() });
      }
      // The DO handles one request at a time, so reserve and settle can't race.
      case '/ai/reserve': {
        const key = `ai:${monthKey()}`;
        const used = (await s.get<number>(key)) ?? 0;
        const r = tryReserve(used, Number(b.limit), Number(b.want));
        if (r.ok) await s.put(key, r.used);
        return json({ ok: r.ok, used: r.used, key });
      }
      case '/ai/settle': {
        const key = String(b.key);
        const used = (await s.get<number>(key)) ?? 0;
        const next = settle(used, Number(b.reserved), Number(b.actual));
        await s.put(key, next);
        return json({ used: next });
      }
    }
    return json({ error: 'Not found' }, 404);
  }
}
