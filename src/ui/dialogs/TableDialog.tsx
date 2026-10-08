import { useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, MoreHorizontal, Plus } from 'lucide-react';
import { tableOps, type Align, type Table } from '@/domain/table';
import { Dialog } from '../components/Dialog';
import { openMenuAt } from '../components/Menu';

const ALIGN_ICON = {
  left: <AlignLeft size={14} />,
  center: <AlignCenter size={14} />,
  right: <AlignRight size={14} />,
};

/** Visual editor for a Markdown table. Resolves with the edited table, or null on cancel. */
export function TableDialog({
  initial,
  isNew,
  onClose,
}: {
  initial: Table;
  isNew: boolean;
  onClose(result: Table | null): void;
}) {
  const [t, setT] = useState(initial);
  const grid = useRef<HTMLTableElement>(null);
  const cols = t.header.length;

  const focusCell = (row: number, col: number) =>
    requestAnimationFrame(() =>
      grid.current?.querySelector<HTMLInputElement>(`input[data-cell="${row}:${col}"]`)?.focus(),
    );

  const columnMenu = (el: HTMLElement, c: number) =>
    openMenuAt(
      el,
      [
        ...(['left', 'center', 'right'] as const).map((a) => ({
          label: `Align ${a}`,
          icon: ALIGN_ICON[a],
          onSelect: () => setT((x) => tableOps.setAlign(x, c, x.align[c] === a ? null : a)),
        })),
        'separator',
        { label: 'Insert column left', onSelect: () => setT((x) => tableOps.insertColumn(x, c)) },
        {
          label: 'Insert column right',
          onSelect: () => setT((x) => tableOps.insertColumn(x, c + 1)),
        },
        {
          label: 'Move column left',
          disabled: c === 0,
          onSelect: () => setT((x) => tableOps.moveColumn(x, c, c - 1)),
        },
        {
          label: 'Move column right',
          disabled: c === cols - 1,
          onSelect: () => setT((x) => tableOps.moveColumn(x, c, c + 1)),
        },
        'separator',
        {
          label: 'Delete column',
          danger: true,
          disabled: cols <= 1,
          onSelect: () => setT((x) => tableOps.deleteColumn(x, c)),
        },
      ],
      `Column ${c + 1}`,
    );

  const rowMenu = (el: HTMLElement, r: number) =>
    openMenuAt(
      el,
      [
        { label: 'Insert row above', onSelect: () => setT((x) => tableOps.insertRow(x, r)) },
        { label: 'Insert row below', onSelect: () => setT((x) => tableOps.insertRow(x, r + 1)) },
        {
          label: 'Move row up',
          disabled: r === 0,
          onSelect: () => setT((x) => tableOps.moveRow(x, r, r - 1)),
        },
        {
          label: 'Move row down',
          disabled: r === t.rows.length - 1,
          onSelect: () => setT((x) => tableOps.moveRow(x, r, r + 1)),
        },
        'separator',
        {
          label: 'Delete row',
          danger: true,
          onSelect: () => setT((x) => tableOps.deleteRow(x, r)),
        },
      ],
      `Row ${r + 1}`,
    );

  const cell = (row: number, col: number, value: string, header = false) => (
    <input
      data-cell={`${row}:${col}`}
      aria-label={header ? `Column ${col + 1} heading` : `Row ${row + 1}, column ${col + 1}`}
      className={`h-8 w-full min-w-[110px] rounded-md border border-transparent bg-transparent px-2 text-[14px] text-ink outline-none hover:border-hairline focus:border-[var(--primary)] ${header ? 'font-semibold' : ''}`}
      style={{ textAlign: t.align[col] ?? 'left' }}
      value={value}
      onChange={(e) => setT((x) => tableOps.setCell(x, row, col, e.target.value))}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
        e.preventDefault();
        // Enter moves down a row, adding one at the end (Shift+Enter moves up).
        const next = row + (e.shiftKey ? -1 : 1);
        if (next >= t.rows.length) setT((x) => tableOps.insertRow(x, x.rows.length));
        if (next >= -1) focusCell(next, col);
      }}
    />
  );

  return (
    <Dialog
      title={isNew ? 'Insert table' : 'Edit table'}
      description="Edit cells directly. Use the … buttons to add, move, align or delete rows and columns."
      size="lg"
      onClose={() => onClose(null)}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={() => onClose(null)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onClose(t)}>
            {isNew ? 'Insert table' : 'Save table'}
          </button>
        </>
      }
    >
      <div className="overflow-x-auto pb-2">
        <table ref={grid} className="border-collapse text-left">
          <thead>
            <tr>
              <th className="w-8" />
              {t.header.map((h, c) => (
                <th key={c} className="border-b border-hairline p-1 align-bottom">
                  <div className="flex items-center gap-0.5">
                    {cell(-1, c, h, true)}
                    <button
                      type="button"
                      className="icon-btn size-7 shrink-0"
                      aria-label={`Column ${c + 1} options`}
                      onClick={(e) => columnMenu(e.currentTarget, c)}
                    >
                      {t.align[c] ? (
                        ALIGN_ICON[t.align[c] as Exclude<Align, null>]
                      ) : (
                        <MoreHorizontal size={14} />
                      )}
                    </button>
                  </div>
                </th>
              ))}
              <th className="p-1">
                <button
                  type="button"
                  className="icon-btn size-7"
                  aria-label="Add column"
                  onClick={() => {
                    setT((x) => tableOps.insertColumn(x, x.header.length));
                    focusCell(-1, cols);
                  }}
                >
                  <Plus size={15} />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r, ri) => (
              <tr key={ri} className="border-b border-hairline">
                <td className="p-1">
                  <button
                    type="button"
                    className="icon-btn size-7"
                    aria-label={`Row ${ri + 1} options`}
                    onClick={(e) => rowMenu(e.currentTarget, ri)}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </td>
                {r.map((v, ci) => (
                  <td key={ci} className="p-1">
                    {cell(ri, ci, v)}
                  </td>
                ))}
                <td />
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          className="btn btn-ghost mt-2 h-8 gap-1.5 px-2 text-caption"
          onClick={() => {
            setT((x) => tableOps.insertRow(x, x.rows.length));
            focusCell(t.rows.length, 0);
          }}
        >
          <Plus size={14} /> Add row
        </button>
      </div>
    </Dialog>
  );
}
