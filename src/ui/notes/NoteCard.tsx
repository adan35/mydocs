import { useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Bell,
  Check,
  Copy,
  EllipsisVertical,
  ImagePlus,
  ListChecks,
  Palette,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Tag,
  Trash2,
  ArrowUpToLine,
  FileText,
  Repeat as RepeatIcon,
} from 'lucide-react';
import type { NoteItem } from '@/domain/notes';
import * as A from '@/app/actions';
import {
  addImages,
  askNotificationPermission,
  copyNote,
  createLabelFor,
  editNotes,
  labelCounts,
  moveNoteToTop,
  openNote,
  patchNotes,
  restoreNotes,
  setLabel,
  trashNotes,
  useNotes,
  type Note,
} from '@/app/notes';
import { toast } from '@/app/toast-store';
import { openMenuAt, type MenuEntry } from '../components/Menu';
import { NoteImage } from './NoteImage';
import { ReminderDialog } from './ReminderDialog';
import { REPEAT_NAMES, colorMenu, formatReminder, reminderPresets } from './format';

const MAX_ITEMS = 8;

export interface CardProps {
  note: Note;
  trashed?: boolean;
  /** At least one note is selected, so clicking selects instead of opening. */
  selecting: boolean;
  selected: boolean;
  onSelect(): void;
  draggable?: boolean;
  dragging?: boolean;
  dropTarget?: boolean;
  onDragStart?(e: React.DragEvent): void;
  onDragOver?(e: React.DragEvent): void;
  onDragLeave?(): void;
  onDrop?(e: React.DragEvent): void;
  onDragEnd?(): void;
}

/** Menu entries for putting `ids` in or out of each label. */
export function labelEntries(notes: readonly Note[], all: readonly Note[]): MenuEntry[] {
  const ids = notes.map((n) => n.id);
  const entries: MenuEntry[] = labelCounts(all).map(([label]) => {
    const on = notes.every((n) => n.labels.includes(label));
    return { label, checked: on, onSelect: () => void setLabel(ids, label, !on) };
  });
  if (entries.length) entries.push('separator');
  entries.push({
    label: 'Create label…',
    icon: <Plus />,
    onSelect: () => void createLabelFor(ids),
  });
  return entries;
}

