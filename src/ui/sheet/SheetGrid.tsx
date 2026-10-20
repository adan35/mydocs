import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDownToLine, ArrowUpToLine, Rows3, Trash2 } from 'lucide-react';
import { dialogs } from '@/app/dialog-store';
import { openMenu, type MenuEntry } from '../components/Menu';
import { ROW_LINES, useSettings } from '@/app/settings-store';
import {
  addr,
  colName,
  parseAddr,
  displayValue,
  editValue as cellEditValue,
  textValue,
  isError,
  type Cell,
  type Sheet,
} from '@/lib/convert/workbook';
import { parseDelimited, serializeDelimited } from '@/lib/convert/delimited';
import { rangeBounds, selectionSummary } from './selection';

const ROW_H = 28;
/** Wrapped rows: line height and vertical padding of a cell. */
const LINE_H = 18;
const PAD_Y = 10;
/** Average width of a character at the grid's 13px, a little generous so text fits. */
const CHAR_W = 7;
const NUM_W = 48;
const DEFAULT_COL_W = 128;
const OVERSCAN = 8;

export interface Selection {
  r: number;
  c: number;
}

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
  onClearRange?(from: Selection, to: Selection): void;
  /** Persist widths when the file format supports them; otherwise widths last for this view. */
  onResizeColumn?(c: number, widthPx: number): void;
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
  /** Friendly display for text formats; editing and copying retain the original value. */
  displayText?(value: string): string;
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
  onClearRange,
  onResizeColumn,
  selection,
  onSelect,
  pad = { rows: 30, cols: 8 },
  label,
  textOnly,
  align,
  onRows,
  fixedHeader,
  displayText,
}: SheetGridProps) {
  const editValue = textOnly ? textValue : cellEditValue;
  const gridId = useId();
  const shownValue = (cell: Cell | undefined) =>
    displayText ? displayText(displayValue(cell)) : displayValue(cell);
  const scroller = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const resizeCleanup = useRef<(() => void) | null>(null);
  const [rangeState, setRangeState] = useState<{ anchor: Selection; end: Selection } | null>(null);
  const rangeEnd =
    rangeState?.anchor.r === selection.r && rangeState.anchor.c === selection.c
      ? rangeState.end
      : selection;
  const range = rangeBounds(selection, rangeEnd);
  const [extent, setExtent] = useState({ rows: 100, cols: 26 });
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>({});
  const [editing, setEditing] = useState<{ value: string; from: 'cell' | 'bar' } | null>(null);
  const [view, setView] = useState({ top: 0, height: 600 });
  const dataRows = sheet.rows.length;
  const dataCols = useMemo(() => Math.max(1, ...sheet.rows.map((r) => r?.length ?? 0)), [sheet]);
  // Spare rows and columns to type into, unless the shape is fixed (a Markdown table).
  const grow = !readOnly && (pad.rows > 0 || pad.cols > 0);
  const rows = Math.max(dataRows + (readOnly ? 0 : pad.rows), grow ? extent.rows : 1);
  const cols = Math.min(
    Math.max(dataCols + (readOnly ? 0 : pad.cols), grow ? extent.cols : 1),
    702,
  );
  const fittedWidths = useMemo(
    () =>
      Array.from({ length: dataCols }, (_, c) =>
        Math.max(
          DEFAULT_COL_W,
          Math.min(
            300,
            Math.max(
              0,
              ...sheet.rows
                .slice(0, 100)
                .map((row) =>
                  Math.min(
                    40,
                    (displayText ? displayText(displayValue(row?.[c])) : displayValue(row?.[c]))
                      .length,
                  ),
                ),
            ) *
              CHAR_W +
              24,
          ),
        ),
      ),
    [sheet, dataCols, displayText],
  );
  const widths = useMemo(
    () =>
      Array.from(
        { length: cols },
        (_, c) =>
          columnWidths[c] ??
          Math.max(
            64,
            Math.min(600, (sheet.widths?.[c] ?? 0) * 7.5 || fittedWidths[c] || DEFAULT_COL_W),
          ),
      ),
    [cols, sheet.widths, columnWidths, fittedWidths],
  );
  const lefts = useMemo(() => {
    const out = [NUM_W];
    for (let c = 0; c < cols; c++) out.push(out[c]! + widths[c]!);
    return out;
  }, [cols, widths]);

  const cell = (r: number, c: number): Cell | undefined => sheet.rows[r]?.[c];
  const active = cell(selection.r, selection.c);
  const summary = useMemo(
    () => selectionSummary(sheet, selection, rangeEnd),
    [sheet, selection, rangeEnd],
  );
  const selectedAddress = addr(selection.r, selection.c);
  const [addressInput, setAddressInput] = useState<string | null>(null);

  useEffect(() => {
    const stop = () => {
      dragging.current = false;
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
    return () => {
      resizeCleanup.current?.();
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
    };
  }, []);

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
          const text = displayText ? displayText(displayValue(v)) : displayValue(v);
          if (!text) continue;
          const n = wrappedLines(text, widths[c]! - 16, measure);
          lines = Math.max(lines, n);
        }
      }
      y += lines > 1 ? Math.min(lines, maxLines) * LINE_H + PAD_Y : ROW_H;
    }
    out[rows] = y;
    return out;
  }, [sheet, rows, cols, widths, wrap, maxLines, measure, displayText]);
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
    const top = rowTop(rangeEnd.r);
    const bottom = rowTop(rangeEnd.r + 1);
    if (top < el.scrollTop + ROW_H) el.scrollTop = top - ROW_H;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
    const left = lefts[rangeEnd.c]!;
    const right = lefts[rangeEnd.c + 1]!;
    if (left < el.scrollLeft + NUM_W) el.scrollLeft = left - NUM_W;
    else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, rangeEnd, lefts, tops]);

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

  const first = Math.max(0, rowAt(view.top) - OVERSCAN);
  const last = Math.min(rows, rowAt(view.top + view.height) + 1 + OVERSCAN);

  const select = (next: Selection, extend = false) => {
    if (extend) setRangeState({ anchor: selection, end: next });
    else {
      setRangeState(null);
      onSelect(next);
    }
  };
  const move = (dr: number, dc: number, extend = false) => {
    const origin = extend ? rangeEnd : selection;
    select(
      {
        r: Math.max(0, Math.min(rows - 1, origin.r + dr)),
        c: Math.max(0, Math.min(cols - 1, origin.c + dc)),
      },
      extend,
    );
  };
  const clearSelection = () => {
    if (readOnly) return;
    if (onClearRange) onClearRange(range.from, range.to);
    else if (onPaste && (rangeEnd.r !== selection.r || rangeEnd.c !== selection.c))
      onPaste(
        range.from.r,
        range.from.c,
        Array.from({ length: range.to.r - range.from.r + 1 }, () =>
          Array.from({ length: range.to.c - range.from.c + 1 }, () => ''),
        ),
      );
    else onClear?.(selection.r, selection.c);
  };

  const barDone = useRef(false);
  const commit = (value: string, then?: [number, number], focus = true) => {
    if (onEdit && value !== editValue(active)) onEdit(selection.r, selection.c, value);
    setEditing(null);
    if (then) move(then[0], then[1]);
    if (focus) scroller.current?.focus({ preventScroll: true });
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
      if (mod)
        select(
          {
            r: dr < 0 ? 0 : dr > 0 ? Math.max(0, dataRows - 1) : selection.r,
            c: dc < 0 ? 0 : dc > 0 ? Math.max(0, dataCols - 1) : selection.c,
          },
          e.shiftKey,
        );
      else move(dr, dc, e.shiftKey);
      return;
    }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      onSelect({ r: 0, c: 0 });
      setRangeState({
        anchor: { r: 0, c: 0 },
        end: { r: Math.max(0, dataRows - 1), c: Math.max(0, dataCols - 1) },
      });
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      move(0, e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      select({ r: mod ? 0 : selection.r, c: 0 }, e.shiftKey);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      select(
        { r: mod ? Math.max(0, dataRows - 1) : selection.r, c: Math.max(0, dataCols - 1) },
        e.shiftKey,
      );
      return;
    }
    if (e.key === 'Escape') {
      setRangeState(null);
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

  const onCopy = (e: React.ClipboardEvent) => {
    if (editing) return;
    e.preventDefault();
    const block = Array.from({ length: range.to.r - range.from.r + 1 }, (_, i) =>
      Array.from({ length: range.to.c - range.from.c + 1 }, (_, j) =>
        displayValue(cell(range.from.r + i, range.from.c + j)),
      ),
    );
    e.clipboardData.setData(
      'text/plain',
      serializeDelimited(block, { delimiter: '\t', eol: '\n', quoteAll: false, bom: false }).slice(
        0,
        -1,
      ),
    );
  };

  const onPasteEvent = (e: React.ClipboardEvent) => {
    if (editing || readOnly || !onPaste) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    const block = parseDelimited(text, '\t').rows;
    onPaste(range.from.r, range.from.c, block.length ? block : [['']]);
    setRangeState(null);
  };

  const resizeColumn = (c: number, width: number) => {
    const next = Math.round(Math.max(64, Math.min(600, width)));
    setColumnWidths((prev) => ({ ...prev, [c]: next }));
    return next;
  };
  const persistWidth = (c: number, width: number) => {
    onResizeColumn?.(c, width);
    if (onResizeColumn)
      setColumnWidths((prev) => {
        const next = { ...prev };
        delete next[c];
        return next;
      });
  };
  const fitColumn = (c: number) => {
    const measureText = textMeasurer(false) ?? ((s: string) => s.length * CHAR_W);
    const width = Math.max(
      DEFAULT_COL_W,
      ...sheet.rows
        .slice(0, 500)
        .map((row) => Math.max(...shownValue(row?.[c]).split('\n').map(measureText)) + 24),
    );
    persistWidth(c, resizeColumn(c, width));
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

  return (
    <div className="sheet-workspace flex h-full min-h-0 flex-col">
      <div className="sheet-formula flex shrink-0 items-center gap-2 border-b border-hairline px-2 py-1">
        <input
          className="sheet-address w-20 shrink-0 rounded px-1 py-1 text-center font-mono text-caption"
          aria-label="Go to cell"
          title="Type a cell address, like C12, and press Enter"
          value={addressInput ?? selectedAddress}
          onFocus={(e) => {
            setAddressInput(selectedAddress);
            e.currentTarget.select();
          }}
          onChange={(e) => {
            e.currentTarget.setCustomValidity('');
            setAddressInput(e.target.value);
          }}
          onBlur={() => setAddressInput(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setAddressInput(null);
              scroller.current?.focus();
            }
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const pos = parseAddr(e.currentTarget.value.trim());
            if (
              !pos ||
              pos.r < 0 ||
              pos.r >= 1048576 ||
              pos.c >= 702 ||
              (!grow && (pos.r >= rows || pos.c >= cols))
            ) {
              e.currentTarget.setCustomValidity(
                grow
                  ? 'Enter an address from A1 to ZZ1048576.'
                  : 'Enter an address within this sheet.',
              );
              e.currentTarget.reportValidity();
              return;
            }
            setExtent((prev) => ({
              rows: Math.max(prev.rows, pos.r + 30),
              cols: Math.min(702, Math.max(prev.cols, pos.c + 4)),
            }));
            select(pos);
            setAddressInput(null);
            scroller.current?.focus();
          }}
        />
        <span className="font-mono text-caption text-stone" aria-hidden>
          fx
        </span>
        <input
          className="sheet-formula-input h-8 min-w-0 flex-1 px-2 py-0 font-mono text-[13px]"
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
            commit(e.currentTarget.value, undefined, false);
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
        aria-multiselectable="true"
        aria-activedescendant={`${gridId}-${selectedAddress}`}
        aria-label={label}
        aria-rowcount={rows}
        aria-colcount={cols}
        aria-readonly={readOnly}
        data-testid="sheet-grid"
        onKeyDown={onGridKey}
        onCopy={onCopy}
        onCut={(e) => {
          if (!editing) {
            onCopy(e);
            clearSelection();
          }
        }}
        onPaste={onPasteEvent}
      >
        <div style={{ height: tops[rows], width: totalW, position: 'relative' }}>
          {/* Column headers */}
          <div
            className="sticky top-0 z-20 flex"
            style={{ height: ROW_H, width: totalW }}
            role="row"
          >
            <div className="sheet-corner sticky left-0 z-30" style={{ width: NUM_W }} />
            {widths.map((w, c) => (
              <div
                key={c}
                role="columnheader"
                className={`sheet-head relative ${c >= range.from.c && c <= range.to.c ? 'is-active' : ''}`}
                style={{ width: w }}
              >
                {colName(c)}
                <span
                  role="separator"
                  aria-label={`Resize column ${colName(c)}`}
                  aria-orientation="vertical"
                  aria-valuenow={Math.round(w)}
                  aria-valuemin={64}
                  aria-valuemax={600}
                  tabIndex={0}
                  className="sheet-resize"
                  title="Drag to resize. Double-click to fit contents."
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                      e.preventDefault();
                      e.stopPropagation();
                      persistWidth(c, resizeColumn(c, w + (e.key === 'ArrowLeft' ? -16 : 16)));
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      e.stopPropagation();
                      fitColumn(c);
                    }
                  }}
                  onDoubleClick={() => fitColumn(c)}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    resizeCleanup.current?.();
                    const start = e.clientX;
                    let width = w;
                    const moveResize = (event: PointerEvent) => {
                      width = resizeColumn(c, w + event.clientX - start);
                    };
                    const endResize = () => {
                      resizeCleanup.current?.();
                      persistWidth(c, width);
                    };
                    resizeCleanup.current = () => {
                      window.removeEventListener('pointermove', moveResize);
                      window.removeEventListener('pointerup', endResize);
                      window.removeEventListener('pointercancel', endResize);
                      resizeCleanup.current = null;
                    };
                    window.addEventListener('pointermove', moveResize);
                    window.addEventListener('pointerup', endResize);
                    window.addEventListener('pointercancel', endResize);
                  }}
                />
              </div>
            ))}
          </div>
          {(headerRow
            ? [
                0,
                ...Array.from(
                  { length: Math.max(0, last - Math.max(1, first)) },
                  (_, k) => Math.max(1, first) + k,
                ),
              ]
            : Array.from({ length: Math.max(0, last - first) }, (_, k) => first + k)
          ).map((r) => {
            return (
              <div
                key={r}
                className={`${headerRow && r === 0 ? 'sticky z-10' : 'absolute'} left-0 flex`}
                style={{
                  top: headerRow && r === 0 ? ROW_H : rowTop(r),
                  height: rowH(r),
                  width: totalW,
                }}
                role="row"
                aria-rowindex={r + 1}
              >
                <div
                  role="rowheader"
                  className={`sheet-rownum sticky left-0 z-10 ${r >= range.from.r && r <= range.to.r ? 'is-active' : ''} ${onRows && !readOnly ? 'is-actionable' : ''}`}
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
                  {r + 1}
                </div>
                {widths.map((w, c) => {
                  const v = cell(r, c);
                  const isActive = r === selection.r && c === selection.c;
                  const inRange =
                    r >= range.from.r && r <= range.to.r && c >= range.from.c && c <= range.to.c;
                  const shown = shownValue(v);
                  const numeric = typeof v?.v === 'number';
                  return (
                    <div
                      key={c}
                      role="gridcell"
                      id={`${gridId}-${addr(r, c)}`}
                      aria-selected={inRange}
                      aria-colindex={c + 1}
                      data-cell={addr(r, c)}
                      title={cellTitle(v) ?? (!wrap && shown.length > 20 ? shown : undefined)}
                      className={`sheet-cell ${wrap ? 'is-wrapped' : ''} ${inRange ? 'is-selected' : ''} ${isActive ? 'is-active' : ''} ${numeric || align?.[c] === 'right' ? 'text-right' : align?.[c] === 'center' ? 'text-center' : ''} ${v && isError(v.v) ? 'text-danger' : ''} ${headerRow && r === 0 ? 'sheet-table-header font-semibold' : ''} ${v?.stale ? 'is-stale' : ''}`}
                      style={{ width: w, height: rowH(r) }}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        if (editing && isActive) return;
                        if (e.pointerType !== 'touch') e.preventDefault();
                        if (editing) commit(editing.value);
                        select({ r, c }, e.shiftKey);
                        dragging.current = e.pointerType !== 'touch';
                        scroller.current?.focus({ preventScroll: true });
                      }}
                      onPointerEnter={(e) => {
                        if (dragging.current && e.buttons === 1)
                          setRangeState({ anchor: selection, end: { r, c } });
                      }}
                      onDoubleClick={() =>
                        !readOnly && setEditing({ value: editValue(v), from: 'cell' })
                      }
                    >
                      {isActive && editing?.from === 'cell' ? (
                        <CellEditor
                          value={editing.value}
                          onChange={(value) => setEditing({ value, from: 'cell' })}
                          onCommit={(value, then, focus) => commit(value, then, focus)}
                          onCancel={() => {
                            setEditing(null);
                            scroller.current?.focus();
                          }}
                        />
                      ) : (
                        <span
                          className={wrap ? 'cell-lines' : 'truncate'}
                          style={
                            wrap && maxLines !== Infinity
                              ? { WebkitLineClamp: maxLines, lineClamp: maxLines }
                              : undefined
                          }
                        >
                          {shown}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <div
        className="sheet-status flex min-h-8 shrink-0 items-center justify-between gap-3 border-t border-hairline px-3 py-1 text-xs text-steel"
        role="status"
        aria-label="Selection summary"
      >
        <span className="shrink-0 font-mono">
          {addr(range.from.r, range.from.c)}
          {range.from.r !== range.to.r || range.from.c !== range.to.c
            ? `:${addr(range.to.r, range.to.c)}`
            : ''}
        </span>
        <span className="min-w-0 truncate text-right" data-testid="sheet-selection-summary">
          Count: {summary.count.toLocaleString()}
          {summary.numbers > 0 &&
            ` · Sum: ${Number(summary.sum.toPrecision(12)).toLocaleString()} · Average: ${Number(summary.average.toPrecision(12)).toLocaleString()}`}
        </span>
      </div>
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
  onCommit(v: string, then?: [number, number], focus?: boolean): void;
  onCancel(): void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // Enter, Tab and Escape finish the edit; the blur that follows must not commit again.
  const done = useRef(false);
  const finish = (v: string, then?: [number, number], focus = true) => {
    if (done.current) return;
    done.current = true;
    onCommit(v, then, focus);
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
      onBlur={(e) => finish(e.currentTarget.value, undefined, false)}
    />
  );
}
