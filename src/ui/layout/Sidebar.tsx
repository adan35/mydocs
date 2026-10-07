import {
  Check,
  ChevronsUpDown,
  Clock,
  FilePlus2,
  FolderPlus,
  Hash,
  Home,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  Star,
  Trash2,
  LayoutTemplate,
  Network,
  Upload,
  Keyboard,
  PencilLine,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useApp } from '@/app/app-store';
import { useRouter, navigate, type Route } from '@/app/router';
import { useUi } from '@/app/ui-store';
import { SHORTCUTS } from '@/app/shortcuts';
import { dialogs } from '@/app/dialog-store';
import * as A from '@/app/actions';
import { openMenuAt, type MenuEntry } from '../components/Menu';
import { FileIcon } from '../components/FileIcon';
import { formatShortcut, useTree } from '../hooks';
import { importSubmenu } from '../entry-menu';
import { FileTree } from './FileTree';

export function Sidebar({ onClose, drawer }: { onClose?: () => void; drawer?: boolean }) {
  const tree = useTree()!;
  const route = useRouter((s) => s.route);
  const trashCount = tree.trashedRoots().length;
  const favorites = tree
    .liveEntries()
    .filter((e) => e.favorite)
    .slice(0, 12);

  return (
    <nav aria-label="Workspace" className="flex h-full min-h-0 flex-col bg-sidebar text-charcoal">
      <div className="flex items-center gap-1 px-2 pt-2 pb-1">
        <WorkspaceSwitcher />
        {drawer ? (
          <button type="button" className="icon-btn" aria-label="Close sidebar" onClick={onClose}>
            <X size={16} />
          </button>
        ) : (
          <button
            type="button"
            className="icon-btn"
            aria-label="Collapse sidebar"
            title={`Collapse sidebar (${formatShortcut(SHORTCUTS.toggleSidebar)})`}
            onClick={() => useUi.getState().setSidebar(false)}
          >
            <PanelLeftClose size={16} />
          </button>
        )}
      </div>

      <div className="px-2 pb-2">
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[14px] text-steel hover:bg-hover"
          onClick={() => useUi.getState().setOverlay('quickopen')}
        >
          <Search size={16} aria-hidden />
          <span className="flex-1 text-left">Search</span>
          <kbd className="kbd">{formatShortcut(SHORTCUTS.quickOpen)}</kbd>
        </button>
        <NavItem
          icon={<Home size={16} />}
          label="Home"
          route={{ name: 'home' }}
          current={route.name === 'home'}
        />
        <NavItem
          icon={<Clock size={16} />}
          label="Recent"
          route={{ name: 'recent' }}
          current={route.name === 'recent'}
        />
        <NavItem
          icon={<Star size={16} />}
          label="Favorites"
          route={{ name: 'favorites' }}
          current={route.name === 'favorites'}
        />
        <NavItem
          icon={<Hash size={16} />}
          label="Tags"
          route={{ name: 'tags' }}
          current={route.name === 'tags'}
        />
        <NavItem
          icon={<Network size={16} />}
          label="Graph"
          route={{ name: 'graph' }}
          current={route.name === 'graph'}
        />
        <button
          type="button"
          className="flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover"
          onClick={() => {
            useUi.getState().setDrawer(false);
            void A.newFromTemplate();
          }}
        >
          <span className="text-steel" aria-hidden>
            <LayoutTemplate size={16} />
          </span>
          <span className="flex-1">Templates</span>
        </button>
        <NavItem
          icon={<Trash2 size={16} />}
          label="Trash"
          route={{ name: 'trash' }}
          current={route.name === 'trash'}
          badge={trashCount || undefined}
        />
      </div>

      {favorites.length > 0 && (
        <div className="px-2 pb-2">
          <div className="section-label px-2 pt-2 pb-1">Favorites</div>
          {favorites.map((e) => (
            <button
              key={e.id}
              type="button"
              className="flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover"
              onClick={() => void A.openEntry(e.id)}
              title={tree.pathOf(e.id)}
            >
              <FileIcon entry={e} className="shrink-0 text-steel" />
              <span className="truncate">{e.name}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-0.5 px-2 pt-1 pb-1">
        <button
          type="button"
          className="section-label flex-1 rounded px-2 py-1 text-left hover:text-steel"
          onClick={() => navigate({ name: 'folder', id: null })}
        >
          Files
        </button>
        <button
          type="button"
          className="icon-btn !h-6 !w-6"
          aria-label="Import"
          title="Import files or folders"
          onClick={(e) => openMenuAt(e.currentTarget, importSubmenu(null), 'Import')}
        >
          <Upload size={14} />
        </button>
        <button
          type="button"
          className="icon-btn !h-6 !w-6"
          aria-label="New folder"
          title={`New folder (${formatShortcut(SHORTCUTS.newFolder)})`}
          onClick={() => void A.newFolder(null)}
        >
          <FolderPlus size={14} />
        </button>
        <button
          type="button"
          className="icon-btn !h-6 !w-6"
          aria-label="New document"
          title={`New document (${formatShortcut(SHORTCUTS.newDoc)})`}
          onClick={() => void A.newDocument(null)}
        >
          <Plus size={15} />
        </button>
      </div>
      <FileTree />

      <div className="border-t border-hairline px-2 py-2">
        <button
          type="button"
          className="btn btn-ghost h-8 w-full justify-start gap-2 px-2 font-normal"
          onClick={() => void A.newDocument()}
        >
          <FilePlus2 size={16} className="text-steel" aria-hidden /> New document
        </button>
        <NavItem
          icon={<Settings size={16} />}
          label="Settings"
          route={{ name: 'settings' }}
          current={route.name === 'settings'}
        />
      </div>
    </nav>
  );
}

function NavItem({
  icon,
  label,
  route,
  current,
  badge,
}: {
  icon: ReactNode;
  label: string;
  route: Route;
  current: boolean;
  badge?: number;
}) {
  return (
    <button
      type="button"
      aria-current={current ? 'page' : undefined}
      className={`flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-[14px] ${current ? 'bg-active font-medium text-ink' : 'hover:bg-hover'}`}
      onClick={() => {
        useUi.getState().setDrawer(false);
        navigate(route);
      }}
    >
      <span className="text-steel" aria-hidden>
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      {badge !== undefined && <span className="text-xs text-stone">{badge}</span>}
    </button>
  );
}

function WorkspaceSwitcher() {
  const workspaces = useApp((s) => s.workspaces);
  const session = useApp((s) => s.session);
  useApp((s) => s.treeVersion);
  const current = session?.workspace;
  const items: MenuEntry[] = [
    ...workspaces.map((w) => ({
      label: w.name,
      icon: w.id === current?.id ? <Check /> : <span />,
      onSelect: () => void A.switchWorkspace(w.id),
    })),
    'separator',
    { label: 'New workspace…', icon: <Plus />, onSelect: () => void A.newWorkspace() },
    { label: 'Rename workspace…', icon: <PencilLine />, onSelect: () => void A.renameWorkspace() },
    { label: 'Keyboard shortcuts', icon: <Keyboard />, onSelect: () => void dialogs.shortcuts() },
    { label: 'Settings', icon: <Settings />, onSelect: () => navigate({ name: 'settings' }) },
  ];
  return (
    <button
      type="button"
      className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 hover:bg-hover"
      aria-label={`Workspace: ${current?.name}. Switch workspace`}
      onClick={(e) => openMenuAt(e.currentTarget, items, 'Workspaces')}
    >
      <span
        className="flex size-6 shrink-0 items-center justify-center rounded-md bg-ink text-[12px] font-semibold text-canvas"
        aria-hidden
      >
        {current?.name.trim().charAt(0).toUpperCase() || 'M'}
      </span>
      <span className="truncate text-[14px] font-semibold text-ink">{current?.name}</span>
      <ChevronsUpDown size={14} className="shrink-0 text-stone" aria-hidden />
    </button>
  );
}
