import {
  Copy,
  Download,
  FilePlus2,
  FolderInput,
  FolderPlus,
  History,
  LayoutTemplate,
  PencilLine,
  Star,
  StarOff,
  Trash2,
  Upload,
  Tag,
  FileArchive,
  FileCode,
  Printer,
  FileText,
} from 'lucide-react';
import type { Entry } from '@/domain/types';
import { isMarkdownName } from '@/domain/names';
import * as A from '@/app/actions';
import { dialogs } from '@/app/dialog-store';
import { SHORTCUTS } from '@/app/shortcuts';
import type { MenuEntry } from './components/Menu';
import { pickImport } from './import-pickers';

/** The context menu for any file or folder, shared by the tree, lists and headers. */
export function entryMenu(e: Entry): MenuEntry[] {
  const items: MenuEntry[] = [];
  if (e.kind === 'folder') {
    items.push(
      { label: 'New document', icon: <FilePlus2 />, onSelect: () => void A.newDocument(e.id) },
      {
        label: 'New from template…',
        icon: <LayoutTemplate />,
        onSelect: () => void A.newFromTemplate(e.id),
      },
      { label: 'New folder', icon: <FolderPlus />, onSelect: () => void A.newFolder(e.id) },
      { label: 'Import into folder', icon: <Upload />, submenu: importSubmenu(e.id) },
      'separator',
    );
  }
  items.push(
    {
      label: e.favorite ? 'Remove from favorites' : 'Add to favorites',
      icon: e.favorite ? <StarOff /> : <Star />,
      onSelect: () => void A.toggleFavorite(e.id),
    },
    {
      label: 'Rename…',
      icon: <PencilLine />,
      shortcut: SHORTCUTS.rename,
      onSelect: () => void A.renameEntry(e.id),
    },
    { label: 'Move to…', icon: <FolderInput />, onSelect: () => void A.moveEntries([e.id]) },
    { label: 'Duplicate', icon: <Copy />, onSelect: () => void A.duplicateEntry(e.id) },
  );
  if (e.kind === 'file' && isMarkdownName(e.name)) {
    items.push(
      { label: 'Add tag…', icon: <Tag />, onSelect: () => void A.addTagTo(e.id) },
      { label: 'Version history', icon: <History />, onSelect: () => void dialogs.history(e.id) },
      {
        label: 'Save as template',
        icon: <LayoutTemplate />,
        onSelect: () => void A.saveAsTemplate(e.id),
      },
    );
  }
  items.push({ label: 'Export', icon: <Download />, submenu: exportSubmenu(e) }, 'separator', {
    label: 'Move to Trash',
    icon: <Trash2 />,
    danger: true,
    shortcut: 'Delete',
    onSelect: () => void A.trashEntries([e.id]),
  });
  return items;
}

export function exportSubmenu(e: Entry): MenuEntry[] {
  if (e.kind === 'folder') {
    return [
      {
        label: 'Folder as .zip',
        icon: <FileArchive />,
        onSelect: () => void A.exportEntry(e.id, 'zip'),
      },
    ];
  }
  const items: MenuEntry[] = [
    {
      label: `Original file (${e.name.split('.').pop()})`,
      icon: <Download />,
      onSelect: () => void A.exportEntry(e.id, 'file'),
    },
  ];
  if (isMarkdownName(e.name)) {
    items.push(
      { label: 'HTML page', icon: <FileCode />, onSelect: () => void A.exportEntry(e.id, 'html') },
      { label: 'PDF (print)', icon: <Printer />, onSelect: () => void A.exportEntry(e.id, 'pdf') },
      {
        label: 'Plain text (.txt)',
        icon: <FileText />,
        onSelect: () => void A.exportEntry(e.id, 'txt'),
      },
    );
  }
  return items;
}

export function importSubmenu(targetId: string | null): MenuEntry[] {
  return [
    { label: 'Files…', icon: <FilePlus2 />, onSelect: () => pickImport('files', targetId) },
    { label: 'Folder…', icon: <FolderPlus />, onSelect: () => pickImport('folder', targetId) },
    { label: 'Zip archive…', icon: <FileArchive />, onSelect: () => pickImport('zip', targetId) },
  ];
}
