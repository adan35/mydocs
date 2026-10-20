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
  WrapText,
} from 'lucide-react';
import { useSettings } from '@/app/settings-store';
import { formatShortcut } from '../hooks';
import { RowHeightButton } from '../row-height';

export interface SheetAction {
  id: string;
  label: string;
  icon: ReactNode;
  run(): void;
  disabled?: boolean;
  shortcut?: string;
  group: 'history' | 'rows' | 'cols' | 'sort';
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
  | 'sort-desc';

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
};

/** The ribbon for spreadsheets: the same toolbar pattern as the document ribbon. */
export function SheetRibbon({
  run,
  disabled = {},
  readOnly,
  children,
}: {
  run(cmd: SheetCommand): void;
  disabled?: Partial<Record<SheetCommand, boolean>>;
  readOnly?: boolean;
  /** Extra controls at the start (table picker, sheet info). */
  children?: ReactNode;
}) {
  const rowHeight = useSettings((s) => s.tableRowHeight);
  const groups: SheetCommand[][] = readOnly
    ? []
    : [
        ['undo', 'redo'],
        ['row-above', 'row-below', 'delete-row'],
        ['col-left', 'col-right', 'delete-col'],
        ['sort-asc', 'sort-desc'],
      ];
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
        <div
          key={gi}
          role="group"
          aria-label={['History', 'Rows', 'Columns', 'Sort'][gi]}
          className="flex shrink-0 items-center gap-0.5"
        >
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
      <span className="mx-1 h-5 w-px bg-hairline" aria-hidden />
      <button
        type="button"
        className="icon-btn size-8 shrink-0"
        aria-label="Wrap text"
        aria-pressed={rowHeight !== 'default'}
        title="Wrap text in cells"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() =>
          useSettings
            .getState()
            .update({ tableRowHeight: rowHeight === 'default' ? 'normal' : 'default' })
        }
      >
        <WrapText size={16} aria-hidden />
      </button>
      <RowHeightButton />
    </div>
  );
}
