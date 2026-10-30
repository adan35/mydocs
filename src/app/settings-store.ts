import { create } from 'zustand';
import type { SortDir, SortKey } from '@/domain/tree';
import { prefs } from './prefs';
import { isPaletteId, type PaletteId } from './themes';

export type ThemePref = 'light' | 'dark' | 'system';
/** Source (`edit`), source and preview side by side, rich editing, and reading (`preview`). */
export type ViewMode = 'edit' | 'split' | 'rich' | 'preview' | 'sheet';
export type Density = 'comfortable' | 'compact';
export type ExplorerView = 'list' | 'compact' | 'grid';
/** How tall table rows are: one line like a spreadsheet, up to 3 or 6 lines, or everything. */
export type RowHeight = 'default' | 'normal' | 'medium' | 'full';

export interface Settings {
  theme: ThemePref;
  /** Color palette; each has a light and a dark variant. */
  palette: PaletteId;
  density: Density;
  /** Base font size of the editor and reader, in px. */
  fontSize: number;
  editorFont: 'mono' | 'sans';
  wordWrap: boolean;
  lineNumbers: boolean;
  tabSize: 2 | 4;
  autosaveDelay: number;
  defaultViewMode: ViewMode;
  /** Text column width. `full` uses the whole pane with a small margin. */
  readingWidth: 'narrow' | 'normal' | 'wide' | 'full';
  explorerSort: SortKey;
  explorerSortDir: SortDir;
  explorerView: ExplorerView;
  spellcheck: boolean;
  /** Formatting buttons above the Markdown editor. */
  formatToolbar: boolean;
  /** Show a text name beside each formatting button. */
  toolbarLabels: boolean;
  /** Keep the line being edited near the middle of the screen. */
  typewriter: boolean;
  /** Folder path for daily notes ("Daily notes", "Journal/Daily"…). */
  dailyFolder: string;
  /** Split view: scrolling one pane moves the other to the same content. */
  syncScroll: boolean;
  /** Row height of tables in documents and of spreadsheet grids. */
  tableRowHeight: RowHeight;
  /** New and unconfigured linked folders mirror the folder on disk in real time. */
  liveFolderSync: boolean;
  /** In a live-synced folder: ask before removing files deleted on disk, or move them to Trash. */
  diskDeleteAction: 'ask' | 'remove';
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  palette: 'classic',
  density: 'comfortable',
  fontSize: 16,
  editorFont: 'mono',
  wordWrap: true,
  lineNumbers: false,
  tabSize: 2,
  autosaveDelay: 700,
  defaultViewMode: 'edit',
  readingWidth: 'full',
  explorerSort: 'name',
  explorerSortDir: 'asc',
  explorerView: 'list',
  spellcheck: true,
  formatToolbar: true,
  toolbarLabels: false,
  typewriter: false,
  dailyFolder: 'Daily notes',
  syncScroll: true,
  tableRowHeight: 'full',
  liveFolderSync: false,
  diskDeleteAction: 'ask',
};

/** Most lines a cell shows at each row height. */
export const ROW_LINES: Record<RowHeight, number> = {
  default: 1,
  normal: 3,
  medium: 6,
  full: Infinity,
};

const KEY = 'mydoc:settings';

interface SettingsState extends Settings {
  update(patch: Partial<Settings>): void;
  reset(): void;
}

/** Saved settings, upgraded from earlier versions. */
function load(): Partial<Settings> {
  const saved = prefs.get<Partial<Settings> & { v?: number }>(KEY, {});
  // Version 2 made the full-width text column the default; earlier saves stored the old
  // default ("normal") whether or not it was picked, so they move to the new one.
  if ((saved.v ?? 1) < 2 && saved.readingWidth === 'normal') saved.readingWidth = 'full';
  // Version 3 shows whole table rows by default; earlier saves stored the old one-line
  // default ("default") whether or not it was picked.
  if ((saved.v ?? 1) < 3 && saved.tableRowHeight === 'default') saved.tableRowHeight = 'full';
  delete saved.v;
  if (saved.palette !== undefined && !isPaletteId(saved.palette)) delete saved.palette;
  if (saved.tableRowHeight !== undefined && !(saved.tableRowHeight in ROW_LINES))
    delete saved.tableRowHeight;
  return saved;
}

export const useSettings = create<SettingsState>((set) => ({
  ...DEFAULT_SETTINGS,
  ...load(),
  update(patch) {
    set(patch);
    const { update: _u, reset: _r, ...rest } = useSettings.getState();
    prefs.set(KEY, { ...rest, v: 3 });
  },
  reset() {
    set(DEFAULT_SETTINGS);
    prefs.set(KEY, { ...DEFAULT_SETTINGS, v: 3 });
  },
}));
