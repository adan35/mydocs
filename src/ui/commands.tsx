import type { ReactNode } from 'react';
import {
  FileOutput,
  Sheet,
  BookOpen,
  Columns2,
  Download,
  Eye,
  FilePlus2,
  FolderInput,
  FolderPlus,
  Focus,
  History,
  Home,
  Keyboard,
  LayoutTemplate,
  Moon,
  PanelLeft,
  PanelRight,
  PencilLine,
  Search,
  Settings,
  Star,
  Sun,
  SunMoon,
  Trash2,
  Upload,
  Clock,
  Hash,
  FileArchive,
  RotateCcw,
  Copy,
  Tag,
  Table,
  Pin,
  X,
  AlignVerticalJustifyCenter,
  CalendarDays,
  Network,
  Type,
  Palette,
  Printer,
} from 'lucide-react';
import * as A from '@/app/actions';
import { ws } from '@/app/app-store';
import { editorActions, useEditor } from '@/app/editor-store';
import { navigate, useRouter } from '@/app/router';
import { useSettings } from '@/app/settings-store';
import { PALETTES } from '@/app/themes';
import { useUi } from '@/app/ui-store';
import { dialogs } from '@/app/dialog-store';
import { SHORTCUTS } from '@/app/shortcuts';
import { isMarkdownName } from '@/domain/names';
import { conversionsFrom, formatOf } from '@/lib/convert/capabilities';
import { canPrint } from '@/platform';

const convertible = (name: string) => {
  const f = formatOf(name)?.id;
  return !!f && conversionsFrom(f).length > 0;
};
import { pickImport } from './import-pickers';
import { reopenClosedTab, sendDocCommand, toggleSidePanel } from './doc-commands';
import { canInstall, installApp } from '@/pwa/register';
import { BLOCK_STYLES, TOOLS } from './editor/tools';

export interface Command {
  id: string;
  title: string;
  group: 'Create' | 'Document' | 'Format' | 'Navigate' | 'View' | 'Workspace';
  icon: ReactNode;
  shortcut?: string;
  keywords?: string;
  run(): void;
}

