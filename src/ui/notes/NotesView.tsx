import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Bell,
  ImagePlus,
  LayoutGrid,
  ListChecks,
  Palette,
  Pin,
  Rows3,
  Search,
  StickyNote,
  Tag,
  Trash2,
  X,
  RotateCcw,
  Lightbulb,
} from 'lucide-react';
import {
  emptyNote,
  estimateHeight,
  hasFilter,
  masonry,
  matchesFilter,
  type NoteColor,
  type NoteFilter,
} from '@/domain/notes';
import * as A from '@/app/actions';
import { navigate } from '@/app/router';
import {
  deleteLabel,
  emptyNotesTrash,
  labelCounts,
  patchNotes,
  renameLabel,
  reorderNote,
  restoreNotes,
  trashNotes,
  useNotes,
  useNotesUi,
  type Note,
} from '@/app/notes';
import { EmptyState, Page } from '../components/Page';
import { openMenuAt } from '../components/Menu';
import { NoteCard, labelEntries } from './NoteCard';
import { useNoteKeys } from './keys';
import { NoteForm } from './NoteForm';
import { colorMenu, colorName } from './format';
import './notes.css';

type View = 'reminders' | 'archive' | 'trash' | undefined;
type Drag = { id: string; section: string } | null;

const TITLES = { reminders: 'Reminders', archive: 'Archive', trash: 'Trash' } as const;

