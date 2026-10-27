import { useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';
import {
  Archive,
  ArchiveRestore,
  Bell,
  ImagePlus,
  EllipsisVertical,
  ListChecks,
  Palette,
  Pin,
  PinOff,
  Plus,
  Tag,
  Trash2,
  Copy,
  FileText,
  X,
  ChevronRight,
  ChevronDown,
  Repeat as RepeatIcon,
} from 'lucide-react';
import type { EntryId } from '@/domain/types';
import { isEmptyNote, toggleChecklist, type NoteData } from '@/domain/notes';
import * as A from '@/app/actions';
import { dialogs } from '@/app/dialog-store';
import {
  addImages,
  askNotificationPermission,
  closeNote,
  copyNote,
  createNote,
  labelCounts,
  patchNotes,
  tidyNoteName,
  toLabel,
  trashNotes,
  useNotes,
} from '@/app/notes';
import { toast } from '@/app/toast-store';
import { openMenuAt, type MenuEntry } from '../components/Menu';
import { restoreFocus } from '../focus';
import { relativeTime } from '../hooks';
import { lockBackground } from '../modal';
import { MicButton } from '../aon/MicButton';
import { NoteImage } from './NoteImage';
import { ReminderDialog } from './ReminderDialog';
import { REPEAT_NAMES, colorMenu, formatReminder, reminderPresets } from './format';

interface Props {
  /** The note being edited; omit to write a new one. */
  id?: EntryId;
  initial: NoteData;
  /** `dialog` floats over the page; `inline` sits in it (the "Take a note" box). */
  variant: 'dialog' | 'inline';
  focus?: 'title' | 'body';
  editedAt?: number;
  onClose(): void;
}

function AutoText({
  inputRef,
  value,
  ...rest
}: { inputRef?: Ref<HTMLTextAreaElement>; value: string } & React.ComponentProps<'textarea'>) {
  const own = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = own.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      {...rest}
      value={value}
      rows={1}
      ref={(el) => {
        own.current = el;
        if (typeof inputRef === 'function') inputRef(el);
        else if (inputRef) inputRef.current = el;
      }}
    />
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose(): void }) {
  useEffect(() => {
    const previous = document.activeElement;
    const unlock = lockBackground();
    return () => {
      unlock();
      restoreFocus(previous);
    };
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[6vh] sm:pt-[10vh]">
      <div className="absolute inset-0 bg-[var(--scrim)]" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Note"
        className="relative w-full max-w-[600px]"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

const nameKey = (n: NoteData) => `${n.title}\n${n.text}\n${n.items?.[0]?.text}`;

/** Writes or edits one note. Edits save by themselves; a new note is saved when it is closed. */
export function NoteForm({ id, initial, variant, focus = 'body', editedAt, onClose }: Props) {
  const [d, setD] = useState(initial);
  const [files, setFiles] = useState<File[]>([]);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const { live } = useNotes();
  const latest = useRef({ d, files });
  latest.current = { d, files };
  const dirty = useRef(new Set<keyof NoteData>());
  const timer = useRef<number | undefined>(undefined);
  const closing = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const focusItem = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const startKey = useRef(nameKey(initial));
  const root = useRef<HTMLDivElement>(null);

  const flush = async () => {
    window.clearTimeout(timer.current);
    if (!id || !dirty.current.size) return;
    const patch: Record<string, unknown> = {};
    for (const k of dirty.current) patch[k] = latest.current.d[k];
    dirty.current.clear();
    await patchNotes([id], patch as Partial<NoteData>);
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => void flushRef.current(), []);

  const set = (patch: Partial<NoteData>) => {
    setD((p) => ({ ...p, ...patch }));
    if (!id) return;
    for (const k of Object.keys(patch)) dirty.current.add(k as keyof NoteData);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flushRef.current(), 500);
  };

  useEffect(() => {
    if (focus === 'title') titleRef.current?.focus();
    else {
      const el = bodyRef.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (focusItem.current === null) return;
    document.querySelector<HTMLInputElement>(`[data-item="${focusItem.current}"]`)?.focus();
    focusItem.current = null;
  });

  const close = async () => {
    if (closing.current) return;
    closing.current = true;
    const { d: draft, files: pending } = latest.current;
    if (id) {
      await flush();
      if (nameKey(draft) !== startKey.current) await tidyNoteName(id);
    } else if (!isEmptyNote(draft) || pending.length) {
      if ((await createNote(draft, pending)) && variant === 'dialog')
        toast({ message: 'Note saved.', tone: 'success' });
    }
    onClose();
  };

  const closeRef = useRef(close);
  closeRef.current = close;
  // The "Take a note" box saves when you click anywhere else, like Keep.
  useEffect(() => {
    if (variant !== 'inline') return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (root.current?.contains(t) || t.closest('[role="menu"], [role="dialog"]')) return;
      void closeRef.current();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [variant]);

  const addFiles = async (list: File[]) => {
    const images = list.filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    if (!id) return setFiles((p) => [...p, ...images]);
    const hrefs = await addImages(id, images);
    if (hrefs?.length) setD((p) => ({ ...p, images: [...p.images, ...hrefs] }));
  };

  const items = d.items;
  const setItems = (next: NonNullable<NoteData['items']>) => set({ items: next });
  const toggleDone = (i: number) =>
    setItems(items!.map((it, j) => (j === i ? { ...it, done: !it.done } : it)));
  const editItem = (i: number, text: string) =>
    setItems(items!.map((it, j) => (j === i ? { ...it, text } : it)));
  const addItemAfter = (i: number) => {
    const next = [...items!];
    next.splice(i + 1, 0, { text: '', done: false });
    focusItem.current = i + 1;
    setItems(next);
  };
  const removeItem = (i: number, focusPrev = false) => {
    if (focusPrev) focusItem.current = Math.max(0, i - 1);
    setItems(items!.filter((_, j) => j !== i));
  };

  const labelMenu = (el: HTMLElement) => {
    const all = [...new Set([...labelCounts(live).map(([l]) => l), ...d.labels])].sort();
    const entries: MenuEntry[] = all.map((l) => ({
      label: l,
      checked: d.labels.includes(l),
      onSelect: () =>
        set({ labels: d.labels.includes(l) ? d.labels.filter((x) => x !== l) : [...d.labels, l] }),
    }));
    if (entries.length) entries.push('separator');
    entries.push({
      label: 'Create label…',
      icon: <Plus />,
      onSelect: async () => {
        const input = await dialogs.prompt({
          title: 'New label',
          label: 'Label name',
          confirmLabel: 'Add',
          validate: (v) => (toLabel(v) ? null : 'Use letters or numbers; spaces become dashes.'),
        });
        const label = input && toLabel(input);
        if (label && !latest.current.d.labels.includes(label))
          set({ labels: [...latest.current.d.labels, label] });
      },
    });
    openMenuAt(el, entries, 'Labels');
  };

  const remindMenu = (el: HTMLElement) =>
    openMenuAt(
      el,
      [
        ...reminderPresets().map((p) => ({
          label: p.label,
          icon: <Bell />,
          onSelect: () => {
            askNotificationPermission();
            set({ reminder: p.at });
          },
        })),
        { label: 'Pick date & time…', onSelect: () => setReminderOpen(true) },
      ],
      'Remind me',
    );

  const moreMenu = (el: HTMLElement) => {
    const entries: MenuEntry[] = [];
    if (id)
      entries.push(
        {
          label: 'Delete note',
          icon: <Trash2 />,
          danger: true,
          onSelect: async () => {
            await close();
            await trashNotes([id]);
          },
        },
        {
          label: 'Make a copy',
          icon: <Copy />,
          onSelect: async () => {
            await flush();
            await copyNote(id);
          },
        },
        {
          label: 'Open as document',
          icon: <FileText />,
          onSelect: async () => {
            await close();
            closeNote();
            await A.openEntry(id);
          },
        },
        'separator',
      );
    entries.push({
      label: items ? 'Hide checkboxes' : 'Show checkboxes',
      icon: <ListChecks />,
      onSelect: () => set(toggleChecklist(latest.current.d)),
    });
    if (items?.some((i) => i.done))
      entries.push(
        {
          label: 'Uncheck all items',
          onSelect: () => setItems(latest.current.d.items!.map((i) => ({ ...i, done: false }))),
        },
        {
          label: 'Delete checked items',
          onSelect: () => setItems(latest.current.d.items!.filter((i) => !i.done)),
        },
      );
    openMenuAt(el, entries, 'More');
  };

  const toggleArchive = async () => {
    const archived = !d.archived;
    set({ archived, pinned: archived ? false : d.pinned });
    if (!id) return;
    await close();
    toast({
      message: archived ? 'Note archived.' : 'Note unarchived.',
      action: { label: 'Undo', run: () => void patchNotes([id], { archived: !archived }) },
    });
  };

  const pictures = [
    ...d.images.map((href) => ({ key: href, href, file: undefined })),
    ...files.map((file, i) => ({ key: `${file.name}${i}`, href: undefined, file })),
  ];
  const removePicture = (p: (typeof pictures)[number]) =>
    p.href
      ? set({ images: d.images.filter((h) => h !== p.href) })
      : setFiles((all) => all.filter((f) => f !== p.file));
  const open = items?.map((it, i) => ({ it, i })).filter((x) => !x.it.done) ?? [];
  const done = items?.map((it, i) => ({ it, i })).filter((x) => x.it.done) ?? [];

  const frame = (
    <div
      ref={root}
      className={`note flex flex-col ${variant === 'dialog' ? 'note-frame' : 'shadow-2'}`}
      data-color={d.color}
      data-testid={variant === 'dialog' ? 'note-dialog' : 'note-composer'}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !reminderOpen && !e.defaultPrevented) {
          e.stopPropagation();
          void close();
        }
      }}
    >
      {pictures.length > 0 && (
        <div
          className={`grid gap-px overflow-hidden rounded-t-[11px] ${pictures.length > 1 ? 'grid-cols-2' : ''}`}
        >
          {pictures.map((p) => (
            <div key={p.key} className="relative">
              <NoteImage
                href={p.href}
                file={p.file}
                className={
                  pictures.length > 1
                    ? 'h-40 w-full object-cover'
                    : 'h-auto max-h-[60vh] w-full object-cover'
                }
              />
              <button
                type="button"
                className="icon-btn absolute top-1.5 right-1.5 !bg-[color-mix(in_srgb,var(--canvas)_85%,transparent)]"
                aria-label="Remove image"
                onClick={() => removePicture(p)}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-start gap-2 px-4 pt-3">
        <input
          ref={titleRef}
          className="note-input note-title"
          placeholder="Title"
          aria-label="Title"
          value={d.title}
          onChange={(e) => set({ title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (!items) return bodyRef.current?.focus();
            if (!items.length) set({ items: [{ text: '', done: false }] });
            focusItem.current = 0;
          }}
        />
        <button
          type="button"
          className="icon-btn -mt-0.5 -mr-1.5"
          aria-label={d.pinned ? 'Unpin note' : 'Pin note'}
          aria-pressed={d.pinned}
          onClick={() => set({ pinned: !d.pinned, archived: d.pinned ? d.archived : false })}
        >
          {d.pinned ? <PinOff size={16} /> : <Pin size={16} />}
        </button>
      </div>
      <div className="px-4 py-2">
        {items ? (
          <div className="flex flex-col gap-0.5">
            {open.map(({ it, i }) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="note-check"
                  checked={false}
                  aria-label="Mark as done"
                  onChange={() => toggleDone(i)}
                />
                <input
                  data-item={i}
                  className="note-input note-body-text py-1"
                  aria-label="List item"
                  placeholder="List item"
                  value={it.text}
                  onChange={(e) => editItem(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addItemAfter(i);
                    } else if (e.key === 'Backspace' && !it.text) {
                      e.preventDefault();
                      removeItem(i, true);
                    }
                  }}
                />
                <button
                  type="button"
                  className="icon-btn icon-btn-sm opacity-60 hover:opacity-100"
                  aria-label="Delete item"
                  onClick={() => removeItem(i)}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="flex items-center gap-2 py-1 text-left text-[14px] opacity-70 hover:opacity-100"
              onClick={() => addItemAfter(open.length ? open[open.length - 1]!.i : -1)}
            >
              <Plus size={16} aria-hidden /> Add item
            </button>
            {done.length > 0 && (
              <>
                <button
                  type="button"
                  className="mt-1 flex items-center gap-1 py-1 text-left text-[13px] opacity-75 hover:opacity-100"
                  aria-expanded={showDone}
                  onClick={() => setShowDone((v) => !v)}
                >
                  {showDone ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {done.length} completed {done.length === 1 ? 'item' : 'items'}
                </button>
                {showDone &&
                  done.map(({ it, i }) => (
                    <div key={i} className="flex items-center gap-2 opacity-70">
                      <input
                        type="checkbox"
                        className="note-check"
                        checked
                        aria-label="Mark as not done"
                        onChange={() => toggleDone(i)}
                      />
                      <input
                        className="note-input note-body-text py-1 line-through"
                        aria-label="Completed item"
                        value={it.text}
                        onChange={(e) => editItem(i, e.target.value)}
                      />
                      <button
                        type="button"
                        className="icon-btn icon-btn-sm"
                        aria-label="Delete item"
                        onClick={() => removeItem(i)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
              </>
            )}
          </div>
        ) : (
          <AutoText
            inputRef={bodyRef}
            className="note-input note-body-text min-h-[3.5rem]"
            placeholder="Take a note…"
            aria-label="Note"
            value={d.text}
            onChange={(e) => set({ text: e.target.value })}
            onPaste={(e) => {
              const pasted = [...e.clipboardData.files];
              if (pasted.some((f) => f.type.startsWith('image/'))) {
                e.preventDefault();
                void addFiles(pasted);
              }
            }}
          />
        )}
      </div>
      {(d.labels.length > 0 || d.reminder !== null) && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-2">
          {d.reminder !== null && (
            <span className="note-chip" data-overdue={d.reminder < Date.now()}>
              <button
                type="button"
                className="flex items-center gap-1"
                onClick={() => setReminderOpen(true)}
              >
                <Bell size={12} aria-hidden />
                {formatReminder(d.reminder)}
                {d.repeat && <RepeatIcon size={12} aria-label={REPEAT_NAMES[d.repeat]} />}
              </button>
              <button
                type="button"
                aria-label="Remove reminder"
                onClick={() => set({ reminder: null, repeat: null })}
              >
                <X size={12} />
              </button>
            </span>
          )}
          {d.labels.map((l) => (
            <span key={l} className="note-chip">
              {l}
              <button
                type="button"
                aria-label={`Remove label ${l}`}
                onClick={() => set({ labels: d.labels.filter((x) => x !== l) })}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-0.5 px-2 pt-1 pb-2">
        {!items && (
          <MicButton
            onText={(t) =>
              set({ text: d.text && !/\s$/.test(d.text) ? `${d.text} ${t}` : d.text + t })
            }
          />
        )}
        <button
          type="button"
          className="icon-btn"
          aria-label="Remind me"
          title="Remind me"
          onClick={(e) => remindMenu(e.currentTarget)}
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
              colorMenu(d.color, (color) => set({ color })),
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
            void addFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="icon-btn"
          aria-label={d.archived ? 'Unarchive' : 'Archive'}
          title={d.archived ? 'Unarchive' : 'Archive'}
          onClick={() => void toggleArchive()}
        >
          {d.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Add label"
          title="Add label"
          onClick={(e) => labelMenu(e.currentTarget)}
        >
          <Tag size={16} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="More"
          title="More"
          onClick={(e) => moreMenu(e.currentTarget)}
        >
          <EllipsisVertical size={16} />
        </button>
        <span className="ml-auto flex items-center gap-3 pr-1">
          {editedAt !== undefined && (
            <span className="hidden text-[12px] opacity-70 sm:inline">
              Edited {relativeTime(editedAt)}
            </span>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => void close()}>
            Close
          </button>
        </span>
      </div>
      {reminderOpen && (
        <ReminderDialog
          initial={d.reminder}
          repeat={d.repeat}
          onSave={(reminder, repeat) => {
            if (reminder !== null) askNotificationPermission();
            set({ reminder, repeat });
          }}
          onClose={() => setReminderOpen(false)}
        />
      )}
    </div>
  );
  return variant === 'dialog' ? <Modal onClose={() => void close()}>{frame}</Modal> : frame;
}
