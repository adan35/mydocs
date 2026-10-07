import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CornerDownLeft, Search } from 'lucide-react';
import type { EntryId } from '@/domain/types';
import { useUi } from '@/app/ui-store';
import { session, useApp } from '@/app/app-store';
import { openEntry } from '@/app/actions';
import { editorActions } from '@/app/editor-store';
import { navigate } from '@/app/router';
import { FileIcon } from '../components/FileIcon';
import { Highlight } from '../components/Highlight';
import { fuzzyScore } from '../components/fuzzy';
import { formatShortcut, relativeTime, useTree } from '../hooks';
import { getCommands } from '../commands';
import { restoreFocusIfLost } from '../focus';

interface Item {
  key: string;
  group?: string;
  icon: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  hint?: ReactNode;
  run(): void;
}

function PaletteFrame({
  label,
  placeholder,
  query,
  setQuery,
  items,
  footer,
  emptyText,
}: {
  label: string;
  placeholder: string;
  query: string;
  setQuery(q: string): void;
  items: Item[];
  footer?: ReactNode;
  emptyText: string;
}) {
  const [index, setIndex] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => useUi.getState().setOverlay(null);
  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    const previous = document.activeElement;
    return () => restoreFocusIfLost(previous);
  }, []);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  const run = (item: Item | undefined) => {
    if (!item) return;
    close();
    item.run();
  };
  let lastGroup: string | undefined;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-2 pt-[8vh] sm:px-4 sm:pt-[12vh]"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="absolute inset-0 bg-[var(--scrim)]" aria-hidden onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="popover animate-in relative flex max-h-[min(560px,80vh)] w-full max-w-[620px] flex-col overflow-hidden"
      >
        <div className="flex items-center gap-2.5 border-b border-hairline px-4">
          <Search size={17} className="shrink-0 text-steel" aria-hidden />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={items[index] ? `${listId}-${index}` : undefined}
            aria-label={label}
            className="h-13 min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-stone"
            placeholder={placeholder}
            value={query}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(items.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                run(items[index]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
              }
            }}
          />
          <kbd className="kbd hidden sm:inline-flex">Esc</kbd>
        </div>
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          className="scroll-area min-h-0 flex-1 p-1.5"
        >
          {!items.length && (
            <p className="px-3 py-8 text-center text-[14px] text-steel">{emptyText}</p>
          )}
          {items.map((item, i) => {
            const header = item.group && item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={item.key}>
                {header && <div className="section-label px-2.5 pt-2.5 pb-1">{header}</div>}
                <div
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === index}
                  data-index={i}
                  className={`flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 ${i === index ? 'bg-active' : ''}`}
                  onMouseMove={() => i !== index && setIndex(i)}
                  onClick={() => run(item)}
                >
                  <span className="flex w-5 shrink-0 justify-center text-steel [&>svg]:size-4">
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] text-ink">{item.title}</span>
                    {item.subtitle && (
                      <span className="block truncate text-caption text-steel">
                        {item.subtitle}
                      </span>
                    )}
                  </span>
                  {item.hint}
                  {i === index && (
                    <CornerDownLeft size={14} className="shrink-0 text-stone" aria-hidden />
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {footer && (
          <div className="flex items-center gap-3 border-t border-hairline px-4 py-2 text-xs text-stone">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function CommandPalette() {
  const [query, setQuery] = useState('');
  const commands = useMemo(() => getCommands(), []);
  const items = useMemo<Item[]>(() => {
    const scored = commands
      .map((c) => ({
        c,
        m:
          fuzzyScore(query, `${c.title}`) ??
          (query && c.keywords && fuzzyScore(query, c.keywords)
            ? { score: -500, positions: [] }
            : null),
      }))
      .filter((x) => x.m)
      .sort((a, b) => (query ? b.m!.score - a.m!.score : 0));
    return scored.map(({ c, m }) => ({
      key: c.id,
      group: query ? undefined : c.group,
      icon: c.icon,
      title: <Highlight text={c.title} positions={m!.positions} />,
      hint: c.shortcut ? <kbd className="kbd">{formatShortcut(c.shortcut)}</kbd> : undefined,
      run: c.run,
    }));
  }, [commands, query]);
  return (
    <PaletteFrame
      label="Command palette"
      placeholder="Type a command…"
      query={query}
      setQuery={setQuery}
      items={items}
      emptyText="No matching commands."
    />
  );
}

export function QuickOpen() {
  const [query, setQuery] = useState('');
  const tree = useTree()!;
  const recents = useApp((s) => s.recents);
  const openCounts = useApp((s) => s.openCounts);
  const items = useMemo<Item[]>(() => {
    const q = query.trim();
    const toItem = (id: EntryId, positions?: number[], group?: string): Item | null => {
      const e = tree.get(id);
      if (!e || tree.isTrashed(id)) return null;
      const dir = tree.dirOf(id);
      return {
        key: id,
        group,
        icon: <FileIcon entry={e} />,
        title: <Highlight text={e.name} positions={positions} />,
        subtitle: dir || 'Workspace root',
        hint:
          !q && e.updatedAt ? (
            <span className="text-xs text-stone">{relativeTime(e.updatedAt)}</span>
          ) : undefined,
        run: () => {
          if (e.kind === 'file') editorActions.requestFocus(id);
          void openEntry(id);
        },
      };
    };
    if (!q) {
      const recent = recents
        .map((r) => toItem(r.id, undefined, 'Recent'))
        .filter(Boolean) as Item[];
      if (recent.length) return recent.slice(0, 12);
      return tree
        .liveFiles()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 12)
        .map((e) => toItem(e.id, undefined, 'Recently modified')!)
        .filter(Boolean);
    }
    // Exact title, then prefix, then fuzzy name, path and tag matches; documents
    // opened recently or often rank higher.
    const recentSet = new Map(recents.map((r, i) => [r.id, 60 - i * 2]));
    const ql = q.toLowerCase();
    const tagQuery = ql.replace(/^#/, '');
    const knowledge = session().knowledge;
    const scored: { id: EntryId; score: number; positions: number[] }[] = [];
    for (const e of tree.liveEntries()) {
      const name = e.name.toLowerCase();
      const stem = name.replace(/\.[^.]+$/, '');
      const byName = fuzzyScore(q, e.name);
      const byPath = byName ? null : fuzzyScore(q, tree.pathOf(e.id));
      let m = byName ?? (byPath ? { score: byPath.score - 300, positions: [] } : null);
      if (!m && e.kind === 'file' && tagQuery.length > 1) {
        const tagHit = knowledge.tagsOf(e.id).some((t) => t.startsWith(tagQuery));
        if (tagHit) m = { score: -400, positions: [] };
      }
      if (!m) continue;
      let score = m.score;
      if (stem === ql || name === ql) score += 2000;
      else if (name.startsWith(ql)) score += 600;
      score += recentSet.get(e.id) ?? 0;
      score += Math.min(120, Math.log2((openCounts[e.id] ?? 0) + 1) * 25);
      if (e.kind === 'folder') score -= 5;
      scored.push({ id: e.id, score, positions: m.positions });
    }
    scored.sort((a, b) => b.score - a.score);
    const out = scored
      .slice(0, 50)
      .map((s) => toItem(s.id, s.positions))
      .filter(Boolean) as Item[];
    // Offer full-text search as the last option.
    out.push({
      key: '__search',
      icon: <Search />,
      title: `Search contents for "${q}"`,
      subtitle: 'Full-text search across every document',
      run: () => navigate({ name: 'search', q }),
    });
    return out;
  }, [query, tree, recents, openCounts]);
  return (
    <PaletteFrame
      label="Open document"
      placeholder="Open a document or folder…"
      query={query}
      setQuery={setQuery}
      items={items}
      emptyText="No documents yet."
      footer={
        <>
          <span>
            <kbd className="kbd">↑↓</kbd> to navigate
          </span>
          <span>
            <kbd className="kbd">Enter</kbd> to open
          </span>
        </>
      }
    />
  );
}
