import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownUp,
  ChevronRight,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  List,
  Rows3,
  Upload,
  MoreHorizontal,
  X,
  FolderInput,
  Trash2,
} from 'lucide-react';
import type { Entry, EntryId } from '@/domain/types';
import { sortEntries, type SortKey } from '@/domain/tree';
import { fileTypeOf } from '@/domain/names';
import { navigate } from '@/app/router';
import { useSettings, type ExplorerView } from '@/app/settings-store';
import * as A from '@/app/actions';
import { Page, EmptyState } from '../components/Page';
import { EntryList } from '../components/EntryList';
import { openMenuAt, type MenuEntry } from '../components/Menu';
import { entryMenu, importSubmenu } from '../entry-menu';
import { useLayout, useTree } from '../hooks';
import { TREE_DRAG_TYPE } from '../layout/FileTree';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'modified', label: 'Date modified' },
  { key: 'created', label: 'Date created' },
  { key: 'type', label: 'Type' },
  { key: 'size', label: 'Size' },
];

type TypeFilter = 'all' | 'documents' | 'folders' | 'images' | 'other';

export function FolderView({ id }: { id: EntryId | null }) {
  const tree = useTree()!;
  const folder = id ? tree.get(id) : undefined;
  const settings = useSettings();
  const { phone } = useLayout();
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [selected, setSelected] = useState<Set<EntryId>>(new Set());
  const [dropping, setDropping] = useState(false);
  const hasSelection = selected.size > 0;

  // Escape clears a multi-selection (when no menu or dialog is using the key).
  useEffect(() => {
    if (!hasSelection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      setSelected(new Set());
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [hasSelection]);

  const live = !id || (folder && folder.kind === 'folder' && !tree.isTrashed(id));
  const entries = useMemo(() => {
    if (!live) return [];
    const q = filter.trim().toLowerCase();
    const list = tree.childrenOf(id).filter((e) => {
      if (q && !e.name.toLowerCase().includes(q)) return false;
      const t = e.kind === 'folder' ? 'folder' : fileTypeOf(e.name);
      if (typeFilter === 'folders') return t === 'folder';
      if (typeFilter === 'documents')
        return t === 'markdown' || t === 'text' || t === 'code' || t === 'data';
      if (typeFilter === 'images') return t === 'image';
      if (typeFilter === 'other') return t === 'binary' || t === 'pdf';
      return true;
    });
    return sortEntries(list, settings.explorerSort, settings.explorerSortDir);
  }, [tree, id, live, filter, typeFilter, settings.explorerSort, settings.explorerSortDir]);

  if (!live) {
    return (
      <Page title="Folder not found">
        <EmptyState
          icon={<FolderOpen />}
          title="This folder no longer exists"
          actions={
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate({ name: 'folder', id: null })}
            >
              All files
            </button>
          }
        >
          It may have been moved to the Trash or deleted.
        </EmptyState>
      </Page>
    );
  }

  const ancestors = id ? tree.ancestors(id) : [];
  const sortMenu: MenuEntry[] = [
    ...SORTS.map((s) => ({
      label: `${s.label}${settings.explorerSort === s.key ? (settings.explorerSortDir === 'asc' ? ' ↑' : ' ↓') : ''}`,
      onSelect: () =>
        settings.update(
          settings.explorerSort === s.key
            ? { explorerSortDir: settings.explorerSortDir === 'asc' ? 'desc' : 'asc' }
            : {
                explorerSort: s.key,
                explorerSortDir: s.key === 'name' || s.key === 'type' ? 'asc' : 'desc',
              },
        ),
    })),
  ];

  const select = (e: Entry, mode: 'toggle' | 'range' | 'single') => {
    setSelected((prev) => {
      const next = new Set(mode === 'single' ? [] : prev);
      if (mode === 'range' && prev.size) {
        const ids = entries.map((x) => x.id);
        const last = [...prev].pop()!;
        const [a, b] = [ids.indexOf(last), ids.indexOf(e.id)].sort((x, y) => x - y);
        for (const x of ids.slice(a, (b ?? a ?? 0) + 1)) next.add(x);
      } else if (next.has(e.id)) next.delete(e.id);
      else next.add(e.id);
      return next;
    });
  };
  const selectedIds = [...selected].filter((s) => entries.some((e) => e.id === s));

  return (
    <div
      className={`h-full ${dropping ? 'bg-[color-mix(in_srgb,var(--primary)_5%,transparent)]' : ''}`}
      data-file-drop-folder={id ?? ''}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(TREE_DRAG_TYPE)) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropping(false)}
      onDrop={async (e) => {
        const moving = e.dataTransfer.getData(TREE_DRAG_TYPE);
        if (!moving) return;
        e.preventDefault();
        e.stopPropagation();
        setDropping(false);
        await A.moveEntries([moving], id);
      }}
    >
      <Page
        title={folder?.name ?? 'All files'}
        icon={<FolderOpen />}
        back={
          phone && id ? () => navigate({ name: 'folder', id: folder?.parentId ?? null }) : undefined
        }
        subtitle={
          ancestors.length || id ? (
            <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-0.5">
              <button
                type="button"
                className="hover:text-ink hover:underline"
                onClick={() => navigate({ name: 'folder', id: null })}
              >
                All files
              </button>
              {ancestors.map((a) => (
                <span key={a.id} className="flex items-center gap-0.5">
                  <ChevronRight size={12} aria-hidden />
                  <button
                    type="button"
                    className="hover:text-ink hover:underline"
                    onClick={() => navigate({ name: 'folder', id: a.id })}
                  >
                    {a.name}
                  </button>
                </span>
              ))}
            </nav>
          ) : (
            'Everything in this workspace'
          )
        }
        actions={
          <>
            <button type="button" className="btn btn-primary" onClick={() => void A.newFile(id)}>
              <FilePlus2 size={15} aria-hidden /> <span>New file</span>
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="New folder"
              title="New folder"
              onClick={() => void A.newFolder(id)}
            >
              <FolderPlus size={17} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Import"
              title="Import"
              onClick={(e) => openMenuAt(e.currentTarget, importSubmenu(id), 'Import')}
            >
              <Upload size={17} />
            </button>
            {folder && (
              <button
                type="button"
                className="icon-btn"
                aria-label="Folder actions"
                onClick={(e) => openMenuAt(e.currentTarget, entryMenu(folder), folder.name)}
              >
                <MoreHorizontal size={17} />
              </button>
            )}
          </>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            type="search"
            className="input h-8 min-w-0 basis-full sm:max-w-[240px] sm:flex-1 sm:basis-auto"
            placeholder="Filter by name"
            aria-label="Filter by name"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <select
            className="input h-8 w-auto pr-8"
            aria-label="Filter by type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          >
            <option value="all">All types</option>
            <option value="documents">Documents</option>
            <option value="folders">Folders</option>
            <option value="images">Images</option>
            <option value="other">Other files</option>
          </select>
          <span className="flex-1" />
          <button
            type="button"
            className="btn btn-ghost h-8 text-steel"
            onClick={(e) => openMenuAt(e.currentTarget, sortMenu, 'Sort by')}
          >
            <ArrowDownUp size={14} aria-hidden />{' '}
            {SORTS.find((s) => s.key === settings.explorerSort)?.label}
          </button>
          <div role="group" aria-label="View" className="flex rounded-md bg-surface p-0.5">
            {(
              [
                ['list', <List size={15} />],
                ['compact', <Rows3 size={15} />],
                ['grid', <LayoutGrid size={15} />],
              ] as [ExplorerView, React.ReactNode][]
            ).map(([v, icon]) => (
              <button
                key={v}
                type="button"
                aria-pressed={settings.explorerView === v}
                aria-label={`${v} view`}
                className={`tap flex size-7 items-center justify-center rounded-[5px] ${settings.explorerView === v ? 'bg-canvas text-ink shadow-1' : 'text-steel'}`}
                onClick={() => settings.update({ explorerView: v })}
              >
                {icon}
              </button>
            ))}
          </div>
        </div>

        {selectedIds.length > 0 && (
          <div
            className="mb-3 flex items-center gap-2 rounded-lg bg-primary-soft px-3 py-2 text-[14px] text-primary-soft-ink"
            role="toolbar"
            aria-label="Selection"
          >
            <span className="font-medium">{selectedIds.length} selected</span>
            <span className="flex-1" />
            <button
              type="button"
              className="btn btn-ghost h-7"
              onClick={() => void A.moveEntries(selectedIds).then(() => setSelected(new Set()))}
            >
              <FolderInput size={14} aria-hidden /> Move
            </button>
            <button
              type="button"
              className="btn btn-ghost h-7"
              onClick={() => void A.trashEntries(selectedIds).then(() => setSelected(new Set()))}
            >
              <Trash2 size={14} aria-hidden /> Delete
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Clear selection"
              onClick={() => setSelected(new Set())}
            >
              <X size={15} />
            </button>
          </div>
        )}

        {entries.length ? (
          <EntryList
            entries={entries}
            view={settings.explorerView}
            selected={selected}
            onSelect={select}
            dragProps={(e) => ({
              draggable: true,
              onDragStart: (ev: React.DragEvent) => ev.dataTransfer.setData(TREE_DRAG_TYPE, e.id),
              ...(e.kind === 'folder'
                ? {
                    onDragOver: (ev: React.DragEvent) => {
                      if (ev.dataTransfer.types.includes(TREE_DRAG_TYPE)) {
                        ev.preventDefault();
                        ev.stopPropagation();
                      }
                    },
                    onDrop: (ev: React.DragEvent) => {
                      const moving = ev.dataTransfer.getData(TREE_DRAG_TYPE);
                      if (!moving || moving === e.id) return;
                      ev.preventDefault();
                      ev.stopPropagation();
                      void A.moveEntries([moving], e.id);
                    },
                  }
                : {}),
            })}
          />
        ) : filter || typeFilter !== 'all' ? (
          <p className="py-10 text-center text-[14px] text-steel">
            Nothing here matches your filter.
          </p>
        ) : (
          <EmptyState
            icon={<FolderOpen />}
            title={id ? 'This folder is empty' : 'Your workspace is empty'}
            actions={
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void A.newFile(id)}
                >
                  New file
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={(e) => openMenuAt(e.currentTarget, importSubmenu(id), 'Import')}
                >
                  Import files
                </button>
              </>
            }
          >
            Create a document, or drag files and folders from your computer onto this page.
          </EmptyState>
        )}
      </Page>
    </div>
  );
}
