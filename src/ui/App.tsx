import { useEffect } from 'react';
import { appActions, useApp } from '@/app/app-store';
import { editorActions, writeRecoveryDrafts } from '@/app/editor-store';
import { diskLinks, useDiskLinks } from '@/app/disk-links';
import { useRouter, navigate } from '@/app/router';
import { ownership } from '@/app/ownership';
import { AppShell } from './layout/AppShell';
import { DialogHost } from './dialogs/DialogHost';
import { MenuHost } from './components/Menu';
import { Toaster } from './components/Toaster';
import { useResolvedTheme } from './hooks';
import { installNativeLinkHandler, onBeforeQuit } from '@/platform';
import { useUi } from '@/app/ui-store';

function useThemeAttribute() {
  const theme = useResolvedTheme();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((m) => m.setAttribute('content', theme === 'dark' ? '#191919' : '#ffffff'));
  }, [theme]);
}

/** Wires the workspace to the editor and protects unsaved work across reloads and crashes. */
function useLifecycle() {
  const session = useApp((s) => s.session);
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const workspace = session.workspace;
    void diskLinks.load(workspace.id, (id) => !!workspace.get(id));
    void editorActions.restoreSession().then(() => {
      if (cancelled) return;
      // Validate the deep-linked document after restore.
      const route = useRouter.getState().route;
      if (route.name === 'doc' && !session.workspace.get(route.id))
        navigate({ name: 'home' }, { replace: true });
    });
    const unsub = session.workspace.subscribe((e) => {
      if (e.type === 'content' && e.source === 'external') editorActions.onExternalContent(e.ids);
      if (e.type === 'tree') editorActions.onTreeChange();
      // Every saved change to a linked document is written back to its file on disk.
      if (e.type === 'content') {
        for (const id of e.ids) {
          const text = diskLinks.isLinked(id) ? workspace.allTexts().get(id) : undefined;
          if (text !== undefined) void diskLinks.write(id, text);
        }
      }
      if (e.type === 'tree') {
        for (const id of Object.keys(useDiskLinks.getState().links)) {
          if (!workspace.get(id)) void diskLinks.unlink(id);
        }
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [session]);

  // Another tab asked to take over: save everything, then step back.
  useEffect(
    () =>
      ownership.onTakeover(async () => {
        await editorActions.flushAll();
        writeRecoveryDrafts();
        useUi.getState().setOverlay(null);
        editorActions.reset();
        appActions.relinquish();
      }),
    [],
  );

  useEffect(() => {
    const protect = () => {
      writeRecoveryDrafts();
      void editorActions.flushAll();
    };
    const onHide = () => document.visibilityState === 'hidden' && protect();
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!editorActions.hasUnsaved()) return;
      protect();
      e.preventDefault();
    };
    document.addEventListener('visibilitychange', onHide);
    addEventListener('pagehide', protect);
    addEventListener('beforeunload', onBeforeUnload);
    // Desktop windows can close without a reliable pagehide, so save explicitly first.
    const offQuit = onBeforeQuit(() => {
      writeRecoveryDrafts();
      return editorActions.flushAll();
    });
    return () => {
      offQuit();
      document.removeEventListener('visibilitychange', onHide);
      removeEventListener('pagehide', protect);
      removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  useEffect(() => installNativeLinkHandler(), []);

  // Printing / "Export as PDF" prints only the rendered document.
  useEffect(() => {
    const before = () => {
      const source = document.querySelector('.print-source .prose');
      if (!source) return;
      const root = document.createElement('div');
      root.id = 'print-root';
      root.append(source.cloneNode(true));
      document.body.append(root);
    };
    const after = () => document.getElementById('print-root')?.remove();
    addEventListener('beforeprint', before);
    addEventListener('afterprint', after);
    return () => {
      removeEventListener('beforeprint', before);
      removeEventListener('afterprint', after);
    };
  }, []);
}

export function App() {
  const phase = useApp((s) => s.phase);
  const error = useApp((s) => s.error);
  useThemeAttribute();
  useLifecycle();

  useEffect(() => {
    void appActions.init();
  }, []);

  if (phase === 'error') {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="card max-w-md p-8 text-center">
          <h1 className="text-[18px] font-semibold text-ink">My Doc can't open its storage</h1>
          <p className="mt-2 text-[14px] text-slate">{error}</p>
          <p className="mt-2 text-caption text-steel">
            Check that this site is allowed to store data, or try a regular (non-private) window.
          </p>
          <button
            type="button"
            className="btn btn-primary mt-6"
            onClick={() => void appActions.init()}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'elsewhere') {
    return (
      <main className="flex h-full items-center justify-center bg-canvas p-6">
        <div className="card max-w-md p-8 text-center">
          <h1 className="text-[18px] font-semibold text-ink">My Doc is open in another tab</h1>
          <p className="mt-2 text-[14px] text-slate">
            To keep your documents safe, My Doc works in one tab at a time. Your changes from the
            other tab are saved.
          </p>
          <button
            type="button"
            autoFocus
            className="btn btn-primary mt-6"
            onClick={() => void appActions.takeOver()}
          >
            Use here
          </button>
        </div>
      </main>
    );
  }

  if (phase === 'loading') {
    return (
      <div className="flex h-full" aria-busy="true" aria-label="Loading My Doc">
        <div className="hidden w-[264px] shrink-0 space-y-3 border-r border-hairline bg-sidebar p-4 md:block">
          <div className="skeleton h-7 w-40" />
          <div className="skeleton h-5 w-full" />
          <div className="skeleton h-5 w-5/6" />
          <div className="skeleton h-5 w-4/6" />
        </div>
        <div className="flex-1 space-y-4 p-10">
          <div className="skeleton h-9 w-72" />
          <div className="skeleton h-4 w-full max-w-xl" />
          <div className="skeleton h-4 w-full max-w-lg" />
        </div>
      </div>
    );
  }

  return (
    <>
      <AppShell />
      <DialogHost />
      <MenuHost />
      <Toaster />
    </>
  );
}
