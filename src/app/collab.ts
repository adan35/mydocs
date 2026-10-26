import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import {
  YSyncConfig,
  yRemoteSelections,
  yRemoteSelectionsTheme,
  ySyncFacet,
} from 'y-codemirror.next';
import type { Transaction } from '@codemirror/state';
import type { EntryId } from '@/domain/types';
import { docModel, remoteChange } from './doc-model';
import { API_URL, ApiError, cloudAvailable, useAccount } from './cloud';
import { useCollab, type LiveState } from './collab-state';
import { editorActions, useEditor } from './editor-store';
import { fetchInfo, setBinding, useShares, type Binding } from './share';

const LOCAL = Symbol('local');
const COLORS = ['#e5484d', '#3e63dd', '#30a46c', '#f76b15', '#8e4ec6', '#0091ff', '#d6409f'];
const colorOf = (s: string) =>
  COLORS[([...s].reduce((n, c) => (n * 31 + c.charCodeAt(0)) | 0, 7) >>> 0) % COLORS.length]!;

interface Session {
  stopped: boolean;
  retry?: ReturnType<typeof setTimeout>;
  teardown: (() => void)[];
}
const sessions = new Map<EntryId, Session>();

function patch(id: EntryId, p: Partial<LiveState>) {
  useCollab.setState((s) => ({
    live: { ...s.live, [id]: { status: 'connecting', people: [], ...s.live[id], ...p } },
  }));
}

/** Resolves once the document's text is loaded into the editor store; false if it can't be. */
function loaded(id: EntryId): Promise<boolean> {
  return new Promise((resolve) => {
    const check = () => {
      const b = useEditor.getState().buffers[id];
      if (b && b.status !== 'loading') {
        off();
        resolve(b.status !== 'load-error');
      } else if (!useEditor.getState().tabs.includes(id)) {
        off();
        resolve(false);
      }
    };
    const off = useEditor.subscribe(check);
    check();
  });
}

