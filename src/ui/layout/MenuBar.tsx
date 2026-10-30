import { useEffect, useState } from 'react';
import {
  BookOpen,
  ClipboardPaste,
  Clock,
  Command,
  Copy,
  Download,
  FileOutput,
  FilePlus2,
  FolderInput,
  FolderPlus,
  Focus,
  Hash,
  Home,
  Keyboard,
  LayoutTemplate,
  Menu as MenuIcon,
  Network,
  PanelLeft,
  PanelRight,
  Redo2,
  Save,
  Scissors,
  Search,
  Settings,
  SquareDashed,
  Star,
  StickyNote,
  Trash2,
  Undo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
  CalendarDays,
  RotateCcw,
  PencilLine,
  FolderOpen,
  LocateFixed,
  Link2,
} from 'lucide-react';
import * as A from '@/app/actions';
import { ws } from '@/app/app-store';
import { editorActions, useEditor } from '@/app/editor-store';
import { navigate, useRouter } from '@/app/router';
import { useSettings, DEFAULT_SETTINGS, type ViewMode } from '@/app/settings-store';
import { useUi } from '@/app/ui-store';
import { dialogs } from '@/app/dialog-store';
import { SHORTCUTS } from '@/app/shortcuts';
import { isMarkdownName } from '@/domain/names';
import { conversionsFrom, formatOf } from '@/lib/convert/capabilities';
import { isNativeApp } from '@/platform';
import { openMenuAt, useMenuOpen, type MenuEntry } from '../components/Menu';
import { themeMenuItems } from '../components/ThemePicker';
import { copyPathSubmenu, exportSubmenu, importSubmenu } from '../entry-menu';
import { reopenClosedTab, sendDocCommand, toggleSidePanel } from '../doc-commands';

export interface AppMenu {
  label: string;
  items: MenuEntry[];
}

const ZOOM_MIN = 13;
const ZOOM_MAX = 22;

/** Which of the reading/editing views a document offers, as `[mode, label]`. */
function viewModes(name: string): [ViewMode, string][] {
  if (isMarkdownName(name))
    return [
      ['edit', 'Source'],
      ['split', 'Split'],
      ['rich', 'Rich editing'],
      ['preview', 'Read'],
    ];
  if (/\.(csv|tsv|tab|unl)$/i.test(name))
    return [
      ['edit', 'Source'],
      ['sheet', 'Sheet'],
    ];
  return [];
}

/**
 * The menus of the top menu bar (File, Edit, View, Help). They are built when opened, so
 * they always reflect the open document, and every item reuses an existing command.
 */