export function NotesView({ view, label }: { view?: View; label?: string }) {
  const { live, trashed } = useNotes();
  const layout = useNotesUi((s) => s.layout);
  const selectedRaw = useNotesUi((s) => s.selected);
  const [filter, setFilter] = useState<NoteFilter>({ query: '' });
  const composer = useNotesUi((s) => s.composer);
  const setComposer = useNotesUi.getState().setComposer;
  const [drag, setDrag] = useState<Drag>(null);

  const searching = hasFilter(filter);
  const shown = useMemo(() => {
    if (searching)
      return (view === 'trash' ? trashed : live).filter((n) => matchesFilter(n, filter));
    if (view === 'archive') return live.filter((n) => n.archived);
    if (view === 'trash') return trashed;
    if (view === 'reminders')
      return live.filter((n) => n.reminder !== null).sort((a, b) => a.reminder! - b.reminder!);
    return live.filter((n) => !n.archived && (!label || n.labels.includes(label)));
  }, [live, trashed, view, label, filter, searching]);

  const everything = view === 'trash' ? trashed : live;
  const selected = useMemo(
    () => everything.filter((n) => selectedRaw.includes(n.id)),
    [everything, selectedRaw],
  );
  const select = useNotesUi.getState().select;
  const toggleSelect = (id: string) =>
    select(selectedRaw.includes(id) ? selectedRaw.filter((x) => x !== id) : [...selectedRaw, id]);

  useNoteKeys({ trash: view === 'trash', canCompose: !view || view === 'reminders' });

  // Selection belongs to one page.
  useEffect(() => select([]), [view, label, select]);

  const sections = !searching && !view;
  const pinned = sections ? shown.filter((n) => n.pinned) : [];
  const rest = sections ? shown.filter((n) => !n.pinned) : shown;
  const labels = labelCounts(live);
  const title = searching ? 'Search results' : label ? label : view ? TITLES[view] : 'Notes';
  const canCompose = !view || view === 'reminders';

  const gridProps = {
    layout,
    selecting: selected.length > 0,
    selectedIds: selectedRaw,
    onSelect: toggleSelect,
    drag,
    setDrag,
    trashed: view === 'trash',
  };

  return (
    <Page
      wide
      title={title}
      icon={view === 'trash' ? <Trash2 /> : view === 'archive' ? <Archive /> : <StickyNote />}
      actions={
        <>
          {view === 'trash' && trashed.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void emptyNotesTrash()}
            >
              Empty Trash
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            aria-label={layout === 'grid' ? 'List view' : 'Grid view'}
            title={layout === 'grid' ? 'List view' : 'Grid view'}
            onClick={() => useNotesUi.getState().setLayout(layout === 'grid' ? 'list' : 'grid')}
          >
            {layout === 'grid' ? <Rows3 size={18} /> : <LayoutGrid size={18} />}
          </button>
        </>
      }
    >
      <nav aria-label="Notes sections" className="mb-4 flex flex-wrap gap-2">
        <Pill
          current={!view && !label}
          onClick={() => navigate({ name: 'notes' })}
          icon={<Lightbulb size={14} />}
        >
          Notes
        </Pill>
        <Pill
          current={view === 'reminders'}
          onClick={() => navigate({ name: 'notes', view: 'reminders' })}
          icon={<Bell size={14} />}
        >
          Reminders
        </Pill>
        <Pill
          current={view === 'archive'}
          onClick={() => navigate({ name: 'notes', view: 'archive' })}
          icon={<Archive size={14} />}
        >
          Archive
        </Pill>
        <Pill
          current={view === 'trash'}
          onClick={() => navigate({ name: 'notes', view: 'trash' })}
          icon={<Trash2 size={14} />}
        >
          Trash{trashed.length ? ` (${trashed.length})` : ''}
        </Pill>
        {labels.map(([l]) => (
          <Pill
            key={l}
            current={label === l}
            onClick={() => navigate({ name: 'notes', label: l })}
            icon={<Tag size={14} />}
          >
            {l}
          </Pill>
        ))}
        {labels.length > 0 && (
          <button
            type="button"
            className="note-pill"
            onClick={(e) =>
              openMenuAt(
                e.currentTarget,
                labels.map(([l]) => ({
                  label: l,
                  icon: <Tag />,
                  submenu: [
                    { label: 'Rename…', onSelect: () => void renameLabel(l) },
                    { label: 'Delete…', danger: true, onSelect: () => void deleteLabel(l) },
                  ],
                })),
                'Edit labels',
              )
            }
          >
            Edit labels
          </button>
        )}
      </nav>

      <div className="mb-5 flex flex-col gap-2">
        <label className="relative block max-w-[600px]">
          <Search
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-steel"
            aria-hidden
          />
          <input
            type="search"
            className="input !pl-9"
            placeholder="Search notes"
            aria-label="Search notes"
            value={filter.query}
            onChange={(e) => setFilter({ ...filter, query: e.target.value })}
          />
        </label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Note filters">
          <Toggle
            on={!!filter.lists}
            onClick={() => setFilter({ ...filter, lists: !filter.lists })}
            icon={<ListChecks size={14} />}
          >
            Lists
          </Toggle>
          <Toggle
            on={!!filter.images}
            onClick={() => setFilter({ ...filter, images: !filter.images })}
            icon={<ImagePlus size={14} />}
          >
            Images
          </Toggle>
          <Toggle
            on={!!filter.reminders}
            onClick={() => setFilter({ ...filter, reminders: !filter.reminders })}
            icon={<Bell size={14} />}
          >
            Reminders
          </Toggle>
          <button
            type="button"
            className="note-pill"
            aria-pressed={!!filter.color}
            onClick={(e) =>
              openMenuAt(
                e.currentTarget,
                colorMenu(filter.color ?? null, (c) =>
                  setFilter({ ...filter, color: c === 'default' ? undefined : c }),
                ),
                'Color',
              )
            }
          >
            <Palette size={14} aria-hidden />
            {filter.color ? colorName(filter.color) : 'Color'}
          </button>
          {searching && (
            <button type="button" className="note-pill" onClick={() => setFilter({ query: '' })}>
              <X size={14} aria-hidden /> Clear
            </button>
          )}
        </div>
      </div>

      {selected.length > 0 && (
        <SelectionBar
          selected={selected}
          all={everything}
          trash={view === 'trash'}
          colorOf={(c) =>
            void patchNotes(
              selected.map((n) => n.id),
              { color: c },
            )
          }
        />
      )}

      {canCompose && !searching && (
        <div className="mx-auto mb-8 w-full max-w-[600px]">
          {composer ? (
            <NoteForm
              key={composer}
              variant="inline"
              initial={{
                ...emptyNote(),
                items: composer === 'list' ? [{ text: '', done: false }] : null,
                labels: label ? [label] : [],
              }}
              focus="title"
              onClose={() => setComposer(null)}
            />
          ) : (
            <div className="note flex items-center shadow-1" data-color="default">
              <button
                type="button"
                className="h-12 flex-1 px-4 text-left text-[15px] opacity-70"
                onClick={() => setComposer('note')}
              >
                Take a note…
              </button>
              <button
                type="button"
                className="icon-btn mr-1"
                aria-label="New list"
                title="New list"
                onClick={() => setComposer('list')}
              >
                <ListChecks size={18} />
              </button>
            </div>
          )}
        </div>
      )}

      {view === 'trash' && !searching && trashed.length > 0 && (
        <p className="mb-4 text-center text-[13px] text-steel">
          Notes in Trash can be restored or deleted forever. The same items are in the workspace
          Trash.
        </p>
      )}

      {shown.length === 0 ? (
        <Empty view={view} label={label} searching={searching} />
      ) : (
        <>
          {pinned.length > 0 && (
            <section aria-label="Pinned notes" className="mb-6">
              <h2 className="section-label mb-2">Pinned</h2>
              <NoteGrid notes={pinned} section="pinned" reorderable {...gridProps} />
            </section>
          )}
          <section aria-label={pinned.length ? 'Other notes' : 'Notes'}>
            {pinned.length > 0 && rest.length > 0 && <h2 className="section-label mb-2">Others</h2>}
            <NoteGrid notes={rest} section="rest" reorderable={sections} {...gridProps} />
          </section>
        </>
      )}
    </Page>
  );
}

