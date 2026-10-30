import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  MoreVertical,
  Palette,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { openMenu, openMenuAt, type MenuEntry } from '../components/Menu';
import { TONES, GRAYS, colorName } from '@/lib/convert/sheet-format';

export interface SheetTab {
  name: string;
  color?: string;
}

/** Colors offered for a tab: the base row of the palette, plus a few grays. */
const TAB_COLORS = [...TONES[0]!.colors, GRAYS[2]!, GRAYS[4]!];

export interface SheetTabsProps {
  sheets: SheetTab[];
  active: number;
  /** False when the workbook is view-only: tabs still switch. */
  editable: boolean;
  onSelect(i: number): void;
  onAdd(): void;
  onRename(i: number, name: string): void;
  onDuplicate(i: number): void;
  onDelete(i: number): void;
  onMove(from: number, to: number): void;
  onColor(i: number, color: string | null): void;
  /** A format with a single sheet (CSV, UNL): the tab can't be renamed or moved. */
  single?: boolean;
  /** Tooltip of the add button. */
  addHint?: string;
}

/**
 * The tab bar under a workbook: switch sheets, add one, and (from a tab's menu, or by
 * double-clicking, dragging or with the keyboard) rename, duplicate, delete, reorder and
 * color them. Alt+Shift+Left/Right moves the focused tab.
 */
export function SheetTabs({
  sheets,
  active,
  editable,
  onSelect,
  onAdd,
  onRename,
  onDuplicate,
  onDelete,
  onMove,
  onColor,
  single,
  addHint,
}: SheetTabsProps) {
  const [renaming, setRenaming] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ from: number; over: number | null } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const manage = editable && !single;

  // Keep the active tab in view when sheets are added or switched.
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, sheets.length]);

  const menu = (i: number): MenuEntry[] => [
    { label: 'Rename', icon: <Pencil />, onSelect: () => setRenaming(i) },
    { label: 'Duplicate', icon: <Copy />, onSelect: () => onDuplicate(i) },
    {
      label: 'Tab color',
      icon: <Palette />,
      submenu: [
        {
          label: 'No color',
          checked: !sheets[i]!.color,
          onSelect: () => onColor(i, null),
        },
        ...TAB_COLORS.map((c) => ({
          label: colorName(c),
          checked: sheets[i]!.color === c,
          icon: (
            <span
              className="size-3.5 rounded-full border border-hairline-strong"
              style={{ background: c }}
              aria-hidden
            />
          ),
          onSelect: () => onColor(i, c),
        })),
      ],
    },
    'separator',
    {
      label: 'Move left',
      icon: <ArrowLeft />,
      disabled: i === 0,
      onSelect: () => onMove(i, i - 1),
    },
    {
      label: 'Move right',
      icon: <ArrowRight />,
      disabled: i === sheets.length - 1,
      onSelect: () => onMove(i, i + 1),
    },
    'separator',
    {
      label: 'Delete',
      icon: <Trash2 />,
      danger: true,
      disabled: sheets.length < 2,
      onSelect: () => onDelete(i),
    },
  ];

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const d = e.key === 'ArrowLeft' ? -1 : 1;
      if (e.altKey && e.shiftKey) {
        if (manage && i + d >= 0 && i + d < sheets.length) onMove(i, i + d);
        return;
      }
      const to = Math.max(0, Math.min(sheets.length - 1, i + d));
      onSelect(to);
      list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus();
    } else if (manage && e.key === 'F2') {
      e.preventDefault();
      setRenaming(i);
    } else if (manage && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
      e.preventDefault();
      openMenuAt(e.currentTarget as HTMLElement, menu(i), sheets[i]!.name);
    }
  };

  return (
    <div
      className="sheet-tabs flex shrink-0 items-center gap-0.5 border-t border-hairline bg-surface-soft px-1.5 py-1 no-print"
      data-testid="sheet-tabs"
    >
      {editable && (
        <button
          type="button"
          className="icon-btn size-8 shrink-0"
          aria-label="Add sheet"
          title={addHint ?? 'Add sheet'}
          data-testid="add-sheet"
          onClick={onAdd}
        >
          <Plus size={16} />
        </button>
      )}
      <div
        ref={list}
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]"
        role="tablist"
        aria-label="Sheets"
      >
        {sheets.map((s, i) => {
          const selected = i === active;
          return renaming === i ? (
            <RenameInput
              key={i}
              initial={s.name}
              onDone={(name) => {
                setRenaming(null);
                if (name && name !== s.name) onRename(i, name);
              }}
            />
          ) : (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              data-sheet-tab={i}
              draggable={manage}
              className={`sheet-tab relative max-w-[200px] shrink-0 truncate rounded-md border border-transparent px-3 py-1 text-caption ${
                selected ? '' : 'text-steel hover:bg-hover'
              } ${drag?.over === i && drag.from !== i ? 'is-drop-target' : ''}`}
              style={s.color ? { boxShadow: `inset 0 -3px 0 ${s.color}` } : undefined}
              title={
                manage
                  ? `${s.name} — double-click to rename, right-click for more`
                  : single
                    ? s.name
                    : undefined
              }
              onClick={() => onSelect(i)}
              onDoubleClick={() => manage && setRenaming(i)}
              onContextMenu={(e) => {
                if (!manage) return;
                e.preventDefault();
                onSelect(i);
                openMenu({
                  items: menu(i),
                  at: { x: e.clientX, y: e.clientY },
                  label: s.name,
                  returnFocus: e.currentTarget,
                });
              }}
              onKeyDown={(e) => onKeyDown(e, i)}
              onDragStart={(e) => {
                setDrag({ from: i, over: null });
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', s.name);
              }}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                if (drag.over !== i) setDrag({ ...drag, over: i });
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag && drag.from !== i) onMove(drag.from, i);
                setDrag(null);
              }}
              onDragEnd={() => setDrag(null)}
            >
              {s.name}
            </button>
          );
        })}
      </div>
      {manage && (
        <button
          type="button"
          className="icon-btn size-8 shrink-0"
          aria-label="Sheet options"
          title="Sheet options"
          aria-haspopup="menu"
          data-testid="sheet-options"
          onClick={(e) => openMenuAt(e.currentTarget, menu(active), sheets[active]?.name)}
        >
          <MoreVertical size={16} />
        </button>
      )}
    </div>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone(name: string | null): void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <input
      ref={ref}
      className="input h-7 w-36 shrink-0 py-0 text-caption"
      aria-label="Sheet name"
      defaultValue={initial}
      maxLength={31}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(e.currentTarget.value.trim());
        else if (e.key === 'Escape') finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value.trim())}
    />
  );
}
