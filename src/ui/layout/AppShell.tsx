import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { PanelLeft, Upload } from 'lucide-react';
import { useRouter, navigate } from '@/app/router';
import { useUi } from '@/app/ui-store';
import { useEditor } from '@/app/editor-store';
import { useSettings } from '@/app/settings-store';
import { itemsFromDataTransfer } from '@/app/importer';
import { contextFolderId, runImport } from '@/app/actions';
import { ws } from '@/app/app-store';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { MobileNav } from './MobileNav';
import { MenuBar } from './MenuBar';
import { CommandPalette, QuickOpen } from './Palette';
import { ShareLanding, SharedWithMe } from '../share/ShareViews';
import { HomeView } from '../views/HomeView';
import { FolderView } from '../views/FolderView';
import { SearchView } from '../views/SearchView';
import { FavoritesView, RecentView, TagsView, TrashView } from '../views/ListViews';
import { SettingsView } from '../views/SettingsView';
import { DownloadView } from '../views/DownloadView';
import { NotesView } from '../notes/NotesView';
import { NoteHost } from '../notes/NoteHost';
import { useNoteReminders } from '@/app/notes';
import { useAon } from '@/app/aon/chat';
import { useAonEnabled } from '@/app/aon/enabled';
import { useAonDialog } from '@/app/aon/dialog';
import { useLayout } from '../hooks';
import { TREE_DRAG_TYPE } from './FileTree';
import { useGlobalShortcuts } from './shortcuts';
import { closeMenu } from '../components/Menu';

// The editor and Markdown renderer are the heaviest code; load them with the first document.
const DocumentView = lazy(() =>
  import('../document/DocumentView').then((m) => ({ default: m.DocumentView })),
);

const HudhudFloat = lazy(() =>
  import('../aon/HudhudFloat').then((m) => ({ default: m.HudhudFloat })),
);

const AonPanel = lazy(() => import('../aon/AonPanel').then((m) => ({ default: m.AonPanel })));

const AonDialogs = lazy(() => import('../aon/AonDialogs').then((m) => ({ default: m.AonDialogs })));

// The graph is optional, so its code loads only when it's opened.
const GraphView = lazy(() => import('../views/GraphView').then((m) => ({ default: m.GraphView })));

function DocumentFallback() {
  return (
    <div
      className="mx-auto w-full max-w-[760px] space-y-3 px-6 py-16"
      aria-busy="true"
      aria-label="Loading document"
    >
      <div className="skeleton h-8 w-2/3" />
      <div className="skeleton h-4 w-full" />
      <div className="skeleton h-4 w-5/6" />
    </div>
  );
}

const SIDEBAR_KEY = 'mydoc:sidebar-width';

const isFileDrag = (e: React.DragEvent) =>
  e.dataTransfer.types.includes('Files') && !e.dataTransfer.types.includes(TREE_DRAG_TYPE);

/** What a file drop does where the pointer is: import into a folder, or attach to a doc. */
type DropHint = { attach: true } | { attach: false; folder: string };

function dropHintAt(target: EventTarget | null): DropHint {
  if (target instanceof Element && target.closest('[data-attach-drop]')) return { attach: true };
  const id = contextFolderId();
  return { attach: false, folder: (id && ws().get(id)?.name) || 'All files' };
}

const sameHint = (a: DropHint, b: DropHint) =>
  a.attach || b.attach ? a.attach === b.attach : a.folder === b.folder;