/** Every important action, discoverable from the command palette. Context-aware. */
export function getCommands(): Command[] {
  const route = useRouter.getState().route;
  const activeId = useEditor.getState().activeId;
  const doc = route.name === 'doc' && activeId ? ws().get(activeId) : undefined;
  const ui = useUi.getState();
  const settings = useSettings.getState();
  const cmds: Command[] = [
    {
      id: 'new-doc',
      title: 'New document',
      group: 'Create',
      icon: <FilePlus2 />,
      shortcut: SHORTCUTS.newDoc,
      keywords: 'create file note page',
      run: () => void A.newDocument(),
    },
    {
      id: 'new-sheet',
      title: 'New spreadsheet',
      group: 'Create',
      icon: <Sheet />,
      keywords: 'excel xlsx table grid workbook',
      run: () => void A.newSpreadsheet(),
    },
    {
      id: 'formats',
      title: 'Supported formats and conversions',
      group: 'Workspace',
      icon: <FileOutput />,
      keywords: 'docx word xlsx excel csv tsv pdf html export import capability matrix',
      run: () => void dialogs.formats(),
    },
    {
      id: 'new-template',
      title: 'New document from template',
      group: 'Create',
      icon: <LayoutTemplate />,
      keywords: 'readme meeting notes lecture class daily todo api research',
      run: () => void A.newFromTemplate(),
    },
    {
      id: 'daily-note',
      title: "Open today's daily note",
      group: 'Create',
      icon: <CalendarDays />,
      shortcut: SHORTCUTS.dailyNote,
      keywords: 'journal diary today date',
      run: () => void A.openDailyNote(),
    },
    {
      id: 'new-folder',
      title: 'New folder',
      group: 'Create',
      icon: <FolderPlus />,
      shortcut: SHORTCUTS.newFolder,
      keywords: 'directory create',
      run: () => void A.newFolder(),
    },
    {
      id: 'import-files',
      title: 'Import files…',
      group: 'Create',
      icon: <Upload />,
      keywords: 'upload add markdown',
      run: () => pickImport('files'),
    },
    {
      id: 'import-folder',
      title: 'Import folder…',
      group: 'Create',
      icon: <Upload />,
      keywords: 'upload directory project',
      run: () => pickImport('folder'),
    },
    {
      id: 'import-zip',
      title: 'Import zip archive…',
      group: 'Create',
      icon: <FileArchive />,
      keywords: 'upload archive',
      run: () => pickImport('zip'),
    },
    {
      id: 'quick-open',
      title: 'Open document…',
      group: 'Navigate',
      icon: <Search />,
      shortcut: SHORTCUTS.quickOpen,
      keywords: 'quick open go to file',
      run: () => ui.setOverlay('quickopen'),
    },
    {
      id: 'search',
      title: 'Search everything',
      group: 'Navigate',
      icon: <Search />,
      shortcut: SHORTCUTS.search,
      keywords: 'find global full text',
      run: () => navigate({ name: 'search', q: '' }),
    },
    {
      id: 'home',
      title: 'Go to Home',
      group: 'Navigate',
      icon: <Home />,
      run: () => navigate({ name: 'home' }),
    },
    {
      id: 'all-files',
      title: 'Go to All files',
      group: 'Navigate',
      icon: <FolderInput />,
      keywords: 'explorer browse',
      run: () => navigate({ name: 'folder', id: null }),
    },
    {
      id: 'recent',
      title: 'Go to Recent',
      group: 'Navigate',
      icon: <Clock />,
      run: () => navigate({ name: 'recent' }),
    },
    {
      id: 'favorites',
      title: 'Go to Favorites',
      group: 'Navigate',
      icon: <Star />,
      run: () => navigate({ name: 'favorites' }),
    },
    {
      id: 'tags',
      title: 'Go to Tags',
      group: 'Navigate',
      icon: <Hash />,
      run: () => navigate({ name: 'tags' }),
    },
    {
      id: 'graph',
      title: 'Open graph view',
      group: 'Navigate',
      icon: <Network />,
      keywords: 'links map connections knowledge',
      run: () => navigate({ name: 'graph' }),
    },
    {
      id: 'trash',
      title: 'Go to Trash',
      group: 'Navigate',
      icon: <Trash2 />,
      keywords: 'deleted restore',
      run: () => navigate({ name: 'trash' }),
    },
    {
      id: 'reopen',
      title: 'Reopen closed tab',
      group: 'Navigate',
      icon: <RotateCcw />,
      shortcut: SHORTCUTS.reopenTab,
      run: () => void reopenClosedTab(),
    },
    {
      id: 'toggle-sidebar',
      title: ui.sidebarOpen ? 'Hide sidebar' : 'Show sidebar',
      group: 'View',
      icon: <PanelLeft />,
      shortcut: SHORTCUTS.toggleSidebar,
      run: () => ui.setSidebar(!ui.sidebarOpen),
    },
    {
      id: 'theme-light',
      title: 'Theme: Light',
      group: 'View',
      icon: <Sun />,
      keywords: 'appearance color mode',
      run: () => settings.update({ theme: 'light' }),
    },
    {
      id: 'theme-dark',
      title: 'Theme: Dark',
      group: 'View',
      icon: <Moon />,
      keywords: 'appearance color mode night',
      run: () => settings.update({ theme: 'dark' }),
    },
    {
      id: 'theme-system',
      title: 'Theme: Match system',
      group: 'View',
      icon: <SunMoon />,
      keywords: 'appearance color mode auto',
      run: () => settings.update({ theme: 'system' }),
    },
    ...PALETTES.map((p) => ({
      id: `palette-${p.id}`,
      title: `Color palette: ${p.label}`,
      group: 'View' as const,
      icon: <Palette />,
      keywords: `appearance theme colors ${p.hint}`,
      run: () => settings.update({ palette: p.id }),
    })),
    {
      id: 'settings',
      title: 'Open settings',
      group: 'Workspace',
      icon: <Settings />,
      keywords: 'preferences options',
      run: () => navigate({ name: 'settings' }),
    },
    {
      id: 'shortcuts',
      title: 'Keyboard shortcuts',
      group: 'Workspace',
      icon: <Keyboard />,
      keywords: 'keys help hotkeys',
      run: () => void dialogs.shortcuts(),
    },
    {
      id: 'export-workspace',
      title: 'Export workspace as .zip',
      group: 'Workspace',
      icon: <Download />,
      keywords: 'backup download',
      run: () => void A.exportEntry(null, 'zip'),
    },
    {
      id: 'new-workspace',
      title: 'New workspace…',
      group: 'Workspace',
      icon: <FolderPlus />,
      run: () => void A.newWorkspace(),
    },
    {
      id: 'empty-trash',
      title: 'Empty Trash…',
      group: 'Workspace',
      icon: <Trash2 />,
      run: () => void A.emptyTrash(),
    },
  ];
  if (canInstall()) {
    cmds.push({
      id: 'install',
      title: 'Install My Doc as an app',
      group: 'Workspace',
      icon: <Download />,
      keywords: 'pwa desktop offline home screen',
      run: () => void installApp(),
    });
  }
  if (doc) {
    const md = isMarkdownName(doc.name);
    cmds.unshift(
      {
        id: 'rename',
        title: `Rename "${doc.name}"…`,
        group: 'Document',
        icon: <PencilLine />,
        run: () => void A.renameEntry(doc.id),
      },
      {
        id: 'move',
        title: 'Move document…',
        group: 'Document',
        icon: <FolderInput />,
        run: () => void A.moveEntries([doc.id]),
      },
      {
        id: 'duplicate',
        title: 'Duplicate document',
        group: 'Document',
        icon: <Copy />,
        run: () => void A.duplicateEntry(doc.id),
      },
      {
        id: 'local-graph',
        title: 'Show local graph',
        group: 'Document',
        icon: <Network />,
        keywords: 'links connections map',
        run: () => navigate({ name: 'graph', id: doc.id }),
      },
      {
        id: 'pin-tab',
        title: useEditor.getState().pinned.includes(doc.id) ? 'Unpin tab' : 'Pin tab',
        group: 'Document',
        icon: <Pin />,
        keywords: 'keep tab',
        run: () => useEditor.getState().tabs.includes(doc.id) && editorActions.togglePin(doc.id),
      },
      {
        id: 'close-others',
        title: 'Close other tabs',
        group: 'Document',
        icon: <X />,
        run: () => void A.closeOtherTabs(doc.id),
      },
      {
        id: 'close-right',
        title: 'Close tabs to the right',
        group: 'Document',
        icon: <X />,
        run: () => void A.closeTabsToRight(doc.id),
      },
      {
        id: 'favorite',
        title: doc.favorite ? 'Remove from favorites' : 'Add to favorites',
        group: 'Document',
        icon: <Star />,
        run: () => void A.toggleFavorite(doc.id),
      },
      {
        id: 'find',
        title: 'Find and replace in document',
        group: 'Document',
        icon: <Search />,
        shortcut: SHORTCUTS.find,
        run: () => sendDocCommand('find'),
      },
      ...(isMarkdownName(doc.name)
        ? [
            {
              id: 'insert-table',
              title: 'Insert or edit table',
              group: 'Document' as const,
              icon: <Table />,
              keywords: 'grid columns rows visual editor',
              run: () => sendDocCommand('insert-table'),
            },
          ]
        : []),
      ...(convertible(doc.name)
        ? [
            {
              id: 'convert',
              title: 'Convert or export…',
              group: 'Document' as const,
              icon: <FileOutput />,
              keywords: 'docx word xlsx excel csv tsv html pdf markdown save as',
              run: () => void dialogs.convert(doc.id),
            },
          ]
        : []),
      {
        id: 'export-doc',
        title: 'Export document',
        group: 'Document',
        icon: <Download />,
        keywords: 'download markdown',
        run: () => void A.exportEntry(doc.id, 'file'),
      },
      {
        id: 'delete',
        title: 'Move document to Trash',
        group: 'Document',
        icon: <Trash2 />,
        keywords: 'delete remove',
        run: () => void A.trashEntries([doc.id]),
      },
      {
        id: 'typewriter',
        title: settings.typewriter ? 'Turn off typewriter scrolling' : 'Typewriter scrolling',
        group: 'View',
        icon: <AlignVerticalJustifyCenter />,
        keywords: 'center line writing focus',
        run: () => settings.update({ typewriter: !settings.typewriter }),
      },
      {
        id: 'focus',
        title: ui.focusMode ? 'Exit focus mode' : 'Focus mode',
        group: 'View',
        icon: <Focus />,
        shortcut: SHORTCUTS.focusMode,
        keywords: 'zen distraction free',
        run: () => ui.setFocusMode(!ui.focusMode),
      },
    );
    for (const tool of TOOLS) {
      const forMd = ![
        'find',
        'replace',
        'wrap',
        'goto-line',
        'sort-lines',
        'case',
        'trim',
      ].includes(tool.id);
      if (tool.group === 'history' || forMd !== md || tool.id === 'find') continue;
      cmds.push({
        id: `tool-${tool.id}`,
        title: `${tool.group === 'insert' ? 'Insert' : 'Format'}: ${tool.label}`,
        group: 'Format',
        icon: tool.icon,
        shortcut: tool.shortcut,
        run: () => sendDocCommand(`tool:${tool.id}`),
      });
    }
    if (md) {
      cmds.unshift(
        {
          id: 'toggle-preview',
          title: 'Switch between source and reading',
          group: 'View',
          icon: <Eye />,
          shortcut: SHORTCUTS.toggleMode,
          keywords: 'edit render preview markdown',
          run: () => sendDocCommand('toggle-mode'),
        },
        {
          id: 'toggle-rich',
          title: 'Rich editing (edit the formatted document)',
          group: 'View',
          icon: <PencilLine />,
          shortcut: SHORTCUTS.richMode,
          keywords: 'wysiwyg visual live preview word',
          run: () => sendDocCommand('rich'),
        },
        {
          id: 'sync-scroll',
          title: settings.syncScroll
            ? 'Turn off scroll sync in split view'
            : 'Sync scrolling in split view',
          group: 'View',
          icon: <Columns2 />,
          keywords: 'split scroll lock',
          run: () => settings.update({ syncScroll: !settings.syncScroll }),
        },
        ...BLOCK_STYLES.slice(0, 4).map((st): Command => ({
          id: `style-${st.type}`,
          title: `Format: ${st.label}`,
          group: 'Format',
          icon: <Type />,
          shortcut: st.shortcut,
          keywords: 'heading paragraph style',
          run: () => sendDocCommand(`style:${st.type}`),
        })),
        {
          id: 'toggle-split',
          title: 'Toggle split view',
          group: 'View',
          icon: <Columns2 />,
          shortcut: SHORTCUTS.splitView,
          keywords: 'side by side',
          run: () => sendDocCommand('split'),
        },
        {
          id: 'reading',
          title: ui.readingMode ? 'Exit reading mode' : 'Reading mode',
          group: 'View',
          icon: <BookOpen />,
          shortcut: SHORTCUTS.readingMode,
          run: () => ui.setReadingMode(!ui.readingMode),
        },
        {
          id: 'panel',
          title: ui.rightPanelOpen ? 'Hide side panel' : 'Show side panel (outline, links, info)',
          group: 'View',
          icon: <PanelRight />,
          shortcut: SHORTCUTS.togglePanel,
          keywords: 'outline backlinks',
          run: toggleSidePanel,
        },
        {
          id: 'history',
          title: 'Version history',
          group: 'Document',
          icon: <History />,
          keywords: 'versions restore compare',
          run: () => void dialogs.history(doc.id),
        },
        {
          id: 'save-template',
          title: 'Save as template',
          group: 'Document',
          icon: <LayoutTemplate />,
          keywords: 'reuse copy',
          run: () => void A.saveAsTemplate(doc.id),
        },
        {
          id: 'tag',
          title: 'Add tag…',
          group: 'Document',
          icon: <Tag />,
          run: () => void A.addTagTo(doc.id),
        },
        {
          id: 'export-html',
          title: 'Export as HTML',
          group: 'Document',
          icon: <Download />,
          run: () => void A.exportEntry(doc.id, 'html'),
        },
        {
          id: 'export-txt',
          title: 'Export as plain text',
          group: 'Document',
          icon: <Download />,
          keywords: 'txt',
          run: () => void A.exportEntry(doc.id, 'txt'),
        },
        {
          id: 'export-pdf',
          title: 'Export as PDF',
          group: 'Document',
          icon: <Download />,
          keywords: 'save pdf',
          run: () => void A.exportEntry(doc.id, 'pdf'),
        },
        ...(canPrint
          ? [
              {
                id: 'print',
                title: 'Print or save as PDF with the system dialog',
                group: 'Document' as const,
                icon: <Printer />,
                keywords: 'print pdf',
                run: () => void A.exportEntry(doc.id, 'print'),
              },
            ]
          : []),
      );
    }
  }
  return cmds;
}
