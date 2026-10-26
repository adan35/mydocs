import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  FolderInput,
  MoreHorizontal,
  Plus,
  Star,
  StarOff,
  Trash2,
  X,
} from 'lucide-react';
import type { Entry, EntryId } from '@/domain/types';
import { sortEntries } from '@/domain/tree';
import { appActions, useApp } from '@/app/app-store';
import { useEditor } from '@/app/editor-store';
import { useSettings } from '@/app/settings-store';
import * as A from '@/app/actions';
import { itemsFromDataTransfer } from '@/app/importer';
import { FileIcon } from '../components/FileIcon';
import { openMenu, openMenuAt, type MenuEntry } from '../components/Menu';
import { bulkMenu, entryMenu } from '../entry-menu';
import { rangeBetween, topLevel } from './tree-selection';
import { useMediaQuery, useTree } from '../hooks';

interface Row {
  entry: Entry;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  posinset: number;
  setsize: number;
}

const OVERSCAN = 12;
export const TREE_DRAG_TYPE = 'application/x-mydoc-entry';
/** Carries every id of a multi-selection drag as JSON; TREE_DRAG_TYPE holds just the first. */
const TREE_DRAG_IDS_TYPE = 'application/x-mydoc-entries';

/** The entries being dragged from the tree, lists or tabs: the whole selection, or one. */
export function draggedIds(dt: DataTransfer): EntryId[] {
  try {
    const ids: unknown = JSON.parse(dt.getData(TREE_DRAG_IDS_TYPE));
    if (Array.isArray(ids) && ids.length && ids.every((id) => typeof id === 'string'))
      return ids as EntryId[];
  } catch {
    // Not a multi-drag: fall through to the single id.
  }
  const one = dt.getData(TREE_DRAG_TYPE);
  return one ? [one as EntryId] : [];
}

function startDrag(ev: React.DragEvent, ids: EntryId[], names: string[]) {
  const dt = ev.dataTransfer;
  dt.setData(TREE_DRAG_TYPE, ids[0]!);
  dt.setData(TREE_DRAG_IDS_TYPE, JSON.stringify(ids));
  dt.setData('text/plain', names.join('\n'));
  dt.effectAllowed = 'move';
  if (ids.length > 1) {
    // A small "3 items" badge instead of the single row's ghost.
    const badge = document.createElement('div');
    badge.textContent = `${ids.length} items`;
    badge.className = 'fixed -top-96 rounded-md bg-ink px-2 py-1 text-[13px] text-canvas';
    document.body.append(badge);
    dt.setDragImage(badge, 0, 0);
    setTimeout(() => badge.remove());
  }
}

/** Drag props that carry an entry, so it can be dropped on folders, Trash or Favorites. */
export const entryDragProps = (e: Entry) => ({
  draggable: true,
  onDragStart: (ev: React.DragEvent) => {
    ev.dataTransfer.setData(TREE_DRAG_TYPE, e.id);
    ev.dataTransfer.setData('text/plain', e.name);
    ev.dataTransfer.effectAllowed = 'move';
  },
});

/**
 * A drop target for entries dragged from the tree, lists or tabs (Trash, Favorites).
 * `over` is true while an entry is held over it.
 */
export function useEntryDrop(onDrop: (ids: EntryId[]) => void) {
  const [over, setOver] = useState(false);
  const props = {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(TREE_DRAG_TYPE)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      setOver(false);
      const ids = draggedIds(e.dataTransfer);
      if (!ids.length) return;
      e.preventDefault();
      e.stopPropagation();
      onDrop(ids);
    },
  };
  return { over, props };
}

/**
 * The workspace tree. Virtualized (only visible rows render) so workspaces with
 * thousands of entries stay smooth. Implements the WAI-ARIA tree pattern.
 */
