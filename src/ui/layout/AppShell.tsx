import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { PanelLeft, Upload } from 'lucide-react';
import { useRouter, navigate } from '@/app/router';
import { useUi } from '@/app/ui-store';
import { useEditor } from '@/app/editor-store';
import { useSettings } from '@/app/settings-store';
import { itemsFromDataTransfer } from '@/app/importer';
import { runImport } from '@/app/actions';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { MobileNav } from './MobileNav';
import { CommandPalette, QuickOpen } from './Palette';
import { HomeView } from '../views/HomeView';
import { FolderView } from '../views/FolderView';
import { SearchView } from '../views/SearchView';
import { FavoritesView, RecentView, TagsView, TrashView } from '../views/ListViews';
import { SettingsView } from '../views/SettingsView';
import { useLayout } from '../hooks';
import { TREE_DRAG_TYPE } from './FileTree';
import { useGlobalShortcuts } from './shortcuts';

// The editor and Markdown renderer are the heaviest code; load them with the first document.
const DocumentView = lazy(() =>
  import('../document/DocumentView').then((m) => ({ default: m.DocumentView })),
);

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
  const hasTabs = useEditor((s) => s.tabs.length > 0);
  const density = useSettings((s) => s.density);
  const [width, setWidth] = useState(() => Number(localStorage.getItem(SIDEBAR_KEY)) || 264);
  const [fileDrag, setFileDrag] = useState(false);
  const dragDepth = useRef(0);
  useGlobalShortcuts();

  useEffect(() => {
    const reset = () => {
      dragDepth.current = 0;
      setFileDrag(false);
    };
    addEventListener('drop', reset, true);
    addEventListener('dragend', reset, true);
    return () => {
      removeEventListener('drop', reset, true);
      removeEventListener('dragend', reset, true);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

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
      className="flex h-full min-h-0 bg-canvas"
      onDragEnter={(e) => {
        if (!isFileDrag(e)) return;
        dragDepth.current++;
        setFileDrag(true);
      }}
      onDragLeave={(e) => {
        if (!isFileDrag(e)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setFileDrag(false);
      }}
      onDragOver={(e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={async (e) => {
        if (!isFileDrag(e)) return;
        // Reached only when no folder-specific drop zone handled it.
        e.preventDefault();
        const items = await itemsFromDataTransfer(e.dataTransfer);
        await runImport(items);
        if (route.name === 'home') navigate({ name: 'folder', id: null });
      }}
    >
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
                const w = Math.min(420, Math.max(200, width + (e.key === 'ArrowRight' ? 16 : -16)));
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
      {overlay === 'palette' && <CommandPalette />}
      {overlay === 'quickopen' && <QuickOpen />}
      {fileDrag && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-6 z-[55] flex justify-center px-4"
          aria-hidden
        >
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-primary bg-canvas px-5 py-3 shadow-2">
            <Upload size={18} className="text-primary" />
            <p className="text-[14px] text-ink">
              Drop to import. Drop onto a folder to import into it.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
