import { create } from 'zustand';
import type { SortDir, SortKey } from '@/domain/tree';
import { prefs } from './prefs';

export type ThemePref = 'light' | 'dark' | 'system';
export type ViewMode = 'edit' | 'split' | 'preview';
export type Density = 'comfortable' | 'compact';
export type ExplorerView = 'list' | 'compact' | 'grid';

export interface Settings {
  theme: ThemePref;
  density: Density;
  /** Base font size of the editor and reader, in px. */
  fontSize: number;
  editorFont: 'mono' | 'sans';
  wordWrap: boolean;
  lineNumbers: boolean;
  tabSize: 2 | 4;
  autosaveDelay: number;
  defaultViewMode: ViewMode;
  readingWidth: 'narrow' | 'normal' | 'wide';
  explorerSort: SortKey;
  explorerSortDir: SortDir;
  explorerView: ExplorerView;
  spellcheck: boolean;
  /** Formatting buttons above the Markdown editor. */
  formatToolbar: boolean;
  /** Keep the line being edited near the middle of the screen. */
  typewriter: boolean;
  /** Folder path for daily notes ("Daily notes", "Journal/Daily"…). */
  dailyFolder: string;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  density: 'comfortable',
  fontSize: 16,
  editorFont: 'mono',
  wordWrap: true,
  lineNumbers: false,
  tabSize: 2,
  autosaveDelay: 700,
  defaultViewMode: 'edit',
  readingWidth: 'normal',
  explorerSort: 'name',
  explorerSortDir: 'asc',
  explorerView: 'list',
  spellcheck: true,
  formatToolbar: true,
  typewriter: false,
  dailyFolder: 'Daily notes',
};

const KEY = 'mydoc:settings';

interface SettingsState extends Settings {
  update(patch: Partial<Settings>): void;
  reset(): void;
}

export const useSettings = create<SettingsState>((set) => ({
  ...DEFAULT_SETTINGS,
  ...prefs.get<Partial<Settings>>(KEY, {}),
  update(patch) {
    set(patch);
    const { update: _u, reset: _r, ...rest } = useSettings.getState();
    prefs.set(KEY, rest);
  },
  reset() {
    set(DEFAULT_SETTINGS);
    prefs.set(KEY, DEFAULT_SETTINGS);
  },
}));