function DropOverlay({ hint }: { hint: DropHint }) {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[55] bg-[color-mix(in_srgb,var(--primary)_6%,transparent)] p-3 no-print"
      data-testid="drop-overlay"
      aria-hidden
    >
      <div className="flex h-full items-center justify-center rounded-xl border-2 border-dashed border-primary px-4">
        <div className="flex max-w-sm flex-col items-center gap-2 rounded-xl bg-canvas px-6 py-5 text-center shadow-2">
          <span className="flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary-soft-ink">
            <Upload size={20} aria-hidden />
          </span>
          {hint.attach ? (
            <>
              <p className="text-[16px] font-medium text-ink">Drop to attach to this document</p>
              <p className="text-caption text-steel">
                To import instead, drop onto a folder in the sidebar.
              </p>
            </>
          ) : (
            <>
              <p className="text-[16px] font-medium text-ink">Drop files or folders to import</p>
              <p className="text-caption text-steel">
                They go into <span className="font-medium text-ink">{hint.folder}</span>. Drop onto
                a folder in the sidebar to choose another.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RouteView() {
  const route = useRouter((s) => s.route);
  switch (route.name) {
    case 'doc':
      return (
        <Suspense fallback={<DocumentFallback />}>
          <DocumentView key="doc" id={route.id} anchor={route.anchor} />
        </Suspense>
      );
    case 'folder':
      return <FolderView key={route.id ?? 'root'} id={route.id} />;
    case 'search':
      return <SearchView q={route.q} />;
    case 'favorites':
      return <FavoritesView />;
    case 'recent':
      return <RecentView />;
    case 'tags':
      return <TagsView tag={route.tag} />;
    case 'trash':
      return <TrashView />;
    case 'settings':
      return <SettingsView />;
    case 'download':
      return <DownloadView />;
    case 'share':
      return <ShareLanding key={route.id} id={route.id} secret={route.key} />;
    case 'shared':
      return <SharedWithMe />;
    case 'notes':
      return <NotesView view={route.view} label={route.label} />;
    case 'graph':
      return (
        <Suspense fallback={<DocumentFallback />}>
          <GraphView focusId={route.id} />
        </Suspense>
      );
    default:
      return <HomeView />;
  }
}

export function AppShell() {
  const { phone, tablet } = useLayout();
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const drawerOpen = useUi((s) => s.drawerOpen);
  const overlay = useUi((s) => s.overlay);
  const focusMode = useUi((s) => s.focusMode);
  const readingMode = useUi((s) => s.readingMode);
  const route = useRouter((s) => s.route);
  const aonOn = useAonEnabled();
  const aonOpen = useAon((s) => s.open) && aonOn;
  const aonStarted = useAon((s) => s.messages.length > 0);
  const aonDialog = useAonDialog((s) => s.kind !== null) && aonOn;
  const hasTabs = useEditor((s) => s.tabs.length > 0);
  const density = useSettings((s) => s.density);
  const [width, setWidth] = useState(() => Number(localStorage.getItem(SIDEBAR_KEY)) || 264);
  const [fileDrag, setFileDrag] = useState<DropHint | null>(null);
  const dragDepth = useRef(0);
  useGlobalShortcuts();
  useNoteReminders();

  useEffect(() => {
    const reset = () => {
      dragDepth.current = 0;
      setFileDrag(null);
    };
    addEventListener('drop', reset, true);
    addEventListener('dragend', reset, true);
    // A dragged <img> carries its file ("Files" type), so dropping it back on the window re-imported it.
    const noImageDrag = (e: DragEvent) => {
      if (e.target instanceof HTMLImageElement) e.preventDefault();
    };
    addEventListener('dragstart', noImageDrag);
    return () => {
      removeEventListener('dragstart', noImageDrag);
      removeEventListener('drop', reset, true);
      removeEventListener('dragend', reset, true);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  // The Back button (Android, browser) closes the drawer, menus and palette with the page it leaves.
  useEffect(() => {
    const onPop = () => {
      const ui = useUi.getState();
      if (ui.drawerOpen) ui.setDrawer(false);
      if (ui.overlay) ui.setOverlay(null);
      closeMenu();
    };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  // Leaving a document exits focus/reading modes.
  useEffect(() => {
    if (route.name !== 'doc') {
      useUi.getState().setFocusMode(false);
      useUi.getState().setReadingMode(false);
    }
  }, [route.name]);

  const immersive = (focusMode || readingMode) && route.name === 'doc';
  const showSidebar = !phone && !tablet && sidebarOpen && !immersive;
  const showDrawer = (phone || tablet) && drawerOpen;

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-canvas"
      onDragEnter={(e) => {
        if (!isFileDrag(e)) return;
        dragDepth.current++;
        setFileDrag(dropHintAt(e.target));
      }}
      onDragLeave={(e) => {
        if (!isFileDrag(e)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setFileDrag(null);
      }}
      onDragOver={(e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        const hint = dropHintAt(e.target);
        setFileDrag((h) => (h && sameHint(h, hint) ? h : hint));
      }}
      onDrop={async (e) => {
        if (!isFileDrag(e)) return;
        // Reached only when no folder-specific drop zone handled it.
        e.preventDefault();
        const items = await itemsFromDataTransfer(e.dataTransfer);
        await runImport(items);
        // The import opens what it imported; only a still-empty Home goes to All files.
        if (useRouter.getState().route.name === 'home') navigate({ name: 'folder', id: null });
      }}
    >
      {!phone && !immersive && <MenuBar compact={tablet} />}
      <div className="flex min-h-0 flex-1">
        <a
          href="#main"
          onClick={(e) => {
            // The app uses hash routes, so following "#main" would leave the page.
            e.preventDefault();
            document.getElementById('main')?.focus();
          }}
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[90] focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-canvas"
        >
          Skip to content
        </a>
        {showSidebar && (
          <div className="relative shrink-0 border-r border-hairline no-print" style={{ width }}>
            <Sidebar />
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              tabIndex={0}
              className="absolute top-0 -right-1 z-10 h-full w-2 cursor-col-resize hover:bg-[color-mix(in_srgb,var(--primary)_25%,transparent)]"
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  const w = Math.min(
                    420,
                    Math.max(200, width + (e.key === 'ArrowRight' ? 16 : -16)),
                  );
                  setWidth(w);
                  localStorage.setItem(SIDEBAR_KEY, String(w));
                }
              }}
              onPointerDown={(e) => {
                const startX = e.clientX;
                const start = width;
                const move = (ev: PointerEvent) =>
                  setWidth(Math.min(420, Math.max(200, start + ev.clientX - startX)));
                const up = (ev: PointerEvent) => {
                  removeEventListener('pointermove', move);
                  removeEventListener('pointerup', up);
                  localStorage.setItem(
                    SIDEBAR_KEY,
                    String(Math.min(420, Math.max(200, start + ev.clientX - startX))),
                  );
                };
                addEventListener('pointermove', move);
                addEventListener('pointerup', up);
              }}
            />
          </div>
        )}
        {showDrawer && (
          <div
            className="fixed inset-0 z-40 flex"
            role="dialog"
            aria-modal="true"
            aria-label="Sidebar"
            onKeyDown={(e) => e.key === 'Escape' && useUi.getState().setDrawer(false)}
          >
            <div className="animate-drawer relative h-full w-[min(300px,86vw)] shadow-3">
              <Sidebar drawer onClose={() => useUi.getState().setDrawer(false)} />
            </div>
            <div
              className="flex-1 bg-[var(--scrim)]"
              onClick={() => useUi.getState().setDrawer(false)}
              aria-hidden
            />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          {!phone && hasTabs && !immersive && (
            <div className="flex shrink-0 items-stretch">
              {(tablet || !sidebarOpen) && (
                <button
                  type="button"
                  className="icon-btn m-1 self-center"
                  aria-label="Open sidebar"
                  onClick={() =>
                    tablet ? useUi.getState().setDrawer(true) : useUi.getState().setSidebar(true)
                  }
                >
                  <PanelLeft size={16} />
                </button>
              )}
              <div className="min-w-0 flex-1">
                <TabBar />
              </div>
            </div>
          )}
          {!phone && !hasTabs && route.name === 'doc' && (tablet || !sidebarOpen) && !immersive && (
            <button
              type="button"
              className="icon-btn m-1"
              aria-label="Open sidebar"
              onClick={() =>
                tablet ? useUi.getState().setDrawer(true) : useUi.getState().setSidebar(true)
              }
            >
              <PanelLeft size={16} />
            </button>
          )}
          <main id="main" className="min-h-0 flex-1 outline-none" tabIndex={-1}>
            <RouteView />
          </main>
          {phone && !immersive && <MobileNav />}
        </div>
        {/* In the row, beside the document: the menu bar above makes the root a column. */}
        {aonOpen && (
          <Suspense fallback={null}>
            <AonPanel />
          </Suspense>
        )}
        {aonOn && !aonOpen && aonStarted && (
          <Suspense fallback={null}>
            <HudhudFloat />
          </Suspense>
        )}
      </div>
      {overlay === 'palette' && <CommandPalette />}
      {overlay === 'quickopen' && <QuickOpen />}
      <NoteHost />
      {aonDialog && (
        <Suspense fallback={null}>
          <AonDialogs />
        </Suspense>
      )}
      {fileDrag && <DropOverlay hint={fileDrag} />}
    </div>
  );
}
