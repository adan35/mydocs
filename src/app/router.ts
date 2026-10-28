import { create } from 'zustand';

/** Hash routes keep the app a static SPA that works from any host or file. */
export type Route =
  | { name: 'home' }
  | { name: 'doc'; id: string; anchor?: string }
  | { name: 'folder'; id: string | null }
  | { name: 'search'; q: string }
  | { name: 'favorites' }
  | { name: 'recent' }
  | { name: 'tags'; tag?: string }
  | { name: 'trash' }
  | { name: 'settings' }
  | { name: 'download' }
  /** A link someone sent: opens a live-shared document. */
  | { name: 'share'; id: string; key?: string }
  /** Documents other people shared with this user. */
  | { name: 'shared' }
  /** Keep-style notes; `view` picks Reminders, Archive or Trash, `label` one label. */
  | { name: 'notes'; view?: 'reminders' | 'archive' | 'trash'; label?: string }
  /** `id` shows the local graph around one document. */
  | { name: 'graph'; id?: string };

export function parseHash(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const params = new URLSearchParams(query);
  const [head, ...rest] = path.split('/').map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  switch (head) {
    case 'doc':
      return rest[0]
        ? { name: 'doc', id: rest[0], anchor: params.get('h') ?? undefined }
        : { name: 'home' };
    case 'folder':
      return { name: 'folder', id: rest[0] || null };
    case 'search':
      return { name: 'search', q: params.get('q') ?? '' };
    case 'favorites':
      return { name: 'favorites' };
    case 'recent':
      return { name: 'recent' };
    case 'tags':
      return { name: 'tags', tag: rest.join('/') || undefined };
    case 'trash':
      return { name: 'trash' };
    case 'settings':
      return { name: 'settings' };
    case 'download':
      return { name: 'download' };
    case 's':
      return rest[0]
        ? { name: 'share', id: rest[0], key: params.get('k') ?? undefined }
        : { name: 'home' };
    case 'shared':
      return { name: 'shared' };
    case 'notes':
      if (rest[0] === 'label' && rest[1]) return { name: 'notes', label: rest.slice(1).join('/') };
      return rest[0] === 'reminders' || rest[0] === 'archive' || rest[0] === 'trash'
        ? { name: 'notes', view: rest[0] }
        : { name: 'notes' };
    case 'graph':
      return rest[0] ? { name: 'graph', id: rest[0] } : { name: 'graph' };
    default:
      return { name: 'home' };
  }
}

export function routeToHash(r: Route): string {
  switch (r.name) {
    case 'doc':
      return `#/doc/${encodeURIComponent(r.id)}${r.anchor ? `?h=${encodeURIComponent(r.anchor)}` : ''}`;
    case 'folder':
      return r.id ? `#/folder/${encodeURIComponent(r.id)}` : '#/folder';
    case 'search':
      return `#/search?q=${encodeURIComponent(r.q)}`;
    case 'tags':
      return r.tag ? `#/tags/${r.tag.split('/').map(encodeURIComponent).join('/')}` : '#/tags';
    case 'share':
      return `#/s/${encodeURIComponent(r.id)}${r.key ? `?k=${encodeURIComponent(r.key)}` : ''}`;
    case 'notes':
      return r.label
        ? `#/notes/label/${encodeURIComponent(r.label)}`
        : r.view
          ? `#/notes/${r.view}`
          : '#/notes';
    case 'home':
      return '#/';
    case 'graph':
      return r.id ? `#/graph/${encodeURIComponent(r.id)}` : '#/graph';
    default:
      return `#/${r.name}`;
  }
}

interface RouterState {
  route: Route;
  navigate(r: Route, opts?: { replace?: boolean }): void;
}

/** Position in this tab's in-app history, kept in history.state so Back never leaves the app. */
const pos = () => (history.state as { i?: number } | null)?.i ?? 0;
let last = typeof history !== 'undefined' ? pos() : 0;

export const useRouter = create<RouterState>(() => ({
  route: parseHash(typeof location !== 'undefined' ? location.hash : ''),
  navigate(r, opts) {
    const hash = routeToHash(r);
    if (location.hash === hash) {
      useRouter.setState({ route: r });
      return;
    }
    if (opts?.replace) history.replaceState({ i: pos() }, '', hash);
    else history.pushState({ i: pos() + 1 }, '', hash);
    last = pos();
    useRouter.setState({ route: r });
  },
}));

if (typeof window !== 'undefined') {
  const sync = () => {
    // An entry made outside navigate() (typed URL, plain link) has no index yet: it is one step ahead.
    if (!history.state) history.replaceState({ i: last + 1 }, '');
    last = pos();
    useRouter.setState({ route: parseHash(location.hash) });
  };
  window.addEventListener('popstate', sync);
  window.addEventListener('hashchange', sync);
}

export const navigate = (r: Route, opts?: { replace?: boolean }) =>
  useRouter.getState().navigate(r, opts);

/** Steps back through in-app history; false when there is nowhere to go (never exits the app). */
export function goBack(): boolean {
  if (pos() <= 0) return false;
  history.back();
  return true;
}

/** A no-op when there is no forward entry. */
export const goForward = () => history.forward();
