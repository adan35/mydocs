import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDownToLine, ArrowUpToLine, Rows3, Trash2 } from 'lucide-react';
import { dialogs } from '@/app/dialog-store';
import { openMenu, type MenuEntry } from '../components/Menu';
import { ROW_LINES, useSettings } from '@/app/settings-store';
import {
  addr,
  colName,
  displayValue,
  editValue as cellEditValue,
  textValue,
  isError,
  type Cell,
  type Sheet,
} from '@/lib/convert/workbook';
import { shiftFormula } from '@/lib/convert/formula';
import { parseEmphasis, rangeStats } from '@/lib/convert/table-sheet';

const ROW_H = 28;
/** Wrapped rows: line height and vertical padding of a cell. */
const LINE_H = 18;
const PAD_Y = 10;
/** Average width of a character at the grid's 13px, a little generous so text fits. */
const CHAR_W = 7;
const NUM_W = 48;
const DEFAULT_COL_W = 112;
const OVERSCAN = 8;

/** The active cell, and the opposite corner when a range is selected. */
export interface Selection {
  r: number;
  c: number;
  to?: { r: number; c: number };
}

/** The selected range as [firstRow, firstCol, lastRow, lastCol]. */
export function selectionRange(s: Selection): [number, number, number, number] {
  const t = s.to ?? s;
  return [Math.min(s.r, t.r), Math.min(s.c, t.c), Math.max(s.r, t.r), Math.max(s.c, t.c)];
}

/** What the last copy put on the clipboard, so a paste inside the app keeps formulas. */
let lastCopy: { text: string; r: number; c: number; rows: string[][] } | null = null;

/** A change to whole rows, asked for from a row number. */
export interface RowAction {
  kind: 'insert' | 'delete';
  /** Index of the first row inserted at, or deleted. */
  at: number;
  count: number;
  /** Row to select afterwards. */
  select?: number;
}

export interface SheetGridProps {
  sheet: Sheet;
  readOnly?: boolean;
  /** Row 1 is a header (Markdown tables, most CSV files): shown bold. */
  headerRow?: boolean;
  /** Called with what the person typed; the parent parses and stores it. */
  onEdit?(r: number, c: number, input: string): void;
  /** Pasted block of text (tab/newline separated) starting at a cell. */
  onPaste?(r: number, c: number, rows: string[][]): void;
  onClear?(r: number, c: number): void;
  /** Clears a whole range at once (one change instead of one per cell). */
  onClearRange?(range: [number, number, number, number]): void;
  /** Ctrl+D / Ctrl+R: fill the selection from its first row or column. */
  onFill?(dir: 'down' | 'right'): void;
  /** Leading rows and columns that stay in view while scrolling. */
  freeze?: { rows: number; cols: number };
  /** Numbers to show in the row headers when rows are hidden by a filter. */
  rowLabels?: readonly number[];
  /** Cell text uses Markdown emphasis (`**bold**`, `*italic*`, `~~strike~~`). */
  markdownText?: boolean;
  selection: Selection;
  onSelect(sel: Selection): void;
  /** Extra empty rows and columns to show past the data, so there is room to type. */
  pad?: { rows: number; cols: number };
  /** Accessible name. */
  label: string;
  /**
   * Every cell is text (CSV, TSV, Markdown tables): cells are edited exactly as written,
   * without the leading apostrophe a spreadsheet uses to mark text that looks like a number.
   */
  textOnly?: boolean;
  /** Click or right-click a row number to insert or delete rows. */
  onRows?(action: RowAction): void;
  /** Row 1 is a table header that can't be moved or removed (Markdown tables). */
  fixedHeader?: boolean;
  /** Column alignment, as a Markdown table declares it. */
  align?: readonly ('left' | 'center' | 'right' | null)[];
}

/**
 * A spreadsheet grid: virtualized rows, sticky headers, keyboard navigation like a
 * spreadsheet (arrows, Tab, Enter, F2, typing to replace), a formula bar, and copy/paste
 * as tab-separated text. Values are parsed by the parent, never here.
 */