function Pill({
  current,
  icon,
  onClick,
  children,
}: {
  current: boolean;
  icon: React.ReactNode;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="note-pill"
      aria-current={current ? 'page' : undefined}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  );
}

function Toggle({
  on,
  icon,
  onClick,
  children,
}: {
  on: boolean;
  icon: React.ReactNode;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className="note-pill" aria-pressed={on} onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}

function Empty({ view, label, searching }: { view: View; label?: string; searching: boolean }) {
  const text = searching
    ? ['No matching notes', 'Try different words or clear the filters.']
    : view === 'trash'
      ? ['Trash is empty', 'Deleted notes wait here until you delete them forever.']
      : view === 'archive'
        ? [
            'Your archived notes appear here',
            'Archive notes you want to keep but not see every day.',
          ]
        : view === 'reminders'
          ? ['Notes with reminders appear here', 'Use the bell on a note to be reminded.']
          : label
            ? [`No notes labeled "${label}"`, 'Add the label from a note’s tag button.']
            : [
                'Notes you add appear here',
                'Write a note above. Colors, labels, lists, pictures and reminders are all one click away.',
              ];
  return (
    <EmptyState icon={<StickyNote />} title={text[0]!}>
      {text[1]}
    </EmptyState>
  );
}

function SelectionBar({
  selected,
  all,
  trash,
  colorOf,
}: {
  selected: Note[];
  all: Note[];
  trash: boolean;
  colorOf(c: NoteColor): void;
}) {
  const ids = selected.map((n) => n.id);
  const allPinned = selected.every((n) => n.pinned);
  const allArchived = selected.every((n) => n.archived);
  const clear = () => useNotesUi.getState().select([]);
  return (
    <div
      role="toolbar"
      aria-label="Selected notes"
      className="sticky top-2 z-10 mb-4 flex items-center gap-1 rounded-lg border border-hairline bg-canvas px-2 py-1 shadow-2"
    >
      <button type="button" className="icon-btn" aria-label="Clear selection" onClick={clear}>
        <X size={16} />
      </button>
      <span className="mr-auto px-1 text-[14px] font-medium">{selected.length} selected</span>
      {trash ? (
        <>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void restoreNotes(ids).then(clear)}
          >
            <RotateCcw size={14} /> Restore
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void A.deletePermanently(ids).then(clear)}
          >
            <Trash2 size={14} /> Delete forever
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="icon-btn"
            aria-label={allPinned ? 'Unpin' : 'Pin'}
            title={allPinned ? 'Unpin' : 'Pin'}
            onClick={() =>
              void patchNotes(ids, {
                pinned: !allPinned,
                ...(allPinned ? {} : { archived: false }),
              })
            }
          >
            <Pin size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Background options"
            title="Background options"
            onClick={(e) => openMenuAt(e.currentTarget, colorMenu(null, colorOf), 'Background')}
          >
            <Palette size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Add label"
            title="Add label"
            onClick={(e) => openMenuAt(e.currentTarget, labelEntries(selected, all), 'Labels')}
          >
            <Tag size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={allArchived ? 'Unarchive' : 'Archive'}
            title={allArchived ? 'Unarchive' : 'Archive'}
            onClick={() => {
              void patchNotes(ids, {
                archived: !allArchived,
                ...(allArchived ? {} : { pinned: false }),
              });
              clear();
            }}
          >
            <Archive size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Delete"
            title="Delete"
            onClick={() => void trashNotes(ids)}
          >
            <Trash2 size={16} />
          </button>
        </>
      )}
    </div>
  );
}

