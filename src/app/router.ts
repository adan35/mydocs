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

export const useRouter = create<RouterState>(() => ({
  route: parseHash(typeof location !== 'undefined' ? location.hash : ''),
  navigate(r, opts) {
    const hash = routeToHash(r);
    if (location.hash === hash) {
      useRouter.setState({ route: r });
      return;
    }
    if (opts?.replace) history.replaceState(null, '', hash);
    else history.pushState(null, '', hash);
    useRouter.setState({ route: r });
  },
}));

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () =>
    useRouter.setState({ route: parseHash(location.hash) }),
  );
  window.addEventListener('hashchange', () =>
    useRouter.setState({ route: parseHash(location.hash) }),
  );
}

export const navigate = (r: Route, opts?: { replace?: boolean }) =>
  useRouter.getState().navigate(r, opts);
