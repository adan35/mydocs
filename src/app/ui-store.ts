import { create } from 'zustand';
import { prefs } from './prefs';
import type { ViewMode } from './settings-store';

export type Overlay = 'palette' | 'quickopen' | null;
export type RightPanel = 'outline' | 'backlinks' | 'info';

interface UiState {
  sidebarOpen: boolean;
  /** Mobile/tablet drawer. */
  drawerOpen: boolean;
  rightPanelOpen: boolean;
  rightPanel: RightPanel;
  overlay: Overlay;
  focusMode: boolean;
  readingMode: boolean;
  /** Per-document view mode overrides. */
  viewModes: Record<string, ViewMode>;
  /** Share of the width the source pane gets in split view. */
  splitRatio: number;
  rightPanelWidth: number;
  setSplitRatio(r: number): void;
  setRightPanelWidth(w: number): void;
  /** Asks the Files tree to scroll to and highlight an entry. `n` makes repeat requests distinct. */
  revealRequest: { id: string; n: number; at: number } | null;
  requestReveal(id: string): void;
  setSidebar(open: boolean): void;
  setDrawer(open: boolean): void;
  setRightPanel(open: boolean, panel?: RightPanel): void;
  setOverlay(o: Overlay): void;
  setFocusMode(on: boolean): void;
  setReadingMode(on: boolean): void;
  setViewMode(id: string, mode: ViewMode): void;
}

const KEY = 'mydoc:layout';
const MODES_KEY = 'mydoc:view-modes';
const MAX_MODES = 300;
const saved = prefs.get<{
  sidebarOpen?: boolean;
  rightPanelOpen?: boolean;
  rightPanel?: RightPanel;
  splitRatio?: number;
  rightPanelWidth?: number;
}>(KEY, {});

const persist = () => {
  const { sidebarOpen, rightPanelOpen, rightPanel, splitRatio, rightPanelWidth } = useUi.getState();
  prefs.set(KEY, { sidebarOpen, rightPanelOpen, rightPanel, splitRatio, rightPanelWidth });
};

export const useUi = create<UiState>((set) => ({
  sidebarOpen: saved.sidebarOpen ?? true,
  drawerOpen: false,
  rightPanelOpen: saved.rightPanelOpen ?? true,
  rightPanel: saved.rightPanel ?? 'outline',
  overlay: null,
  focusMode: false,
  readingMode: false,
  viewModes: prefs.get<Record<string, ViewMode>>(MODES_KEY, {}),
  splitRatio: saved.splitRatio ?? 0.5,
  rightPanelWidth: saved.rightPanelWidth ?? 272,
  setSplitRatio(splitRatio) {
    set({ splitRatio });
    persist();
  },
  setRightPanelWidth(rightPanelWidth) {
    set({ rightPanelWidth });
    persist();
  },
  revealRequest: null,
  requestReveal(id) {
    set((s) => ({ revealRequest: { id, n: (s.revealRequest?.n ?? 0) + 1, at: Date.now() } }));
  },
  setSidebar(open) {
    set({ sidebarOpen: open });
    persist();
  },
  setDrawer(open) {
    set({ drawerOpen: open });
  },
  setRightPanel(open, panel) {
    set((s) => ({ rightPanelOpen: open, rightPanel: panel ?? s.rightPanel }));
    persist();
  },
  setOverlay(overlay) {
    set({ overlay });
  },
  setFocusMode(focusMode) {
    set({ focusMode, readingMode: false });
  },
  setReadingMode(readingMode) {
    set({ readingMode, focusMode: false });
  },
  setViewMode(id, mode) {
    set((s) => {
      const { [id]: _old, ...rest } = s.viewModes;
      // Most recent last; keep the map bounded.
      const entries = Object.entries({ ...rest, [id]: mode }).slice(-MAX_MODES);
      const viewModes = Object.fromEntries(entries);
      prefs.set(MODES_KEY, viewModes);
      return { viewModes };
    });
  },
}));
