import { useEffect } from 'react';
import { matches, SHORTCUTS } from '@/app/shortcuts';
import { useUi } from '@/app/ui-store';
import { useRouter, navigate } from '@/app/router';
import { editorActions, useEditor } from '@/app/editor-store';
import * as A from '@/app/actions';
import { isMac } from '../hooks';
import { reopenClosedTab, sendDocCommand } from '../doc-commands';

function inTextField(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.closest('.cm-editor')) return true;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
}

/** App-wide keyboard shortcuts. Editor-specific ones live in the editor keymap. */
export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      const route = useRouter.getState().route;
      const m = (s: string) => matches(e, s, isMac);
      const onDoc = route.name === 'doc';
      const run = (fn: () => void) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      };
      if (m(SHORTCUTS.palette) || m(SHORTCUTS.paletteAlt))
        return run(() => ui.setOverlay(ui.overlay === 'palette' ? null : 'palette'));
      if (m(SHORTCUTS.quickOpen))
        return run(() => ui.setOverlay(ui.overlay === 'quickopen' ? null : 'quickopen'));
      if (m(SHORTCUTS.search)) return run(() => navigate({ name: 'search', q: '' }));
      // Mod+N also works where the browser doesn't reserve it.
      if (m(SHORTCUTS.newDoc) || m('Mod+N')) return run(() => void A.newDocument());
      if (m(SHORTCUTS.newFolder)) return run(() => void A.newFolder());
      if (m(SHORTCUTS.dailyNote)) return run(() => void A.openDailyNote());
      if (m(SHORTCUTS.toggleSidebar))
        return run(() =>
          matchMedia('(max-width: 1099px)').matches
            ? ui.setDrawer(!ui.drawerOpen)
            : ui.setSidebar(!ui.sidebarOpen),
        );
      if (m(SHORTCUTS.togglePanel)) return run(() => ui.setRightPanel(!ui.rightPanelOpen));
      if (m(SHORTCUTS.reopenTab)) return run(() => void reopenClosedTab());
      if (m(SHORTCUTS.save)) {
        const id = useEditor.getState().activeId;
        return run(() => void (id ? editorActions.flush(id) : editorActions.flushAll()));
      }
      if (onDoc) {
        if (m(SHORTCUTS.toggleMode)) return run(() => sendDocCommand('toggle-mode'));
        if (m(SHORTCUTS.splitView)) return run(() => sendDocCommand('split'));
        if (m(SHORTCUTS.focusMode)) return run(() => ui.setFocusMode(!ui.focusMode));
        if (m(SHORTCUTS.readingMode)) return run(() => ui.setReadingMode(!ui.readingMode));
        if (m(SHORTCUTS.closeTab)) {
          const id = useEditor.getState().activeId;
          if (id) return run(() => void A.closeTab(id));
        }
        if (m(SHORTCUTS.nextTab) || m('Ctrl+Shift+Tab')) {
          const { tabs, activeId } = useEditor.getState();
          if (tabs.length > 1 && activeId) {
            const i = tabs.indexOf(activeId);
            const next = tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length]!;
            return run(() => void A.openEntry(next));
          }
        }
        if (m(SHORTCUTS.find) && !inTextField(e.target)) return run(() => sendDocCommand('find'));
      }
      if (e.key === 'Escape' && !e.defaultPrevented) {
        if (ui.overlay) return run(() => ui.setOverlay(null));
        if (ui.focusMode || ui.readingMode) {
          if (!inTextField(e.target) || ui.readingMode)
            return run(() => (ui.setFocusMode(false), ui.setReadingMode(false)));
        }
      }
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, []);
}
