import { MoreHorizontal, Star } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Entry } from '@/domain/types';
import { formatBytes } from '@/domain/names';
import { openEntry } from '@/app/actions';
import { FileIcon } from './FileIcon';
import { openMenu, openMenuAt, type MenuEntry } from './Menu';
import { entryMenu } from '../entry-menu';
import { relativeTime, useTree } from '../hooks';
import { entryDragProps } from '../layout/FileTree';

interface Props {
  entries: Entry[];
  view?: 'list' | 'compact' | 'grid';
  showPath?: boolean;
  meta?: (e: Entry) => ReactNode;
  menu?: (e: Entry) => MenuEntry[];
  onOpen?: (e: Entry) => void;
  selected?: Set<string>;
  onSelect?: (e: Entry, mode: 'toggle' | 'range' | 'single') => void;
  dragProps?: (e: Entry) => object;
  trailing?: (e: Entry) => ReactNode;
}

/** A list or grid of entries, used by folder, favorites, recent, tag and trash views. */
export function EntryList({
  entries,
  view = 'list',
  showPath,
  meta,
  menu = entryMenu,
  onOpen,
  selected,
  onSelect,
  dragProps,
  trailing,
}: Props) {
  const tree = useTree()!;
  const open = onOpen ?? ((e: Entry) => void openEntry(e.id));
  // Entries can be dragged onto folders, Trash or Favorites from any list; trashed ones can't.
  const drag = dragProps ?? ((e: Entry) => (tree.isTrashed(e.id) ? {} : entryDragProps(e)));
  const onClick = (e: Entry, ev: React.MouseEvent) => {
    if (onSelect && (ev.metaKey || ev.ctrlKey)) return onSelect(e, 'toggle');
    if (onSelect && ev.shiftKey) return onSelect(e, 'range');
    open(e);
  };
  const ctx = (e: Entry) => (ev: React.MouseEvent) => {
    ev.preventDefault();
    openMenu({ items: menu(e), at: { x: ev.clientX, y: ev.clientY }, label: e.name });
  };

  if (view === 'grid') {
    return (
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" role="list">
        {entries.map((e) => (
          <li key={e.id} className="group relative">
            <button
              type="button"
              className={`card flex h-full w-full flex-col items-start gap-3 p-4 text-left transition-colors hover:bg-surface-soft ${selected?.has(e.id) ? 'ring-2 ring-[var(--primary)]' : ''}`}
              onClick={(ev) => onClick(e, ev)}
              onContextMenu={ctx(e)}
              title={tree.pathOf(e.id)}
              {...drag(e)}
            >
              <span className="flex size-9 items-center justify-center rounded-lg bg-surface text-steel">
                <FileIcon entry={e} size={18} />
              </span>
              <span className="w-full min-w-0">
                <span className="line-clamp-2 pr-6 text-[14px] font-medium break-words text-ink">
                  {e.favorite && (
                    <Star
                      size={12}
                      aria-label="Favorite"
                      className="mr-1 inline align-[-1px] fill-[#f5c84c] text-[#e0a800]"
                    />
                  )}
                  {e.name}
                </span>
                <span className="mt-0.5 block truncate text-xs text-steel">
                  {meta ? meta(e) : relativeTime(e.updatedAt)}
                </span>
              </span>
            </button>
            <button
              type="button"
              className="icon-btn absolute top-2 right-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
              aria-label={`Actions for ${e.name}`}
              onClick={(ev) => openMenuAt(ev.currentTarget, menu(e), e.name)}
            >
              <MoreHorizontal size={16} />
            </button>
          </li>
        ))}
      </ul>
    );
  }

  const compact = view === 'compact';
  return (
    <ul
      className="divide-y divide-hairline-soft overflow-hidden rounded-lg border border-hairline"
      role="list"
    >
      {entries.map((e) => (
        <li
          key={e.id}
          className={`group flex items-center gap-1 pr-1.5 ${selected?.has(e.id) ? 'bg-primary-soft' : 'hover:bg-surface-soft'}`}
          onContextMenu={ctx(e)}
          {...drag(e)}
        >
          <button
            type="button"
            className={`entry-row flex min-w-0 flex-1 items-center gap-3 pl-3 text-left ${compact ? 'py-1.5' : 'py-2.5'}`}
            onClick={(ev) => onClick(e, ev)}
            title={tree.pathOf(e.id)}
          >
            <FileIcon entry={e} className="shrink-0 text-steel" size={compact ? 15 : 17} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[14px] text-ink">{e.name}</span>
                {e.favorite && (
                  <Star
                    size={12}
                    className="shrink-0 fill-[#f5c84c] text-[#e0a800]"
                    aria-label="Favorite"
                  />
                )}
              </span>
              {showPath && !compact && (
                <span className="block truncate text-xs text-steel">
                  {tree.dirOf(e.id) || 'Workspace root'}
                </span>
              )}
            </span>
            <span className="hidden shrink-0 text-right text-caption text-steel sm:block">
              {meta ? meta(e) : relativeTime(e.updatedAt)}
            </span>
            {!compact && e.kind === 'file' && (
              <span className="hidden w-16 shrink-0 text-right text-caption text-stone md:block">
                {formatBytes(e.size)}
              </span>
            )}
          </button>
          {trailing?.(e)}
          <button
            type="button"
            className="icon-btn opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
            aria-label={`Actions for ${e.name}`}
            onClick={(ev) => openMenuAt(ev.currentTarget, menu(e), e.name)}
          >
            <MoreHorizontal size={16} />
          </button>
        </li>
      ))}
    </ul>
  );
}
