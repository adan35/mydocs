import type { ReactNode } from 'react';
import {
  ArrowDownAZ,
  ArrowDownZA,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  ArrowDownToLine,
  Redo2,
  Trash2,
  Undo2,
  Columns3,
  Rows3,
  Sigma,
  ChevronsDown,
  ChevronsRight,
  Bold,
  Italic,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Filter,
  PanelTop,
  PanelLeft,
  Sparkles,
} from 'lucide-react';
import { formatShortcut } from '../hooks';
import { RowHeightButton } from '../row-height';

export interface SheetAction {
  id: string;
  label: string;
  icon: ReactNode;
  run(): void;
  disabled?: boolean;
  shortcut?: string;
  group: string;
}

export type SheetCommand =
  | 'undo'
  | 'redo'
  | 'row-above'
  | 'row-below'
  | 'delete-row'
  | 'col-left'
  | 'col-right'
  | 'delete-col'
  | 'sort-asc'
  | 'sort-desc'
  | 'autosum'
  | 'fill-down'
  | 'fill-right'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'filter'
  | 'freeze-row'
  | 'freeze-col';

const META: Record<SheetCommand, Omit<SheetAction, 'run' | 'disabled'>> = {
  undo: { id: 'undo', label: 'Undo', icon: <Undo2 />, shortcut: 'Mod+Z', group: 'history' },
  redo: { id: 'redo', label: 'Redo', icon: <Redo2 />, shortcut: 'Mod+Shift+Z', group: 'history' },
  'row-above': {
    id: 'row-above',
    label: 'Insert row above',
    icon: <ArrowUpToLine />,
    group: 'rows',
  },
  'row-below': {
    id: 'row-below',
    label: 'Insert row below',
    icon: <ArrowDownToLine />,
    group: 'rows',
  },
  'delete-row': {
    id: 'delete-row',
    label: 'Delete row',
    icon: (
      <>
        <Rows3 />
        <Trash2 className="-ml-1.5 !size-3" />
      </>
    ),
    group: 'rows',
  },
  'col-left': {
    id: 'col-left',
    label: 'Insert column left',
    icon: <ArrowLeftToLine />,
    group: 'cols',
  },
  'col-right': {
    id: 'col-right',
    label: 'Insert column right',
    icon: <ArrowRightToLine />,
    group: 'cols',
  },
  'delete-col': {
    id: 'delete-col',
    label: 'Delete column',
    icon: (
      <>
        <Columns3 />
        <Trash2 className="-ml-1.5 !size-3" />
      </>
    ),
    group: 'cols',
  },
  'sort-asc': {
    id: 'sort-asc',
    label: 'Sort A to Z by this column',
    icon: <ArrowDownAZ />,
    group: 'sort',
  },
  'sort-desc': {
    id: 'sort-desc',
    label: 'Sort Z to A by this column',
    icon: <ArrowDownZA />,
    group: 'sort',
  },
  autosum: { id: 'autosum', label: 'AutoSum', icon: <Sigma />, group: 'calc' },
  'fill-down': {
    id: 'fill-down',
    label: 'Fill down',
    icon: <ChevronsDown />,
    shortcut: 'Mod+D',
    group: 'calc',
  },
  'fill-right': {
    id: 'fill-right',
    label: 'Fill right',
    icon: <ChevronsRight />,
    shortcut: 'Mod+R',
    group: 'calc',
  },
  bold: { id: 'bold', label: 'Bold', icon: <Bold />, group: 'text' },
  italic: { id: 'italic', label: 'Italic', icon: <Italic />, group: 'text' },
  strike: { id: 'strike', label: 'Strikethrough', icon: <Strikethrough />, group: 'text' },
  'align-left': {
    id: 'align-left',
    label: 'Align column left',
    icon: <AlignLeft />,
    group: 'align',
  },
  'align-center': {
    id: 'align-center',
    label: 'Center column',
    icon: <AlignCenter />,
    group: 'align',
  },
  'align-right': {
    id: 'align-right',
    label: 'Align column right',
    icon: <AlignRight />,
    group: 'align',
  },
  filter: { id: 'filter', label: 'Filter rows', icon: <Filter />, group: 'view' },
  'freeze-row': {
    id: 'freeze-row',
    label: 'Freeze header row',
    icon: <PanelTop />,
    group: 'view',
  },
  'freeze-col': {
    id: 'freeze-col',
    label: 'Freeze first column',
    icon: <PanelLeft />,
    group: 'view',
  },
};

const DEFAULT_GROUPS: SheetCommand[][] = [
  ['undo', 'redo'],
  ['row-above', 'row-below', 'delete-row'],
  ['col-left', 'col-right', 'delete-col'],
  ['sort-asc', 'sort-desc'],
];

/** The ribbon for spreadsheets: the same toolbar pattern as the document ribbon. */
export function SheetRibbon({
  run,
  disabled = {},
  pressed = {},
  groups: wanted = DEFAULT_GROUPS,
  readOnly,
  onAsk,
  children,
}: {
  run(cmd: SheetCommand): void;
  disabled?: Partial<Record<SheetCommand, boolean>>;
  /** Toggle buttons that are currently on. */
  pressed?: Partial<Record<SheetCommand, boolean>>;
  /** Which buttons to show, in groups. */
  groups?: SheetCommand[][];
  readOnly?: boolean;
  /** Shows "Ask AON" and runs this when it is pressed. */
  onAsk?(): void;
  /** Extra controls at the start (table picker, sheet info). */
  children?: ReactNode;
}) {
  const groups: SheetCommand[][] = readOnly ? [] : wanted;
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -2;
    if (next === -2) return;
    e.preventDefault();
    items[(next + items.length) % items.length]?.focus();
  };
  return (
    <div
      role="toolbar"
      aria-label="Spreadsheet"
      data-testid="sheet-ribbon"
      className="ribbon flex min-h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-hairline-soft bg-canvas px-2 py-1 [scrollbar-width:none] no-print"
      onKeyDown={onKeyDown}
    >
      {children}
      {groups.map((g, gi) => (
        <div key={gi} role="group" className="flex shrink-0 items-center gap-0.5">
          {(gi > 0 || children) && <span className="mx-1 h-5 w-px bg-hairline" aria-hidden />}
          {g.map((cmd) => {
            const m = META[cmd];
            return (
              <button
                key={cmd}
                type="button"
                className="icon-btn size-8 shrink-0 [&>svg]:size-4"
                aria-label={m.label}
                title={m.shortcut ? `${m.label} (${formatShortcut(m.shortcut)})` : m.label}
                data-tool={cmd}
                disabled={disabled[cmd]}
                aria-pressed={cmd in pressed ? !!pressed[cmd] : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(cmd)}
              >
                {m.icon}
              </button>
            );
          })}
        </div>
      ))}
      <span className="flex-1" />
      {onAsk && (
        <button
          type="button"
          className="btn btn-ghost h-8 shrink-0 gap-1.5 px-2 text-caption"
          data-testid="sheet-ask-aon"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onAsk}
        >
          <Sparkles size={14} aria-hidden /> Ask AON
        </button>
      )}
      <span className="mx-1 h-5 w-px bg-hairline" aria-hidden />
      <RowHeightButton />
    </div>
  );
}