export function appMenus(): AppMenu[] {
  const route = useRouter.getState().route;
  const activeId = useEditor.getState().activeId;
  const doc = route.name === 'doc' && activeId ? ws().get(activeId) : undefined;
  const editable = !!doc && ws().isEditable(doc);
  const ui = useUi.getState();
  const settings = useSettings.getState();
  const hasTab = !!activeId && useEditor.getState().tabs.includes(activeId);
  const convertible =
    !!doc && !!formatOf(doc.name) && conversionsFrom(formatOf(doc.name)!.id).length > 0;
  const modes = doc ? viewModes(doc.name) : [];
  const currentMode = doc
    ? (ui.viewModes[doc.id] ?? (isMarkdownName(doc.name) ? settings.defaultViewMode : 'sheet'))
    : null;
  const edit = (what: string) => () => sendDocCommand(`edit:${what}` as 'edit:cut');

  const file: MenuEntry[] = [
    {
      label: 'New document…',
      icon: <FilePlus2 />,
      shortcut: SHORTCUTS.newDoc,
      onSelect: () => void A.chooseNewDocument(),
    },
    {
      label: 'New from template…',
      icon: <LayoutTemplate />,
      onSelect: () => void A.newFromTemplate(),
    },
    {
      label: 'New folder…',
      icon: <FolderPlus />,
      shortcut: SHORTCUTS.newFolder,
      onSelect: () => void A.newFolder(),
    },
    {
      label: "Today's note",
      icon: <CalendarDays />,
      shortcut: SHORTCUTS.dailyNote,
      onSelect: () => void A.openDailyNote(),
    },
    'separator',
    {
      label: 'Open…',
      icon: <FolderOpen />,
      shortcut: SHORTCUTS.quickOpen,
      onSelect: () => ui.setOverlay('quickopen'),
    },
    { label: 'Import', icon: <Upload />, submenu: importSubmenu(A.contextFolderId()) },
    'separator',
    {
      label: 'Save',
      icon: <Save />,
      shortcut: SHORTCUTS.save,
      disabled: !hasTab,
      onSelect: () => void (activeId ? editorActions.flush(activeId) : editorActions.flushAll()),
    },
    {
      label: 'Rename…',
      icon: <PencilLine />,
      disabled: !doc,
      onSelect: () => doc && void A.renameEntry(doc.id),
    },
    {
      label: 'Reveal in Files',
      icon: <LocateFixed />,
      disabled: !doc,
      onSelect: () => doc && A.revealInFiles(doc.id),
    },
    {
      label: 'Show in File Explorer',
      icon: <FolderOpen />,
      disabled: !doc,
      onSelect: () => doc && void A.showInFileExplorer(doc.id),
    },
    {
      label: 'Copy path',
      icon: <Link2 />,
      disabled: !doc,
      submenu: doc ? copyPathSubmenu(doc) : [],
    },
    {
      label: 'Convert or export…',
      icon: <FileOutput />,
      disabled: !convertible,
      onSelect: () => doc && void dialogs.convert(doc.id),
    },
    doc
      ? { label: 'Export', icon: <Download />, submenu: exportSubmenu(doc) }
      : {
          label: 'Export workspace as .zip',
          icon: <Download />,
          onSelect: () => void A.exportEntry(null, 'zip'),
        },
    'separator',
    {
      label: 'Close tab',
      icon: <X />,
      shortcut: SHORTCUTS.closeTab,
      disabled: !hasTab,
      onSelect: () => activeId && void A.closeTab(activeId),
    },
    {
      label: 'Reopen closed tab',
      icon: <RotateCcw />,
      shortcut: SHORTCUTS.reopenTab,
      onSelect: () => void reopenClosedTab(),
    },
    'separator',
    { label: 'Settings', icon: <Settings />, onSelect: () => navigate({ name: 'settings' }) },
  ];

  const editMenu: MenuEntry[] = [
    {
      label: 'Undo',
      icon: <Undo2 />,
      shortcut: 'Mod+Z',
      disabled: !editable,
      onSelect: () => sendDocCommand('tool:undo'),
    },
    {
      label: 'Redo',
      icon: <Redo2 />,
      shortcut: 'Mod+Shift+Z',
      disabled: !editable,
      onSelect: () => sendDocCommand('tool:redo'),
    },
    'separator',
    {
      label: 'Cut',
      icon: <Scissors />,
      shortcut: 'Mod+X',
      disabled: !editable,
      onSelect: edit('cut'),
    },
    {
      label: 'Copy',
      icon: <Copy />,
      shortcut: 'Mod+C',
      disabled: !editable,
      onSelect: edit('copy'),
    },
    {
      label: 'Paste',
      icon: <ClipboardPaste />,
      shortcut: 'Mod+V',
      disabled: !editable,
      onSelect: edit('paste'),
    },
    {
      label: 'Select all',
      icon: <SquareDashed />,
      shortcut: 'Mod+A',
      disabled: !editable,
      onSelect: edit('select-all'),
    },
    'separator',
    {
      label: 'Find and replace…',
      icon: <Search />,
      shortcut: SHORTCUTS.find,
      disabled: !editable,
      onSelect: () => sendDocCommand('find'),
    },
    {
      label: 'Search everything…',
      icon: <Search />,
      shortcut: SHORTCUTS.search,
      onSelect: () => navigate({ name: 'search', q: '' }),
    },
  ];

  const view: MenuEntry[] = [
    ...modes.map(([mode, label]): MenuEntry => ({
      label,
      checked: currentMode === mode,
      onSelect: () => doc && ui.setViewMode(doc.id, mode),
    })),
    ...(modes.length ? (['separator'] as const) : []),
    {
      label: ui.sidebarOpen ? 'Hide sidebar' : 'Show sidebar',
      icon: <PanelLeft />,
      shortcut: SHORTCUTS.toggleSidebar,
      onSelect: () =>
        matchMedia('(max-width: 1099px)').matches
          ? ui.setDrawer(!ui.drawerOpen)
          : ui.setSidebar(!ui.sidebarOpen),
    },
    {
      label: ui.rightPanelOpen ? 'Hide side panel' : 'Show side panel',
      icon: <PanelRight />,
      shortcut: SHORTCUTS.togglePanel,
      disabled: !doc,
      onSelect: toggleSidePanel,
    },
    {
      label: ui.focusMode ? 'Exit focus mode' : 'Focus mode',
      icon: <Focus />,
      shortcut: SHORTCUTS.focusMode,
      disabled: !doc,
      onSelect: () => ui.setFocusMode(!ui.focusMode),
    },
    {
      label: ui.readingMode ? 'Exit reading mode' : 'Reading mode',
      icon: <BookOpen />,
      shortcut: SHORTCUTS.readingMode,
      disabled: !doc || !isMarkdownName(doc.name),
      onSelect: () => ui.setReadingMode(!ui.readingMode),
    },
    'separator',
    {
      label: 'Zoom in',
      icon: <ZoomIn />,
      disabled: settings.fontSize >= ZOOM_MAX,
      onSelect: () => settings.update({ fontSize: Math.min(ZOOM_MAX, settings.fontSize + 1) }),
    },
    {
      label: 'Zoom out',
      icon: <ZoomOut />,
      disabled: settings.fontSize <= ZOOM_MIN,
      onSelect: () => settings.update({ fontSize: Math.max(ZOOM_MIN, settings.fontSize - 1) }),
    },
    {
      label: 'Reset zoom',
      disabled: settings.fontSize === DEFAULT_SETTINGS.fontSize,
      onSelect: () => settings.update({ fontSize: DEFAULT_SETTINGS.fontSize }),
    },
    'separator',
    { label: 'Theme', submenu: themeMenuItems() },
    {
      label: 'Go to',
      submenu: [
        { label: 'Home', icon: <Home />, onSelect: () => navigate({ name: 'home' }) },
        {
          label: 'All files',
          icon: <FolderInput />,
          onSelect: () => navigate({ name: 'folder', id: null }),
        },
        { label: 'Recent', icon: <Clock />, onSelect: () => navigate({ name: 'recent' }) },
        { label: 'Favorites', icon: <Star />, onSelect: () => navigate({ name: 'favorites' }) },
        { label: 'Tags', icon: <Hash />, onSelect: () => navigate({ name: 'tags' }) },
        { label: 'Notes', icon: <StickyNote />, onSelect: () => navigate({ name: 'notes' }) },
        { label: 'Graph', icon: <Network />, onSelect: () => navigate({ name: 'graph' }) },
        { label: 'Trash', icon: <Trash2 />, onSelect: () => navigate({ name: 'trash' }) },
      ],
    },
  ];

  const help: MenuEntry[] = [
    {
      label: 'Keyboard shortcuts',
      icon: <Keyboard />,
      onSelect: () => void dialogs.shortcuts(),
    },
    {
      label: 'Command palette…',
      icon: <Command />,
      shortcut: SHORTCUTS.palette,
      onSelect: () => ui.setOverlay('palette'),
    },
    {
      label: 'Supported formats',
      icon: <FileOutput />,
      onSelect: () => void dialogs.formats(),
    },
    ...(isNativeApp
      ? []
      : [
          {
            label: 'Download the apps',
            icon: <Download />,
            onSelect: () => navigate({ name: 'download' }),
          } satisfies MenuEntry,
        ]),
    'separator',
    { label: `My Doc ${__APP_VERSION__}`, disabled: true },
  ];

  return [
    { label: 'File', items: file },
    { label: 'Edit', items: editMenu },
    { label: 'View', items: view },
    { label: 'Help', items: help },
  ];
}