export function SheetGrid({
  sheet,
  readOnly,
  headerRow,
  onEdit,
  onPaste,
  onClear,
  selection,
  onSelect,
  pad = { rows: 20, cols: 4 },
  label,
  textOnly,
  align,
  onRows,
  fixedHeader,
  onClearRange,
  onFill,
  freeze,
  rowLabels,
  markdownText,
}: SheetGridProps) {
  // Text sheets edit exactly what is written, except formulas, which show as typed.
  const editValue = textOnly
    ? (c: Cell | undefined) => (c?.f !== undefined ? `=${c.f}` : textValue(c))
    : cellEditValue;
  const [sr1, sc1, sr2, sc2] = selectionRange(selection);
  const hasRange = sr1 !== sr2 || sc1 !== sc2;
  const frozenRows = Math.min(freeze?.rows ?? 0, 50);
  const frozenCols = Math.min(freeze?.cols ?? 0, 10);
  const [colW, setColW] = useState<Record<number, number>>({});
  const dragFrom = useRef<{ r: number; c: number } | null>(null);
  useEffect(() => {
    const up = () => (dragFrom.current = null);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);
  const scroller = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<{ value: string; from: 'cell' | 'bar' } | null>(null);
  const [view, setView] = useState({ top: 0, height: 600 });
  const dataRows = sheet.rows.length;
  const dataCols = useMemo(() => Math.max(1, ...sheet.rows.map((r) => r?.length ?? 0)), [sheet]);
  // Spare rows and columns to type into, unless the shape is fixed (a Markdown table).
  const grow = !readOnly && (pad.rows > 0 || pad.cols > 0);
  const rows = Math.max(dataRows + (readOnly ? 0 : pad.rows), grow ? 30 : 1);
  const cols = Math.min(Math.max(dataCols + (readOnly ? 0 : pad.cols), grow ? 8 : 1), 702);
  const widths = useMemo(
    () =>
      Array.from(
        { length: cols },
        (_, c) =>
          colW[c] ?? Math.max(64, Math.min(360, (sheet.widths?.[c] ?? 0) * 7.5 || DEFAULT_COL_W)),
      ),
    [cols, sheet.widths, colW],
  );
  const lefts = useMemo(() => {
    const out = [NUM_W];
    for (let c = 0; c < cols; c++) out.push(out[c]! + widths[c]!);
    return out;
  }, [cols, widths]);

  const cell = (r: number, c: number): Cell | undefined => sheet.rows[r]?.[c];
  const active = cell(selection.r, selection.c);

  // Row height: one line like a spreadsheet, or rows that grow with their text up to 3 or
  // 6 lines (or all of it). Heights are estimated from the text and column widths.
  const rowHeight = useSettings((st) => st.tableRowHeight);
  const maxLines = ROW_LINES[rowHeight];
  const wrap = maxLines > 1;
  // Very large sheets use an average character width instead of measuring every word.
  const measure = useMemo(() => (wrap ? textMeasurer(dataRows > 20_000) : null), [wrap, dataRows]);
  const tops = useMemo(() => {
    // tops[r] is where row r starts (row 0 sits under the column header); tops[rows] is the end.
    const out = new Float64Array(rows + 1);
    let y = ROW_H;
    for (let r = 0; r < rows; r++) {
      out[r] = y;
      let lines = 1;
      const row = wrap ? sheet.rows[r] : undefined;
      if (row) {
        for (let c = 0; c < row.length && c < cols && lines < maxLines; c++) {
          const v = row[c];
          if (!v) continue;
          const text = displayValue(v);
          if (!text) continue;
          const n = wrappedLines(text, widths[c]! - 16, measure);
          lines = Math.max(lines, n);
        }
      }
      y += lines > 1 ? Math.min(lines, maxLines) * LINE_H + PAD_Y : ROW_H;
    }
    out[rows] = y;
    return out;
  }, [sheet, rows, cols, widths, wrap, maxLines, measure]);
  const rowTop = (r: number) => tops[Math.min(r, rows)]!;
  const rowH = (r: number) => rowTop(r + 1) - rowTop(r);
  /** The row at a vertical position (binary search over the row tops). */
  const rowAt = (y: number) => {
    let lo = 0;
    let hi = rows - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tops[mid]! <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  // Keep the active cell in view.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const at = selection.to ?? selection;
    const top = rowTop(at.r);
    const bottom = rowTop(at.r + 1);
    // Frozen rows and columns cover the top and left edge; a cell behind them is not in view.
    const topInset = at.r >= frozenRows ? rowTop(frozenRows) : ROW_H;
    if (top < el.scrollTop + topInset) el.scrollTop = top - topInset;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
    const left = lefts[at.c]!;
    const right = lefts[at.c + 1]!;
    const leftInset = at.c >= frozenCols ? lefts[frozenCols]! : NUM_W;
    if (left < el.scrollLeft + leftInset) el.scrollLeft = left - leftInset;
    else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.r, selection.c, selection.to?.r, selection.to?.c, lefts, tops]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setView({ top: el.scrollTop, height: el.clientHeight });
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, []);

  const first = Math.max(frozenRows, rowAt(view.top) - OVERSCAN);
  const last = Math.min(rows, rowAt(view.top + view.height) + 1 + OVERSCAN);

  const move = useCallback(
    (dr: number, dc: number) => {
      onSelect({
        r: Math.max(0, Math.min(rows - 1, selection.r + dr)),
        c: Math.max(0, Math.min(cols - 1, selection.c + dc)),
      });
    },
    [onSelect, rows, cols, selection],
  );

  const barDone = useRef(false);
  const commit = (value: string, then?: [number, number]) => {
    if (onEdit && value !== editValue(active)) onEdit(selection.r, selection.c, value);
    setEditing(null);
    if (then) move(then[0], then[1]);
    scroller.current?.focus({ preventScroll: true });
  };

  const onGridKey = (e: React.KeyboardEvent) => {
    if (editing) return;
    const mod = e.metaKey || e.ctrlKey;
    const map: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (map[e.key]) {
      e.preventDefault();
      const [dr, dc] = map[e.key]!;
      if (e.shiftKey) {
        // Shift extends the selection from the active cell.
        const t = selection.to ?? selection;
        onSelect({
          ...selection,
          to: {
            r: mod
              ? dr < 0
                ? 0
                : dr > 0
                  ? Math.max(0, dataRows - 1)
                  : t.r
              : Math.max(0, Math.min(rows - 1, t.r + dr)),
            c: mod
              ? dc < 0
                ? 0
                : dc > 0
                  ? Math.max(0, dataCols - 1)
                  : t.c
              : Math.max(0, Math.min(cols - 1, t.c + dc)),
          },
        });
      } else if (mod)
        onSelect({
          r: dr < 0 ? 0 : dr > 0 ? Math.max(0, dataRows - 1) : selection.r,
          c: dc < 0 ? 0 : dc > 0 ? Math.max(0, dataCols - 1) : selection.c,
        });
      else move(dr, dc);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      move(0, e.shiftKey ? -1 : 1);
      return;
    }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selectAll();
      return;
    }
    if (mod && !readOnly && onFill && ['d', 'r'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      onFill(e.key.toLowerCase() === 'd' ? 'down' : 'right');
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      onSelect({ r: mod ? 0 : selection.r, c: 0 });
      return;
    }
    if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      const avg = (tops[rows]! - ROW_H) / Math.max(1, rows);
      move((e.key === 'PageDown' ? 1 : -1) * Math.max(1, Math.floor(view.height / avg) - 1), 0);
      return;
    }
    if (readOnly) return;
    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      setEditing({ value: editValue(active), from: 'cell' });
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      clearSelection();
      return;
    }
    if (e.key.length === 1 && !mod && !e.altKey) {
      e.preventDefault();
      setEditing({ value: e.key, from: 'cell' });
    }
  };

  const selectAll = () =>
    onSelect({ r: 0, c: 0, to: { r: Math.max(0, dataRows - 1), c: Math.max(0, dataCols - 1) } });

  const clearSelection = () => {
    if (!hasRange) {
      if (active) onClear?.(selection.r, selection.c);
    } else if (onClearRange) onClearRange([sr1, sc1, sr2, sc2]);
    else
      for (let r = sr1; r <= sr2; r++)
        for (let c = sc1; c <= sc2; c++) if (cell(r, c)) onClear?.(r, c);
  };

  // Copy as tab-separated text of what the cells show. The formulas are remembered too,
  // so pasting inside MyDocs moves their references like a spreadsheet does.
  const copyRange = (e: React.ClipboardEvent) => {
    const shownRows: string[][] = [];
    const editRows: string[][] = [];
    for (let r = sr1; r <= sr2; r++) {
      shownRows.push(
        Array.from({ length: sc2 - sc1 + 1 }, (_, k) => displayValue(cell(r, sc1 + k))),
      );
      editRows.push(Array.from({ length: sc2 - sc1 + 1 }, (_, k) => editValue(cell(r, sc1 + k))));
    }
    const text = shownRows.map((row) => row.join('\t')).join('\n');
    e.clipboardData.setData('text/plain', text);
    lastCopy = { text, r: sr1, c: sc1, rows: editRows };
  };

  const onCopy = (e: React.ClipboardEvent) => {
    if (editing) return;
    e.preventDefault();
    copyRange(e);
  };

  const onCut = (e: React.ClipboardEvent) => {
    if (editing) return;
    e.preventDefault();
    copyRange(e);
    if (!readOnly) clearSelection();
  };

  const onPasteEvent = (e: React.ClipboardEvent) => {
    if (editing || readOnly || !onPaste) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n').replace(/\n$/, '');
    let block: string[][];
    if (lastCopy && lastCopy.text === text) {
      const { r: fr, c: fc, rows: copied } = lastCopy;
      block = copied.map((line, i) =>
        line.map((t, j) =>
          t.startsWith('=') && t.length > 1
            ? `=${shiftFormula(t.slice(1), sr1 + i - fr, sc1 + j - fc)}`
            : t,
        ),
      );
    } else block = text.split('\n').map((l) => l.split('\t'));
    // One value pasted over a selected range fills the range, as in a spreadsheet.
    if (hasRange && block.length === 1 && block[0]!.length === 1) {
      const one = block[0]![0]!;
      block = Array.from({ length: sr2 - sr1 + 1 }, (_, i) =>
        Array.from({ length: sc2 - sc1 + 1 }, (_, j) =>
          one.startsWith('=') && one.length > 1 && lastCopy && lastCopy.text === text
            ? `=${shiftFormula(one.slice(1), i, j)}`
            : one,
        ),
      );
    }
    onPaste(sr1, sc1, block);
  };

  const askCount = async (r: number, where: 'above' | 'below') => {
    const answer = await dialogs.prompt({
      title: `Insert rows ${where}`,
      label: `How many rows to insert ${where} row ${r + 1}?`,
      initial: '5',
      confirmLabel: 'Insert',
      selectRange: [0, 1],
      validate: (v) => {
        const n = Number(v.trim());
        return Number.isInteger(n) && n >= 1 && n <= 1000
          ? null
          : 'Enter a whole number from 1 to 1000.';
      },
    });
    return answer === null ? null : Number(answer.trim());
  };

  const openRowMenu = (r: number, at: DOMRect | { x: number; y: number }) => {
    if (readOnly || !onRows) return;
    onSelect({ r, c: selection.c });
    const insert = async (where: 'above' | 'below', many: boolean) => {
      const count = many ? await askCount(r, where) : 1;
      if (!count) return;
      const pos = where === 'above' ? r : r + 1;
      onRows({ kind: 'insert', at: pos, count, select: where === 'above' ? r : r + 1 });
    };
    const lockedTop = !!fixedHeader && r === 0;
    const items: MenuEntry[] = [
      {
        label: 'Insert row above',
        icon: <ArrowUpToLine />,
        disabled: lockedTop,
        onSelect: () => void insert('above', false),
      },
      {
        label: 'Insert row below',
        icon: <ArrowDownToLine />,
        onSelect: () => void insert('below', false),
      },
      {
        label: 'Insert rows above…',
        icon: <Rows3 />,
        disabled: lockedTop,
        onSelect: () => void insert('above', true),
      },
      { label: 'Insert rows below…', icon: <Rows3 />, onSelect: () => void insert('below', true) },
      'separator',
      {
        label: `Delete row ${r + 1}`,
        icon: <Trash2 />,
        danger: true,
        disabled: lockedTop || r >= dataRows,
        onSelect: () =>
          onRows({
            kind: 'delete',
            at: r,
            count: 1,
            select: Math.max(0, Math.min(r, dataRows - 2)),
          }),
      },
    ];
    openMenu({ items, at, label: `Row ${r + 1}`, returnFocus: scroller.current });
  };

  const totalW = lefts[cols]!;
  const cellTitle = (c: Cell | undefined) =>
    c?.stale
      ? 'Not recalculated: this formula uses functions MyDocs does not support. The value saved in the file is shown.'
      : c?.f
        ? `=${c.f}`
        : undefined;

  const stats = useMemo(
    () => (hasRange ? rangeStats(sheet, [sr1, sc1, sr2, sc2], !!textOnly) : null),
    [hasRange, sheet, sr1, sc1, sr2, sc2, textOnly],
  );

  const startResize = (c: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const w0 = widths[c]!;
    const move = (ev: MouseEvent) =>
      setColW((prev) => ({ ...prev, [c]: Math.max(40, Math.min(800, w0 + ev.clientX - x0)) }));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  // Double-click the edge of a column header to fit the column to its longest text.
  const autofit = (c: number) => {
    let longest = 0;
    for (let r = 0; r < Math.min(dataRows, 2000); r++)
      for (const line of displayValue(cell(r, c)).split('\n'))
        longest = Math.max(longest, line.length);
    setColW((prev) => ({ ...prev, [c]: Math.max(64, Math.min(600, longest * CHAR_W + 24)) }));
  };

  const renderRow = (r: number, top: number) => (
    <div
      key={r}
      className="absolute left-0 flex"
      style={{ top, height: rowH(r), width: totalW }}
      role="row"
      aria-rowindex={r + 1}
    >
      <div
        role="rowheader"
        className={`sheet-rownum sticky left-0 z-10 ${r >= sr1 && r <= sr2 ? 'is-active' : ''} ${onRows && !readOnly ? 'is-actionable' : ''}`}
        style={{ width: NUM_W, height: rowH(r) }}
        title={onRows && !readOnly ? 'Click for row options' : undefined}
        aria-haspopup={onRows && !readOnly ? 'menu' : undefined}
        onMouseDown={(e) => {
          if (!onRows || readOnly) return;
          e.preventDefault();
          if (editing) commit(editing.value);
          openRowMenu(r, e.currentTarget.getBoundingClientRect());
        }}
        onContextMenu={(e) => {
          if (!onRows || readOnly) return;
          e.preventDefault();
          openRowMenu(r, { x: e.clientX, y: e.clientY });
        }}
      >
        {rowLabels?.[r] ?? r + 1}
      </div>
      {widths.map((w, c) => {
        const v = cell(r, c);
        const isActive = r === selection.r && c === selection.c;
        const inRange = hasRange && !isActive && r >= sr1 && r <= sr2 && c >= sc1 && c <= sc2;
        const shown = displayValue(v);
        const em =
          markdownText && typeof v?.v === 'string' && v.f === undefined
            ? parseEmphasis(shown)
            : null;
        const numeric = typeof v?.v === 'number';
        return (
          <div
            key={c}
            role="gridcell"
            aria-selected={isActive || inRange}
            aria-colindex={c + 1}
            data-cell={addr(r, c)}
            title={cellTitle(v) ?? (!wrap && shown.length > 20 ? shown : undefined)}
            className={`sheet-cell ${wrap ? 'is-wrapped' : ''} ${isActive ? 'is-active' : ''} ${inRange ? 'is-in-range' : ''} ${c < frozenCols ? 'is-frozen' : ''} ${c === frozenCols - 1 ? 'is-frozen-edge' : ''} ${r === frozenRows - 1 ? 'is-frozen-bottom' : ''} ${numeric || align?.[c] === 'right' ? 'text-right' : align?.[c] === 'center' ? 'text-center' : ''} ${v && isError(v.v) ? 'text-danger' : ''} ${v?.stale ? 'is-stale' : ''}`}
            style={{
              width: w,
              height: rowH(r),
              ...(c < frozenCols ? { position: 'sticky', left: lefts[c]!, zIndex: 5 } : null),
            }}
            onMouseDown={(e) => {
              if (editing && isActive) return;
              e.preventDefault();
              if (editing) commit(editing.value);
              if (e.shiftKey) onSelect({ r: selection.r, c: selection.c, to: { r, c } });
              else {
                dragFrom.current = { r, c };
                onSelect({ r, c });
              }
              scroller.current?.focus({ preventScroll: true });
            }}
            onMouseEnter={(e) => {
              const from = dragFrom.current;
              if (!from || e.buttons !== 1 || editing) return;
              onSelect({
                r: from.r,
                c: from.c,
                to: from.r === r && from.c === c ? undefined : { r, c },
              });
            }}
            onDoubleClick={() => !readOnly && setEditing({ value: editValue(v), from: 'cell' })}
          >
            {isActive && editing?.from === 'cell' ? (
              <CellEditor
                value={editing.value}
                onChange={(value) => setEditing({ value, from: 'cell' })}
                onCommit={(value, then) => commit(value, then)}
                onCancel={() => {
                  setEditing(null);
                  scroller.current?.focus();
                }}
              />
            ) : (
              <span
                className={`${wrap ? 'cell-lines' : 'truncate'} ${headerRow && r === 0 ? 'font-semibold' : ''} ${em?.bold ? 'font-bold' : ''} ${em?.italic ? 'italic' : ''} ${em?.strike ? 'line-through' : ''}`}
                style={
                  wrap && maxLines !== Infinity
                    ? { WebkitLineClamp: maxLines, lineClamp: maxLines }
                    : undefined
                }
              >
                {em ? em.text : shown}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-hairline-soft px-2 py-1">
        <span
          className="min-w-14 shrink-0 text-center font-mono text-caption text-steel"
          aria-label="Selected cell"
        >
          {hasRange ? `${addr(sr1, sc1)}:${addr(sr2, sc2)}` : addr(selection.r, selection.c)}
        </span>
        <span className="font-mono text-caption text-stone" aria-hidden>
          fx
        </span>
        <input
          className="input h-8 min-w-0 flex-1 py-0 font-mono text-[13px]"
          aria-label="Cell contents"
          data-testid="formula-bar"
          readOnly={readOnly}
          value={editing ? editing.value : editValue(active)}
          onFocus={() => {
            if (readOnly || editing) return;
            barDone.current = false;
            setEditing({ value: editValue(active), from: 'bar' });
          }}
          onChange={(e) => setEditing({ value: e.target.value, from: 'bar' })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              barDone.current = true;
              commit(e.currentTarget.value, [1, 0]);
            } else if (e.key === 'Escape') {
              barDone.current = true;
              setEditing(null);
              scroller.current?.focus();
            }
          }}
          onBlur={(e) => {
            if (editing?.from !== 'bar' || barDone.current) return;
            barDone.current = true;
            commit(e.currentTarget.value);
          }}
        />
        {active?.stale && (
          <span className="flex items-center gap-1 text-xs text-warning" title={cellTitle(active)}>
            <AlertTriangle size={13} aria-hidden /> Not recalculated
          </span>
        )}
      </div>
      <div
        ref={scroller}
        className="sheet-grid relative min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-focus"
        tabIndex={0}
        role="grid"
        aria-label={label}
        aria-rowcount={rows}
        aria-colcount={cols}
        aria-readonly={readOnly}
        aria-multiselectable={hasRange || undefined}
        data-testid="sheet-grid"
        onKeyDown={onGridKey}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPasteEvent}
      >
        <div style={{ height: tops[rows], width: totalW, position: 'relative' }}>
          {/* Column headers */}
          <div
            className="sticky top-0 z-20 flex"
            style={{ height: ROW_H, width: totalW }}
            role="row"
          >
            <div
              className="sheet-corner sticky left-0 z-30 cursor-pointer"
              style={{ width: NUM_W }}
              title="Select all"
              onMouseDown={(e) => {
                e.preventDefault();
                if (editing) commit(editing.value);
                selectAll();
                scroller.current?.focus({ preventScroll: true });
              }}
            />
            {widths.map((w, c) => (
              <div
                key={c}
                role="columnheader"
                className={`sheet-head relative cursor-pointer ${c >= sc1 && c <= sc2 ? 'is-active' : ''} ${c < frozenCols ? 'is-frozen' : ''}`}
                style={{
                  width: w,
                  ...(c < frozenCols ? { position: 'sticky', left: lefts[c]!, zIndex: 6 } : null),
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (editing) commit(editing.value);
                  const bottom = Math.max(0, dataRows - 1);
                  onSelect(
                    e.shiftKey
                      ? { r: 0, c: selection.c, to: { r: bottom, c } }
                      : { r: 0, c, to: bottom > 0 ? { r: bottom, c } : undefined },
                  );
                  scroller.current?.focus({ preventScroll: true });
                }}
              >
                {colName(c)}
                <span
                  className="sheet-resizer"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Resize column ${colName(c)}`}
                  onMouseDown={(e) => startResize(c, e)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    autofit(c);
                  }}
                />
              </div>
            ))}
          </div>
          {frozenRows > 0 && (
            <div
              className="sheet-frozen-rows sticky z-[19]"
              style={{ top: ROW_H, height: rowTop(frozenRows) - ROW_H, width: totalW }}
            >
              {Array.from({ length: frozenRows }, (_, r) => renderRow(r, rowTop(r) - ROW_H))}
            </div>
          )}
          {Array.from({ length: Math.max(0, last - first) }, (_, k) =>
            renderRow(first + k, rowTop(first + k)),
          )}
        </div>
      </div>
      {stats && stats.count > 0 && (
        <div
          className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-0.5 border-t border-hairline-soft bg-surface-soft px-3 py-1 text-caption text-steel"
          data-testid="sheet-stats"
          aria-live="polite"
        >
          <span>Count: {stats.count.toLocaleString()}</span>
          {stats.numbers > 0 && (
            <>
              <span>Sum: {displayValue({ v: stats.sum })}</span>
              <span>Average: {displayValue({ v: stats.sum / stats.numbers })}</span>
              <span>Min: {displayValue({ v: stats.min })}</span>
              <span>Max: {displayValue({ v: stats.max })}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

type Measure = ((s: string) => number) | null;

/** Measures text in the grid's font (cached per word); `rough` uses an average width. */
function textMeasurer(rough: boolean): Measure {
  if (rough) return (t) => t.length * CHAR_W;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return (t) => t.length * CHAR_W;
  ctx.font = `13px ${getComputedStyle(document.body).fontFamily || 'sans-serif'}`;
  const cache = new Map<string, number>();
  return (t) => {
    let w = cache.get(t);
    if (w === undefined) {
      // Tabular figures and a little slack, so wrapped text never ends up cut off.
      w = ctx.measureText(t).width * 1.04;
      if (cache.size < 50_000) cache.set(t, w);
    }
    return w;
  };
}

/** How many lines text takes in a cell `width` px wide, wrapping at spaces like the browser. */
export function wrappedLines(text: string, width: number, measure: Measure): number {
  const m = measure ?? ((t: string) => t.length * CHAR_W);
  const room = Math.max(8, width);
  const space = m(' ');
  let total = 0;
  for (const part of text.split('\n')) {
    let lines = 1;
    let x = 0;
    for (const word of part.split(' ')) {
      const w = m(word);
      if (x > 0 && x + space + w <= room) {
        x += space + w;
        continue;
      }
      if (x > 0) lines++;
      // A word wider than the cell breaks across lines.
      if (w > room) {
        lines += Math.ceil(w / room) - 1;
        x = w % room || room;
      } else x = w;
    }
    total += lines;
  }
  return total;
}

function CellEditor({
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  onChange(v: string): void;
  onCommit(v: string, then?: [number, number]): void;
  onCancel(): void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // Enter, Tab and Escape finish the edit; the blur that follows must not commit again.
  const done = useRef(false);
  const finish = (v: string, then?: [number, number]) => {
    if (done.current) return;
    done.current = true;
    onCommit(v, then);
  };
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return (
    <input
      ref={ref}
      className="sheet-editor"
      aria-label="Edit cell"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(e.currentTarget.value, [e.shiftKey ? -1 : 1, 0]);
        } else if (e.key === 'Tab') {
          e.preventDefault();
          finish(e.currentTarget.value, [0, e.shiftKey ? -1 : 1]);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          done.current = true;
          onCancel();
        }
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}
