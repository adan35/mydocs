import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, MoreHorizontal, Plus } from 'lucide-react';
import type { Entry, EntryId } from '@/domain/types';
import { sortEntries } from '@/domain/tree';
import { appActions, useApp } from '@/app/app-store';
import { useEditor } from '@/app/editor-store';
import { useSettings } from '@/app/settings-store';
import * as A from '@/app/actions';
import { FileIcon } from '../components/FileIcon';
import { openMenu, openMenuAt } from '../components/Menu';
import { entryMenu } from '../entry-menu';
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

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = rows.findIndex((r) => r.entry.id === tabStop);
    const row = rows[i];
    if (!row) return;
    const { entry } = row;
    const key = e.key;
    if (key === 'ArrowDown' && rows[i + 1]) focusRow(rows[i + 1]!.entry.id);
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
      // Keep focus in the tree: move to the next row outside this item, else the previous one.
      const depth = row.depth;
      const after = rows.slice(i + 1).find((r) => r.depth <= depth);
      const neighbor = after ?? rows[i - 1];
      void A.trashEntries([entry.id]).then(() => neighbor && focusRow(neighbor.entry.id));
    } else if (key === 'ContextMenu' || (key === 'F10' && e.shiftKey)) {
      const el = e.target as HTMLElement;
      openMenuAt(el, entryMenu(entry), entry.name);
    } else return;
    e.preventDefault();
  };

  const onDrop = async (e: React.DragEvent, targetId: EntryId | null) => {
    const moving = e.dataTransfer.getData(TREE_DRAG_TYPE);
    if (!moving) return;
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    if (tree.get(moving)?.parentId !== targetId) await A.moveEntries([moving], targetId);
  };

  const dropProps = (targetId: EntryId | null) => ({
    onDragOver: (e: React.DragEvent) => {
      const types = e.dataTransfer.types;
      if (!types.includes(TREE_DRAG_TYPE)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setDropTarget(targetId ?? 'root');
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDropTarget(null);
    },
    onDrop: (e: React.DragEvent) => void onDrop(e, targetId),
  });

  if (!rows.length) {
    return (
      <div
        className="flex-1 px-4 py-3 text-caption text-steel"
        data-file-drop-folder=""
        {...dropProps(null)}
      >
        No files yet. Create a document or drop files here to import them.
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      data-file-drop-folder=""
      className={`scroll-area relative min-h-0 flex-1 px-1.5 pb-6 ${dropTarget === 'root' ? 'bg-[color-mix(in_srgb,var(--primary)_6%,transparent)]' : ''}`}
      {...dropProps(null)}
    >
      <div
        role="tree"
        aria-label="Files"
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
            tabbable={row.entry.id === tabStop}
            dropping={dropTarget === row.entry.id}
            onFocus={setFocusId}
            dropProps={
              row.entry.kind === 'folder' ? dropProps(row.entry.id) : dropProps(row.entry.parentId)
            }
          />
        ))}
      </div>
    </div>
  );
}

interface RowProps {
  row: Row;
  top: number;
  height: number;
  active: boolean;
  tabbable: boolean;
  dropping: boolean;
  onFocus(id: EntryId): void;
  dropProps: object;
}

const TreeRow = memo(function TreeRow({
  row,
  top,
  height,
  active,
  tabbable,
  dropping,
  onFocus,
  dropProps,
}: RowProps) {
  const { entry, depth, expanded, hasChildren } = row;
  const isFolder = entry.kind === 'folder';
  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={isFolder ? expanded : undefined}
      aria-selected={active}
      aria-posinset={row.posinset}
      aria-setsize={row.setsize}
      aria-label={entry.name}
      data-id={entry.id}
      data-file-drop-folder={isFolder ? entry.id : (entry.parentId ?? '')}
      tabIndex={tabbable ? 0 : -1}
      draggable
      title={entry.name}
      className={`group absolute right-0 left-0 flex cursor-pointer items-center gap-1 rounded-md pr-1 text-[14px] outline-none select-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] ${
        active ? 'bg-active font-medium text-ink' : 'text-charcoal hover:bg-hover'
      } ${dropping ? 'ring-2 ring-[var(--primary)] ring-inset' : ''}`}
      style={{ top, height, paddingLeft: 6 + depth * 14 }}
      onFocus={() => onFocus(entry.id)}
      onClick={() => {
        if (isFolder) appActions.setExpanded(entry.id, !expanded);
        else void A.openEntry(entry.id);
      }}
      onDoubleClick={() => {
        if (isFolder) void A.openEntry(entry.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu({
          items: entryMenu(entry),
          at: { x: e.clientX, y: e.clientY },
          label: entry.name,
        });
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData(TREE_DRAG_TYPE, entry.id);
        e.dataTransfer.setData('text/plain', entry.name);
        e.dataTransfer.effectAllowed = 'move';
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
              void A.newDocument(entry.id);
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
