import {
  Copy,
  Download,
  FilePlus2,
  FolderInput,
  FolderPlus,
  History,
  Link2,
  FolderSync,
  LocateFixed,
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
  Users,
} from 'lucide-react';
import type { Entry } from '@/domain/types';
import { isMarkdownName } from '@/domain/names';
import * as A from '@/app/actions';
import { dialogs } from '@/app/dialog-store';
import { SHORTCUTS } from '@/app/shortcuts';
import type { MenuEntry } from './components/Menu';
import { pickImport } from './import-pickers';
import { cloudAvailable } from '@/app/cloud';
import { canWatchFolders, folderSync, useFolderLinks } from '@/app/folder-sync';
import { ws } from '@/app/app-store';

/** The context menu for a multi-selection in the tree. */
export function bulkMenu(entries: Entry[]): MenuEntry[] {
  const ids = entries.map((e) => e.id);
  const allFavorite = entries.every((e) => e.favorite);
  return [
    {
      label: allFavorite ? 'Remove from favorites' : 'Add to favorites',
      icon: allFavorite ? <StarOff /> : <Star />,
      onSelect: () => void A.favoriteEntries(ids, !allFavorite),
    },
    { label: 'Move to…', icon: <FolderInput />, onSelect: () => void A.moveEntries(ids) },
    'separator',
    {
      label: 'Move to Trash',
      icon: <Trash2 />,
      danger: true,
      shortcut: 'Delete',
      onSelect: () => void A.trashEntries(ids),
    },
  ];
}

/** The context menu for any file or folder, shared by the tree, lists and headers. */
export function entryMenu(e: Entry): MenuEntry[] {
  const items: MenuEntry[] = [
    {
      label: 'Reveal in Files',
      icon: <LocateFixed />,
      onSelect: () => A.revealInFiles(e.id),
    },
    'separator',
  ];
  if (e.kind === 'folder') {
    items.push(
      {
        label: 'New document…',
        icon: <FilePlus2 />,
        onSelect: () => void A.chooseNewDocument(e.id),
      },
      {
        label: 'New from template…',
        icon: <LayoutTemplate />,
        onSelect: () => void A.newFromTemplate(e.id),
      },
      { label: 'New folder', icon: <FolderPlus />, onSelect: () => void A.newFolder(e.id) },
      { label: 'Import into folder', icon: <Upload />, submenu: importSubmenu(e.id) },
      ...folderSyncItems(e.id),
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
    { label: 'Copy path', icon: <Link2 />, submenu: copyPathSubmenu(e) },
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
  if (cloudAvailable && e.kind === 'file' && ws().isEditable(e)) {
    items.push({ label: 'Share…', icon: <Users />, onSelect: () => void dialogs.share(e.id) });
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

/** The ways to copy where an entry is: paths, name, and a wiki link for documents. */
export function copyPathSubmenu(e: Entry): MenuEntry[] {
  const items: MenuEntry[] = [
    { label: 'Path in My Doc', onSelect: () => void A.copyPath(e.id, 'workspace') },
    { label: 'Full path (from root)', onSelect: () => void A.copyPath(e.id, 'absolute') },
    {
      label: 'Relative to open document',
      disabled: !A.relativeBase(e.id),
      onSelect: () => void A.copyPath(e.id, 'relative'),
    },
    {
      label: e.kind === 'file' ? 'File name' : 'Folder name',
      onSelect: () => void A.copyPath(e.id, 'name'),
    },
  ];
  if (e.kind === 'file' && isMarkdownName(e.name))
    items.push({ label: 'Wiki link', onSelect: () => void A.copyPath(e.id, 'wiki') });
  return items;
}

/** Keeping a folder in step with the folder on disk it was imported from. */
function folderSyncItems(id: string): MenuEntry[] {
  const link = useFolderLinks.getState().links[id];
  if (!link) {
    return canWatchFolders()
      ? [
          {
            label: 'Link to folder on disk…',
            icon: <FolderSync />,
            onSelect: () => void A.linkFolderToDisk(id),
          },
        ]
      : [];
  }
  return [
    {
      label: 'Sync folder with disk',
      icon: <FolderSync />,
      onSelect: () => void A.syncFolder(id),
    },
    {
      label: 'Watch folder for new files',
      checked: link.watch,
      onSelect: () => void folderSync.setWatch(id, !link.watch),
    },
    { label: 'Stop syncing with disk', onSelect: () => void folderSync.unlink(id) },
  ];
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
      { label: 'PDF', icon: <Printer />, onSelect: () => void A.exportEntry(e.id, 'pdf') },
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