export function FileTree() {
  const tree = useTree()!;
  const expanded = useApp((s) => s.expanded);
  const activeId = useEditor((s) => s.activeId);
  const density = useSettings((s) => s.density);
  const sortKey = useSettings((s) => s.explorerSort);
  const sortDir = useSettings((s) => s.explorerSortDir);
  const touch = useMediaQuery('(pointer: coarse)');
  const rowHeight = touch ? (density === 'compact' ? 36 : 40) : density === 'compact' ? 26 : 30;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const [focusId, setFocusId] = useState<EntryId | null>(null);
  const [dropTarget, setDropTarget] = useState<EntryId | 'root' | null>(null);
  // Multi-selection (Shift/Ctrl+click). Empty means plain single-item browsing.
  const [selection, setSelection] = useState<EntryId[]>([]);
  const anchor = useRef<EntryId | null>(null);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (parentId: EntryId | null, depth: number) => {
      const children = sortEntries(tree.childrenOf(parentId), sortKey, sortDir);
      children.forEach((entry, index) => {
        const isOpen = entry.kind === 'folder' && !!expanded[entry.id];
        out.push({
          entry,
          depth,
          // Position among its siblings, for screen readers.
          posinset: index + 1,
          setsize: children.length,
          expanded: isOpen,
          hasChildren: entry.kind === 'folder' && tree.childrenOf(entry.id).length > 0,
        });
        if (isOpen) walk(entry.id, depth + 1);
      });
    };
    walk(null, 0);
    return out;
  }, [tree, expanded, sortKey, sortDir]);

  // Forget items that are gone or hidden (trashed, moved, collapsed).
  useEffect(() => {
    const live = new Set(rows.map((r) => r.entry.id));
    setSelection((s) => (s.every((id) => live.has(id)) ? s : s.filter((id) => live.has(id))));
  }, [rows]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewport({ top: el.scrollTop, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener('scroll', update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', update);
    };
  }, []);

  // Keep the active document visible.
  useEffect(() => {
    if (!activeId) return;
    const i = rows.findIndex((r) => r.entry.id === activeId);
    const el = scrollRef.current;
    if (i < 0 || !el) return;
    const y = i * rowHeight;
    if (y < el.scrollTop || y + rowHeight > el.scrollTop + el.clientHeight)
      el.scrollTop = y - el.clientHeight / 3;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const start = Math.max(0, Math.floor(viewport.top / rowHeight) - OVERSCAN);
  const end = Math.min(
    rows.length,
    Math.ceil((viewport.top + viewport.height) / rowHeight) + OVERSCAN,
  );
  const tabStop =
    focusId && rows.some((r) => r.entry.id === focusId) ? focusId : (activeId ?? rows[0]?.entry.id);

  const focusRow = useCallback(
    (id: EntryId) => {
      setFocusId(id);
      const i = rows.findIndex((r) => r.entry.id === id);
      const el = scrollRef.current;
      if (el && i >= 0) {
        const y = i * rowHeight;
        if (y < el.scrollTop) el.scrollTop = y;
        else if (y + rowHeight > el.scrollTop + el.clientHeight)
          el.scrollTop = y + rowHeight - el.clientHeight;
      }
      requestAnimationFrame(() =>
        scrollRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)?.focus(),
      );
    },
    [rows, rowHeight],
  );

  const selectRange = (to: EntryId, extra: EntryId[] = []) =>
    setSelection([
      ...new Set([
        ...extra,
        ...rangeBetween(
          rows.map((r) => r.entry.id),
          anchor.current ?? activeId ?? to,
          to,
        ),
      ]),
    ]);

  const onRowClick = (e: React.MouseEvent, entry: Entry, open: boolean) => {
    const additive = e.ctrlKey || e.metaKey;
    if (e.shiftKey) return selectRange(entry.id, additive ? selection : []);
    const previous = anchor.current;
    anchor.current = entry.id;
    if (additive)
      return setSelection((s) =>
        s.includes(entry.id)
          ? s.filter((id) => id !== entry.id)
          : // The first Ctrl+click keeps the row you last clicked, like Explorer.
            [...(s.length || !previous ? s : [previous]), entry.id],
      );
    setSelection([]);
    if (entry.kind === 'folder') appActions.setExpanded(entry.id, !open);
    else void A.openEntry(entry.id);
  };

  const selectedTop = () => topLevel(selection, (id, anc) => tree.isWithin(id, anc));
  /** The context menu for a row: bulk actions when it is part of a multi-selection. */
  const menuFor = (entry: Entry) =>
    selection.length > 1 && selection.includes(entry.id)
      ? {
          items: bulkMenu(selectedTop().map((id) => tree.get(id)!)),
          label: `${selection.length} selected`,
        }
      : { items: entryMenu(entry), label: entry.name };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = rows.findIndex((r) => r.entry.id === tabStop);
    const row = rows[i];
    if (!row) return;
    const { entry } = row;
    const key = e.key;
    const mod = e.ctrlKey || e.metaKey;
    const step = key === 'ArrowDown' ? rows[i + 1] : key === 'ArrowUp' ? rows[i - 1] : undefined;
    if (e.shiftKey && step) {
      anchor.current ??= entry.id;
      selectRange(step.entry.id);
      focusRow(step.entry.id);
    } else if (mod && key.toLowerCase() === 'a') setSelection(rows.map((r) => r.entry.id));
    else if (key === 'Escape' && selection.length) setSelection([]);
    else if (mod && key === ' ') {
      anchor.current = entry.id;
      setSelection((s) =>
        s.includes(entry.id) ? s.filter((id) => id !== entry.id) : [...s, entry.id],
      );
    } else if (key === 'ArrowDown' && rows[i + 1]) focusRow(rows[i + 1]!.entry.id);
    else if (key === 'ArrowUp' && rows[i - 1]) focusRow(rows[i - 1]!.entry.id);
    else if (key === 'Home' && rows[0]) focusRow(rows[0].entry.id);
    else if (key === 'End' && rows.length) focusRow(rows[rows.length - 1]!.entry.id);
    else if (key === 'ArrowRight') {
      if (entry.kind === 'folder' && !row.expanded) appActions.setExpanded(entry.id, true);
      else if (row.expanded && rows[i + 1]) focusRow(rows[i + 1]!.entry.id);
    } else if (key === 'ArrowLeft') {
      if (row.expanded) appActions.setExpanded(entry.id, false);
      else if (entry.parentId) focusRow(entry.parentId);
    } else if (key === 'Enter' || key === ' ') {
      if (entry.kind === 'folder') appActions.setExpanded(entry.id, !row.expanded);
      else void A.openEntry(entry.id);
    } else if (key === 'F2') void A.renameEntry(entry.id);
    else if (key === 'Delete' || (key === 'Backspace' && (e.metaKey || e.ctrlKey))) {
      // Trash the whole selection when the focused row is part of it.
      const ids = selection.includes(entry.id) ? selectedTop() : [entry.id];
      // Keep focus in the tree: the next row outside the trashed items, else the previous one.
      const outside = (r: Row) => !ids.some((id) => tree.isWithin(r.entry.id, id));
      const neighbor = rows.slice(i + 1).find(outside) ?? rows.slice(0, i).reverse().find(outside);
      void A.trashEntries(ids).then(() => neighbor && focusRow(neighbor.entry.id));
    } else if (key === 'ContextMenu' || (key === 'F10' && e.shiftKey)) {
      const el = e.target as HTMLElement;
      const { items, label } = menuFor(entry);
      openMenuAt(el, items, label);
    } else return;
    e.preventDefault();
  };

  const onDrop = async (e: React.DragEvent, targetId: EntryId | null) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    const moving = draggedIds(e.dataTransfer).filter((id) => tree.get(id)?.parentId !== targetId);
    if (e.dataTransfer.types.includes(TREE_DRAG_TYPE)) {
      if (moving.length) await A.moveEntries(moving, targetId);
      return;
    }
    if (e.dataTransfer.files.length)
      await A.runImport(await itemsFromDataTransfer(e.dataTransfer), targetId);
  };

  const dropProps = (targetId: EntryId | null) => ({
    onDragOver: (e: React.DragEvent) => {
      const types = e.dataTransfer.types;
      if (!types.includes(TREE_DRAG_TYPE) && !types.includes('Files')) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = types.includes('Files') ? 'copy' : 'move';
      setDropTarget(targetId ?? 'root');
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDropTarget(null);
    },
    onDrop: (e: React.DragEvent) => void onDrop(e, targetId),
  });

  if (!rows.length) {
    return (
      <div className="flex-1 px-4 py-3 text-caption text-steel" {...dropProps(null)}>
        No files yet. Create a document or drop files here to import them.
      </div>
    );
  }

  const allFavorite = selection.every((id) => tree.get(id)?.favorite);
  const selectedSet = new Set(selection);

  return (
    <>
      {selection.length > 0 && (
        <div
          role="toolbar"
          aria-label="Selected items"
          className="mx-2 mb-1 flex items-center gap-0.5 rounded-md bg-active px-2 py-0.5 text-[13px]"
        >
          <span className="flex-1 font-medium text-ink" aria-live="polite">
            {selection.length} selected
          </span>
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            aria-label={
              allFavorite ? 'Remove selected from favorites' : 'Add selected to favorites'
            }
            title={allFavorite ? 'Remove from favorites' : 'Add to favorites'}
            onClick={() => void A.favoriteEntries(selection, !allFavorite)}
          >
            {allFavorite ? <StarOff size={14} /> : <Star size={14} />}
          </button>
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            aria-label="Move selected to…"
            title="Move to…"
            onClick={() => void A.moveEntries(selectedTop())}
          >
            <FolderInput size={14} />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            aria-label="Move selected to Trash"
            title="Move to Trash"
            onClick={() => void A.trashEntries(selectedTop())}
          >
            <Trash2 size={14} />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            aria-label="Clear selection"
            title="Clear selection (Esc)"
            onClick={() => setSelection([])}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div
        ref={scrollRef}
        className={`scroll-area relative min-h-0 flex-1 px-1.5 pb-6 ${dropTarget === 'root' ? 'bg-[color-mix(in_srgb,var(--primary)_6%,transparent)]' : ''}`}
        {...dropProps(null)}
      >
        <div
          role="tree"
          aria-label="Files"
          aria-multiselectable
          style={{ height: rows.length * rowHeight, position: 'relative' }}
          onKeyDown={onKeyDown}
        >
          {rows.slice(start, end).map((row, i) => (
            <TreeRow
              key={row.entry.id}
              row={row}
              top={(start + i) * rowHeight}
              height={rowHeight}
              active={row.entry.id === activeId}
              selected={selectedSet.has(row.entry.id)}
              onRowClick={onRowClick}
              dragIds={(entry) => (selectedSet.has(entry.id) ? selectedTop() : [entry.id])}
              menuFor={menuFor}
              tabbable={row.entry.id === tabStop}
              dropping={dropTarget === row.entry.id}
              onFocus={setFocusId}
              dropProps={
                row.entry.kind === 'folder'
                  ? dropProps(row.entry.id)
                  : dropProps(row.entry.parentId)
              }
            />
          ))}
        </div>
      </div>
    </>
  );
}

interface RowProps {
  row: Row;
  top: number;
  height: number;
  active: boolean;
  selected: boolean;
  tabbable: boolean;
  dropping: boolean;
  onFocus(id: EntryId): void;
  onRowClick(e: React.MouseEvent, entry: Entry, open: boolean): void;
  /** Ids to drag from this row: the whole selection when the row is part of it. */
  dragIds(entry: Entry): EntryId[];
  menuFor(entry: Entry): { items: MenuEntry[]; label: string };
  dropProps: object;
}

const TreeRow = memo(function TreeRow({
  row,
  top,
  height,
  active,
  selected,
  tabbable,
  dropping,
  onFocus,
  onRowClick,
  dragIds,
  menuFor,
  dropProps,
}: RowProps) {
  const { entry, depth, expanded, hasChildren } = row;
  const isFolder = entry.kind === 'folder';
  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={isFolder ? expanded : undefined}
      aria-selected={active || selected}
      aria-posinset={row.posinset}
      aria-setsize={row.setsize}
      aria-label={entry.name}
      data-id={entry.id}
      tabIndex={tabbable ? 0 : -1}
      draggable
      title={entry.name}
      className={`group absolute right-0 left-0 flex cursor-pointer items-center gap-1 rounded-md pr-1 text-[14px] outline-none select-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] ${
        selected
          ? 'bg-[color-mix(in_srgb,var(--primary)_16%,transparent)] font-medium text-ink'
          : active
            ? 'bg-active font-medium text-ink'
            : 'text-charcoal hover:bg-hover'
      } ${dropping ? 'ring-2 ring-[var(--primary)] ring-inset' : ''}`}
      style={{ top, height, paddingLeft: 6 + depth * 14 }}
      onFocus={() => onFocus(entry.id)}
      onClick={(e) => onRowClick(e, entry, expanded)}
      onDoubleClick={() => {
        if (isFolder) void A.openEntry(entry.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu({ ...menuFor(entry), at: { x: e.clientX, y: e.clientY } });
      }}
      onDragStart={(e) => {
        const ids = dragIds(entry);
        startDrag(e, ids, ids.length > 1 ? [`${ids.length} items`] : [entry.name]);
      }}
      {...dropProps}
    >
      <span className="flex w-4 shrink-0 justify-center text-stone">
        {isFolder && (
          <ChevronRight
            size={14}
            aria-hidden
            className={`transition-transform duration-100 ${expanded ? 'rotate-90' : ''} ${hasChildren ? '' : 'opacity-40'}`}
          />
        )}
      </span>
      <FileIcon entry={entry} open={expanded} className="shrink-0 text-steel" />
      <span className="ml-1 min-w-0 flex-1 truncate">{entry.name}</span>
      <span className="hidden shrink-0 items-center group-focus-within:flex group-hover:flex [@media(pointer:coarse)]:flex">
        {isFolder && (
          <button
            type="button"
            tabIndex={-1}
            className="icon-btn icon-btn-sm"
            aria-label={`New document in ${entry.name}`}
            onClick={(e) => {
              e.stopPropagation();
              void A.chooseNewDocument(entry.id, e.shiftKey);
            }}
          >
            <Plus size={14} />
          </button>
        )}
        <button
          type="button"
          tabIndex={-1}
          className="icon-btn icon-btn-sm"
          aria-label={`Actions for ${entry.name}`}
          onClick={(e) => {
            e.stopPropagation();
            openMenuAt(e.currentTarget, entryMenu(entry), entry.name);
          }}
        >
          <MoreHorizontal size={14} />
        </button>
      </span>
    </div>
  );
});
