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
  Users,
  LayoutTemplate,
  Command,
  Sparkles,
  Network,
  Upload,
  Keyboard,
  PencilLine,
  StickyNote,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { EntryId } from '@/domain/types';
import { useApp } from '@/app/app-store';
import { useRouter, navigate, type Route } from '@/app/router';
import { cloudAvailable } from '@/app/cloud';
import { useUi } from '@/app/ui-store';
import { SHORTCUTS } from '@/app/shortcuts';
import { dialogs } from '@/app/dialog-store';
import * as A from '@/app/actions';
import { toggleAon } from '@/app/aon/chat';
import { useAonEnabled } from '@/app/aon/enabled';
import { openMenuAt, type MenuEntry } from '../components/Menu';
import { FileIcon } from '../components/FileIcon';
import { formatShortcut, useTree } from '../hooks';
import { importSubmenu } from '../entry-menu';
import { FileTree, useEntryDrop } from './FileTree';
import { fuzzyScore } from '../components/fuzzy';
import { ThemeToggle } from '../components/ThemeToggle';
import { ThemeMenuButton } from '../components/ThemePicker';

export function Sidebar({ onClose, drawer }: { onClose?: () => void; drawer?: boolean }) {
  const tree = useTree()!;
  const route = useRouter((s) => s.route);
  const aonOn = useAonEnabled();
  const trashCount = tree.trashedRoots().length;
  const favorites = tree
    .liveEntries()
    .filter((e) => e.favorite)
    .slice(0, 12);
  const addFavorite = (ids: EntryId[]) => void A.favoriteEntries(ids, true);
  const favDrop = useEntryDrop(addFavorite);
  // Height of the menu list above Files; null = as tall as it needs. Dragging it up gives Files room.
  const [navHeight, setNavHeight] = useState<number | null>(
    () => Number(localStorage.getItem(NAV_HEIGHT_KEY)) || null,
  );
  const navRef = useRef<HTMLDivElement>(null);
  const resizeNav = (h: number | null) => {
    setNavHeight(h);
    if (h) localStorage.setItem(NAV_HEIGHT_KEY, String(h));
    else localStorage.removeItem(NAV_HEIGHT_KEY);
  };
  const [filter, setFilter] = useState<string | null>(null);
  const filterRequest = useUi((s) => s.sidebarFind);
  const filterRef = useRef<HTMLInputElement>(null);
  const seenRequest = useRef(filterRequest);
  useEffect(() => {
    if (filterRequest === seenRequest.current) return;
    seenRequest.current = filterRequest;
    setFilter((f) => f ?? '');
    setTimeout(() => filterRef.current?.select(), 0);
  }, [filterRequest]);

  return (
    <nav aria-label="Workspace" className="flex h-full min-h-0 flex-col bg-sidebar text-charcoal">
      <div className="flex items-center gap-1 px-2 pt-2 pb-1">
        <WorkspaceSwitcher />
        <ThemeToggle />
        <ThemeMenuButton />
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

      <div
        ref={navRef}
        className="scroll-area min-h-12 shrink-0"
        style={{ height: navHeight ?? undefined, maxHeight: 'calc(100% - 9rem)' }}
      >
        <div className="px-2 pt-1 pb-2">
          <button
            type="button"
            className="sidebar-new mb-1.5"
            aria-label="New document"
            title={`New document (${formatShortcut(SHORTCUTS.newDoc)})`}
            onClick={(e) => {
              useUi.getState().setDrawer(false);
              void A.chooseNewDocument(undefined, e.shiftKey);
            }}
          >
            <FilePlus2 size={16} aria-hidden />
            <span className="flex-1 text-left">New document</span>
            <kbd className="hidden text-xs opacity-75 md:inline">
              {formatShortcut(SHORTCUTS.newDoc)}
            </kbd>
          </button>
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
            onDropEntry={addFavorite}
          />
          <NavItem
            icon={<StickyNote size={16} />}
            label="Notes"
            route={{ name: 'notes' }}
            current={route.name === 'notes'}
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
          {cloudAvailable && (
            <NavItem
              icon={<Users size={16} />}
              label="Shared with me"
              route={{ name: 'shared' }}
              current={route.name === 'shared'}
            />
          )}
          <button
            type="button"
            className="nav-item flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover"
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
          {aonOn && (
            <button
              type="button"
              className="nav-item flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover"
              onClick={() => {
                useUi.getState().setDrawer(false);
                toggleAon();
              }}
            >
              <span className="text-steel" aria-hidden>
                <Sparkles size={16} />
              </span>
              <span className="flex-1">Ask AON</span>
              <kbd className="kbd hidden md:inline-flex">{formatShortcut(SHORTCUTS.aon)}</kbd>
            </button>
          )}
          <button
            type="button"
            className="nav-item flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover"
            onClick={() => {
              useUi.getState().setDrawer(false);
              useUi.getState().setOverlay('palette');
            }}
          >
            <span className="text-steel" aria-hidden>
              <Command size={16} />
            </span>
            <span className="flex-1">Commands</span>
            <kbd className="kbd hidden md:inline-flex">{formatShortcut(SHORTCUTS.palette)}</kbd>
          </button>
          <NavItem
            icon={<Trash2 size={16} />}
            label="Trash"
            route={{ name: 'trash' }}
            current={route.name === 'trash'}
            badge={trashCount || undefined}
            onDropEntry={(ids) => void A.trashEntries(ids)}
          />
        </div>

        {favorites.length > 0 && (
          <div
            className={`mx-2 mb-2 rounded-md ${favDrop.over ? 'drop-target' : ''}`}
            {...favDrop.props}
          >
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
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize file list"
        title="Drag to give the file list more room. Double-click to reset."
        tabIndex={0}
        className="h-1.5 shrink-0 cursor-row-resize border-t border-hairline hover:bg-[color-mix(in_srgb,var(--primary)_25%,transparent)]"
        onDoubleClick={() => resizeNav(null)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          const h = navRef.current?.offsetHeight ?? 0;
          resizeNav(Math.max(48, h + (e.key === 'ArrowDown' ? 24 : -24)));
        }}
        onPointerDown={(e) => {
          e.preventDefault(); // no text selection while dragging
          const startY = e.clientY;
          const start = navRef.current?.offsetHeight ?? 0;
          let last = start;
          const move = (ev: PointerEvent) => {
            last = Math.max(48, start + ev.clientY - startY);
            setNavHeight(last);
          };
          const up = () => {
            removeEventListener('pointermove', move);
            removeEventListener('pointerup', up);
            resizeNav(last);
          };
          addEventListener('pointermove', move);
          addEventListener('pointerup', up);
        }}
      />

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
          className="icon-btn icon-btn-sm"
          aria-label="Import"
          title="Import files or folders"
          onClick={(e) => openMenuAt(e.currentTarget, importSubmenu(null), 'Import')}
        >
          <Upload size={14} />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn-sm"
          aria-label="New folder"
          title={`New folder (${formatShortcut(SHORTCUTS.newFolder)})`}
          onClick={() => void A.newFolder(null)}
        >
          <FolderPlus size={14} />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn-sm"
          aria-label="New document"
          title={`New document (${formatShortcut(SHORTCUTS.newDoc)})`}
          onClick={(e) => void A.chooseNewDocument(null, e.shiftKey)}
        >
          <Plus size={15} />
        </button>
      </div>
      {filter !== null && (
        <div className="px-2 pb-1">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-steel"
              aria-hidden
            />
            <input
              ref={filterRef}
              autoFocus
              type="search"
              className="input h-8 pr-8 pl-8 text-[14px]"
              placeholder="Find a file"
              aria-label="Find a file"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setFilter(null);
                }
              }}
            />
            <button
              type="button"
              className="icon-btn icon-btn-sm absolute top-1/2 right-1 -translate-y-1/2"
              aria-label="Close file search"
              onClick={() => setFilter(null)}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
      {filter?.trim() ? (
        <FileMatches query={filter.trim()} onPick={() => useUi.getState().setDrawer(false)} />
      ) : (
        <FileTree />
      )}

      <div className="border-t border-hairline px-2 py-2">
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
  onDropEntry,
}: {
  icon: ReactNode;
  label: string;
  route: Route;
  current: boolean;
  badge?: number;
  /** Makes the item a drop target for dragged files and folders. */
  onDropEntry?: (ids: EntryId[]) => void;
}) {
  const drop = useEntryDrop((ids) => onDropEntry?.(ids));
  return (
    <button
      type="button"
      aria-current={current ? 'page' : undefined}
      className={`nav-item flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-[14px] ${current ? 'bg-active font-medium text-ink' : 'hover:bg-hover'} ${drop.over ? 'drop-target' : ''}`}
      {...(onDropEntry ? drop.props : {})}
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

const NAV_HEIGHT_KEY = 'mydoc:sidebar-nav-height';

/** Files and folders whose name matches, best first, with where each one lives. */
function FileMatches({ query, onPick }: { query: string; onPick(): void }) {
  const tree = useTree()!;
  const matches = tree
    .liveEntries()
    .map((entry) => ({ entry, hit: fuzzyScore(query, entry.name) }))
    .filter((m) => m.hit)
    .sort((a, b) => b.hit!.score - a.hit!.score)
    .slice(0, 100);
  return (
    <div
      className="scroll-area min-h-0 flex-1 px-1.5 pb-6"
      role="listbox"
      aria-label="Matching files"
    >
      {matches.length === 0 && <p className="px-2 py-3 text-caption text-steel">No files match.</p>}
      {matches.map(({ entry }) => (
        <button
          key={entry.id}
          type="button"
          role="option"
          aria-selected={false}
          className="flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover"
          title={tree.pathOf(entry.id)}
          onClick={() => {
            onPick();
            if (entry.kind === 'folder') navigate({ name: 'folder', id: entry.id });
            else void A.openEntry(entry.id);
          }}
        >
          <FileIcon entry={entry} className="shrink-0 text-steel" />
          <span className="truncate">{entry.name}</span>
          <span className="ml-auto truncate pl-2 text-xs text-stone">
            {tree.pathOf(entry.id).split('/').slice(0, -1).join('/')}
          </span>
        </button>
      ))}
    </div>
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