/** The same menus as one list of submenus, for the phone's More sheet and the tablet's menu button. */
export const menuBarAsSubmenus = (): MenuEntry[] =>
  appMenus().map((m) => ({ label: m.label, submenu: m.items }));

/** Top menu bar on desktop; a single menu button on tablets (phones use the More sheet). */
export function MenuBar({ compact }: { compact?: boolean }) {
  const open = useMenuOpen();
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!open) setActive(null);
  }, [open]);

  const show = (el: HTMLElement, name: string) => {
    const menu = appMenus().find((m) => m.label === name)!;
    setActive(name);
    openMenuAt(el, menu.items, name);
  };

  if (compact)
    return (
      <div className="flex h-9 shrink-0 items-center border-b border-hairline px-1 no-print">
        <button
          type="button"
          className="icon-btn"
          aria-label="Menu"
          aria-haspopup="menu"
          onClick={(e) => openMenuAt(e.currentTarget, menuBarAsSubmenus(), 'Menu')}
        >
          <MenuIcon size={16} />
        </button>
      </div>
    );

  return (
    <div
      role="menubar"
      aria-label="Application menu"
      className="flex h-8 shrink-0 items-center gap-0.5 border-b border-hairline bg-canvas px-1.5 no-print"
    >
      {['File', 'Edit', 'View', 'Help'].map((name) => (
        <button
          key={name}
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={active === name && open}
          className="h-6 rounded-md px-2.5 text-[13px] text-ink hover:bg-hover aria-expanded:bg-hover"
          onClick={(e) => show(e.currentTarget, name)}
          // Once one menu is open, pointing at another title switches to it, as in other apps.
          onPointerEnter={(e) => open && active && active !== name && show(e.currentTarget, name)}
        >
          {name}
        </button>
      ))}
    </div>
  );
}