export function NoteCard(p: CardProps) {
  const { note: n, trashed } = p;
  const { live } = useNotes();
  const [reminderOpen, setReminderOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const open = () => (p.selecting ? p.onSelect() : openNote(n.id));
  const toggleItem = (i: number) =>
    void editNotes([n.id], (x) => ({
      items: x.items!.map((it, j) => (j === i ? { ...it, done: !it.done } : it)),
    }));
  const items = n.items?.map((it, i) => ({ it, i })) ?? [];
  const openItems: { it: NoteItem; i: number }[] = items.filter((x) => !x.it.done);
  const doneCount = items.length - openItems.length;
  const title = n.title || n.text.split('\n')[0] || n.items?.[0]?.text || 'Untitled note';

  const remind = (el: HTMLElement) =>
    openMenuAt(
      el,
      [
        ...reminderPresets().map((r) => ({
          label: r.label,
          icon: <Bell />,
          onSelect: () => {
            askNotificationPermission();
            void patchNotes([n.id], { reminder: r.at });
          },
        })),
        { label: 'Pick date & time…', onSelect: () => setReminderOpen(true) },
      ],
      'Remind me',
    );

  const more = (el: HTMLElement) =>
    openMenuAt(
      el,
      [
        {
          label: 'Delete note',
          icon: <Trash2 />,
          danger: true,
          onSelect: () => void trashNotes([n.id]),
        },
        { label: 'Add label', icon: <Tag />, submenu: labelEntries([n], live) },
        { label: 'Make a copy', icon: <Copy />, onSelect: () => void copyNote(n.id) },
        { label: 'Move to top', icon: <ArrowUpToLine />, onSelect: () => void moveNoteToTop(n.id) },
        {
          label: n.items ? 'Hide checkboxes' : 'Show checkboxes',
          icon: <ListChecks />,
          onSelect: () =>
            void editNotes([n.id], (x) =>
              x.items
                ? { items: null, text: x.items.map((i) => i.text).join('\n') }
                : {
                    text: '',
                    items: x.text
                      .split('\n')
                      .filter((l) => l.trim())
                      .map((text) => ({ text: text.trim(), done: false })),
                  },
            ),
        },
        { label: 'Select', icon: <Check />, onSelect: p.onSelect },
        { label: 'Open as document', icon: <FileText />, onSelect: () => void A.openEntry(n.id) },
      ],
      'Note actions',
    );

  const archive = () => {
    const archived = !n.archived;
    void patchNotes([n.id], { archived, ...(archived ? { pinned: false } : {}) });
    toast({
      message: archived ? 'Note archived.' : 'Note unarchived.',
      action: { label: 'Undo', run: () => void patchNotes([n.id], { archived: !archived }) },
    });
  };

  return (
    <article
      className="note note-card"
      data-color={n.color}
      data-selected={p.selected}
      data-selecting={p.selecting}
      data-pinned={n.pinned}
      data-has-image={n.images.length > 0}
      data-trashed={!!trashed}
      data-dragging={!!p.dragging}
      data-drop={!!p.dropTarget}
      data-testid="note-card"
      data-id={n.id}
      draggable={p.draggable}
      onDragStart={p.onDragStart}
      onDragOver={p.onDragOver}
      onDragLeave={p.onDragLeave}
      onDrop={p.onDrop}
      onDragEnd={p.onDragEnd}
      onClick={open}
    >
      <div
        role="button"
        data-note-open
        tabIndex={0}
        aria-label={`Open note: ${title}`}
        className={`note-text flex flex-col gap-2 rounded-xl pb-2 outline-offset-2 ${n.images.length ? '' : 'pt-3'}`}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            open();
          }
        }}
      >
        {n.images.length > 0 && (
          <div
            className={`grid gap-px overflow-hidden rounded-t-[11px] ${n.images.length > 1 ? 'grid-cols-2' : ''}`}
          >
            {n.images.slice(0, 4).map((href) => (
              <NoteImage
                key={href}
                href={href}
                className={
                  n.images.length > 1
                    ? 'h-28 w-full object-cover'
                    : 'h-auto max-h-80 w-full object-cover'
                }
              />
            ))}
          </div>
        )}
        {n.title && (
          <h3 className={`note-title px-4 pr-11 break-words ${n.images.length ? 'pt-1' : ''}`}>
            {n.title}
          </h3>
        )}
        {n.items ? (
          <ul className="flex flex-col gap-0.5 px-4">
            {openItems.slice(0, MAX_ITEMS).map(({ it, i }) => (
              <li key={i} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="note-check mt-[3px]"
                  checked={false}
                  aria-label={`Mark "${it.text}" as done`}
                  disabled={trashed}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleItem(i)}
                />
                <span className="note-body-text min-w-0 break-words">{it.text}</span>
              </li>
            ))}
            {openItems.length > MAX_ITEMS && (
              <li className="text-[13px] opacity-70">
                + {openItems.length - MAX_ITEMS} more items
              </li>
            )}
            {doneCount > 0 && (
              <li className="mt-1 flex items-center gap-1 text-[13px] opacity-70">
                <Check size={13} aria-hidden /> {doneCount} completed{' '}
                {doneCount === 1 ? 'item' : 'items'}
              </li>
            )}
          </ul>
        ) : (
          n.text && (
            <p className="note-body-text line-clamp-[10] px-4 break-words whitespace-pre-wrap">
              {n.text}
            </p>
          )
        )}
        {(n.reminder !== null || n.labels.length > 0) && (
          <div className="flex flex-wrap gap-1.5 px-4">
            {n.reminder !== null && (
              <span className="note-chip" data-overdue={n.reminder < Date.now()}>
                <Bell size={12} aria-hidden />
                {formatReminder(n.reminder)}
                {n.repeat && <RepeatIcon size={12} aria-label={REPEAT_NAMES[n.repeat]} />}
              </span>
            )}
            {n.labels.slice(0, 3).map((l) => (
              <span key={l} className="note-chip truncate">
                {l}
              </span>
            ))}
            {n.labels.length > 3 && <span className="note-chip">+{n.labels.length - 3}</span>}
          </div>
        )}
        {!n.title && !n.text && !n.items && !n.images.length && (
          <p className="note-body-text px-4 opacity-60">Empty note</p>
        )}
      </div>

      <button
        type="button"
        className="note-corner note-select"
        aria-label={p.selected ? 'Deselect note' : 'Select note'}
        aria-pressed={p.selected}
        onClick={(e) => {
          e.stopPropagation();
          p.onSelect();
        }}
      >
        <Check size={14} />
      </button>
      {!trashed && (
        <button
          type="button"
          className="note-pin note-corner icon-btn absolute top-1.5 right-1.5"
          aria-label={n.pinned ? 'Unpin note' : 'Pin note'}
          aria-pressed={n.pinned}
          onClick={(e) => {
            e.stopPropagation();
            void patchNotes([n.id], {
              pinned: !n.pinned,
              ...(n.pinned ? {} : { archived: false }),
            });
          }}
        >
          {n.pinned ? <PinOff size={16} /> : <Pin size={16} />}
        </button>
      )}
      <div
        className="note-tools flex items-center gap-0.5 px-1.5 pb-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        {trashed ? (
          <>
            <button
              type="button"
              className="icon-btn"
              aria-label="Restore note"
              title="Restore"
              onClick={() => void restoreNotes([n.id])}
            >
              <RotateCcw size={16} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Delete forever"
              title="Delete forever"
              onClick={() => void A.deletePermanently([n.id])}
            >
              <Trash2 size={16} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="icon-btn"
              aria-label="Remind me"
              title="Remind me"
              onClick={(e) => remind(e.currentTarget)}
            >
              <Bell size={16} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Background options"
              title="Background options"
              onClick={(e) =>
                openMenuAt(
                  e.currentTarget,
                  colorMenu(n.color, (color) => void patchNotes([n.id], { color })),
                  'Background',
                )
              }
            >
              <Palette size={16} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Add image"
              title="Add image"
              onClick={() => fileInput.current?.click()}
            >
              <ImagePlus size={16} />
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              aria-label="Choose images"
              onChange={(e) => {
                void addImages(n.id, [...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className="icon-btn"
              aria-label={n.archived ? 'Unarchive' : 'Archive'}
              title={n.archived ? 'Unarchive' : 'Archive'}
              onClick={archive}
            >
              {n.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="More"
              title="More"
              onClick={(e) => more(e.currentTarget)}
            >
              <EllipsisVertical size={16} />
            </button>
          </>
        )}
      </div>
      {reminderOpen && (
        // The dialog is a portal, but its clicks still bubble through React to the card.
        <div onClick={(e) => e.stopPropagation()}>
          <ReminderDialog
            initial={n.reminder}
            repeat={n.repeat}
            onSave={(reminder, repeat) => {
              if (reminder !== null) askNotificationPermission();
              void patchNotes([n.id], { reminder, repeat });
            }}
            onClose={() => setReminderOpen(false)}
          />
        </div>
      )}
    </article>
  );
}