function NoteGrid({
  notes,
  section,
  reorderable,
  layout,
  selecting,
  selectedIds,
  onSelect,
  drag,
  setDrag,
  trashed,
}: {
  notes: Note[];
  section: string;
  reorderable: boolean;
  layout: 'grid' | 'list';
  selecting: boolean;
  selectedIds: string[];
  onSelect(id: string): void;
  drag: Drag;
  setDrag(d: Drag): void;
  trashed: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(960);
  const [over, setOver] = useState<string | null>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const min = width < 560 ? 160 : 240;
  const cols = layout === 'list' ? 1 : Math.max(1, Math.floor((width + 12) / (min + 12)));
  const colWidth = (width - (cols - 1) * 12) / cols;
  const columns = useMemo(
    () => masonry(notes, cols, (n) => estimateHeight(n, colWidth)),
    [notes, cols, colWidth],
  );
  const canDrag = reorderable && !selecting && !trashed;

  return (
    <div
      ref={ref}
      className={`flex items-start gap-3 ${layout === 'list' ? 'mx-auto max-w-[600px]' : ''}`}
      data-testid="note-grid"
    >
      {columns.map((col, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col gap-3">
          {col.map((n) => (
            <NoteCard
              key={n.id}
              note={n}
              trashed={trashed}
              selecting={selecting}
              selected={selectedIds.includes(n.id)}
              onSelect={() => onSelect(n.id)}
              draggable={canDrag}
              dragging={drag?.id === n.id}
              dropTarget={over === n.id}
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-mydoc-note', n.id);
                e.dataTransfer.effectAllowed = 'move';
                setDrag({ id: n.id, section });
              }}
              onDragOver={(e) => {
                if (drag?.section !== section || drag.id === n.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setOver(n.id);
              }}
              onDragLeave={() => setOver((o) => (o === n.id ? null : o))}
              onDrop={(e) => {
                if (drag?.section !== section) return;
                e.preventDefault();
                const from = notes.findIndex((x) => x.id === drag.id);
                const to = notes.findIndex((x) => x.id === n.id);
                setDrag(null);
                setOver(null);
                void reorderNote(notes, drag.id, n.id, from < to);
              }}
              onDragEnd={() => {
                setDrag(null);
                setOver(null);
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