async function start(id: EntryId, binding: Binding) {
  const s: Session = { stopped: false, teardown: [] };
  sessions.set(id, s);
  patch(id, { status: 'connecting', role: binding.role, message: undefined });
  if (!(await loaded(id)) || s.stopped) return stop(id);
  // Until the connection is live and allowed to write, nothing can fork the shared text.
  docModel.state(id, editorActions.textOf(id) ?? '');
  docModel.setLocked(id, true);

  const connect = async () => {
    if (s.stopped) return;
    let info;
    try {
      info = await fetchInfo(binding);
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 401)
        patch(id, { status: 'signin', message: 'Sign in to open this shared document.' });
      else if (status === 403 || status === 404)
        patch(id, { status: 'denied', message: 'You no longer have access to this document.' });
      else {
        patch(id, { status: 'offline', message: 'Reconnecting…' });
        s.retry = setTimeout(() => void connect(), 5000);
      }
      return;
    }
    if (s.stopped) return;
    const role = info.role;
    if (role !== binding.role) setBinding(id, { ...binding, role });
    patch(id, { role });

    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('text');
    const token = useAccount.getState().token;
    const provider = new WebsocketProvider(
      `${API_URL.replace(/^http/, 'ws')}/ws`,
      binding.id,
      ydoc,
      {
        params: { ...(token ? { token } : {}), ...(binding.key ? { k: binding.key } : {}) },
        disableBc: true,
      },
    );
    const me = useAccount.getState().user;
    provider.awareness.setLocalStateField('user', {
      name: me?.name ?? 'Guest',
      color: colorOf(me?.email ?? String(ydoc.clientID)),
    });
    let begun = false;
    const writable = role !== 'view';

    const begin = () => {
      begun = true;
      const text = ytext.toString();
      const cur = docModel.text(id) ?? '';
      // The shared text is the truth; this replaces whatever the local copy held.
      if (cur !== text)
        docModel.dispatchRemote(id, { changes: { from: 0, to: cur.length, insert: text } });
      const unsync = docModel.setSync(id, {
        local(trs: readonly Transaction[]) {
          for (const tr of trs) {
            if (!tr.docChanged || tr.annotation(remoteChange)) continue;
            ydoc.transact(() => {
              let adj = 0;
              tr.changes.iterChanges((fromA, toA, _fromB, _toB, insert) => {
                const added = insert.sliceString(0, insert.length, '\n');
                if (toA > fromA) ytext.delete(fromA + adj, toA - fromA);
                if (added) ytext.insert(fromA + adj, added);
                adj += added.length - (toA - fromA);
              });
            }, LOCAL);
          }
        },
      });
      const observer = (event: Y.YTextEvent, txn: Y.Transaction) => {
        if (txn.origin === LOCAL) return;
        const changes: { from: number; to: number; insert: string }[] = [];
        let pos = 0;
        for (const d of event.delta) {
          if (typeof d.insert === 'string') changes.push({ from: pos, to: pos, insert: d.insert });
          else if (d.delete) {
            changes.push({ from: pos, to: pos + d.delete, insert: '' });
            pos += d.delete;
          } else if (d.retain) pos += d.retain;
        }
        docModel.dispatchRemote(id, { changes });
      };
      ytext.observe(observer);
      docModel.setCollabExtension(id, [
        ySyncFacet.of(new YSyncConfig(ytext, provider.awareness)),
        yRemoteSelectionsTheme,
        yRemoteSelections,
      ]);
      s.teardown.push(unsync, () => ytext.unobserve(observer));
    };

    const people = () =>
      [...provider.awareness.getStates()]
        .filter(([cid, st]) => cid !== ydoc.clientID && st.user)
        .map(([, st]) => String((st.user as { name: string }).name));
    const onAwareness = () => patch(id, { people: people() });
    provider.awareness.on('change', onAwareness);

    const settle = () => {
      if (s.stopped) return;
      if (provider.wsconnected && provider.synced) {
        if (!begun) begin();
        docModel.setLocked(id, !writable);
        patch(id, { status: 'live', message: undefined, people: people() });
      } else if (begun || !provider.wsconnected) {
        docModel.setLocked(id, true);
        patch(id, {
          status: 'offline',
          message: 'Offline. Editing resumes when the connection returns.',
          people: [],
        });
      }
    };
    provider.on('sync', settle);
    provider.on('status', settle);
    provider.on('connection-close', (ev: CloseEvent | null) => {
      if (!ev || ev.code < 4000) return;
      // The server changed our access: stop here; a changed role reconnects with the new one.
      provider.destroy();
      if (ev.code === 4000 && !s.stopped) s.retry = setTimeout(() => void connect(), 500);
      else patch(id, { status: 'denied', message: 'You no longer have access to this document.' });
    });
    s.teardown.push(() => {
      provider.awareness.off('change', onAwareness);
      provider.destroy();
      ydoc.destroy();
    });
  };
  void connect();
}

function stop(id: EntryId) {
  const s = sessions.get(id);
  if (!s) return;
  s.stopped = true;
  clearTimeout(s.retry);
  for (const fn of s.teardown.reverse()) fn();
  sessions.delete(id);
  docModel.setCollabExtension(id, []);
  docModel.setLocked(id, false);
  useCollab.setState((st) => {
    const live = { ...st.live };
    delete live[id];
    return { live };
  });
}

/** Opens or closes live connections so exactly the open, shared documents have one. */
function reconcile() {
  if (!cloudAvailable) return;
  const { tabs } = useEditor.getState();
  const { bindings } = useShares.getState();
  for (const id of [...sessions.keys()]) {
    const b = bindings[id];
    if (!tabs.includes(id) || !b) stop(id);
  }
  for (const id of tabs) {
    const b = bindings[id];
    if (b && !sessions.has(id)) void start(id, b);
  }
}

useEditor.subscribe(reconcile);
useShares.subscribe(reconcile);
// A different account means different access: reconnect everything.
let lastToken = useAccount.getState().token;
useAccount.subscribe((a) => {
  if (a.token === lastToken) return;
  lastToken = a.token;
  for (const id of [...sessions.keys()]) stop(id);
  reconcile();
});
reconcile();
