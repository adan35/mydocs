import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  addr,
  colName,
  displayValue,
  editValue,
  isError,
  type Cell,
  type Sheet,
} from '@/lib/convert/workbook';

const ROW_H = 28;
const NUM_W = 48;
const DEFAULT_COL_W = 112;
const OVERSCAN = 8;

export interface Selection {
  r: number;
  c: number;
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
  selection: Selection;
  onSelect(sel: Selection): void;
  /** Extra empty rows and columns to show past the data, so there is room to type. */
  pad?: { rows: number; cols: number };
  /** Accessible name. */
  label: string;
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
}: SheetGridProps) {
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
      Array.from({ length: cols }, (_, c) =>
        Math.max(64, Math.min(360, (sheet.widths?.[c] ?? 0) * 7.5 || DEFAULT_COL_W)),
      ),
    [cols, sheet.widths],
  );
  const lefts = useMemo(() => {
    const out = [NUM_W];
    for (let c = 0; c < cols; c++) out.push(out[c]! + widths[c]!);
    return out;
  }, [cols, widths]);

  const cell = (r: number, c: number): Cell | undefined => sheet.rows[r]?.[c];
  const active = cell(selection.r, selection.c);

  // Keep the active cell in view.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const top = (selection.r + 1) * ROW_H;
    if (top < el.scrollTop + ROW_H) el.scrollTop = top - ROW_H;
    else if (top + ROW_H > el.scrollTop + el.clientHeight)
      el.scrollTop = top + ROW_H - el.clientHeight;
    const left = lefts[selection.c]!;
    const right = lefts[selection.c + 1]!;
    if (left < el.scrollLeft + NUM_W) el.scrollLeft = left - NUM_W;
    else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth;
  }, [selection, lefts]);

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

  const first = Math.max(0, Math.floor(view.top / ROW_H) - 1 - OVERSCAN);
  const last = Math.min(rows, Math.ceil((view.top + view.height) / ROW_H) + OVERSCAN);

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
      if (mod)
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
    if (e.key === 'Home') {
      e.preventDefault();
      onSelect({ r: mod ? 0 : selection.r, c: 0 });
      return;
    }
    if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      move((e.key === 'PageDown' ? 1 : -1) * Math.max(1, Math.floor(view.height / ROW_H) - 1), 0);
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
      if (active) onClear?.(selection.r, selection.c);
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
    e.clipboardData.setData('text/plain', displayValue(active));
  };

  const onPasteEvent = (e: React.ClipboardEvent) => {
    if (editing || readOnly || !onPaste) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n').replace(/\n$/, '');
    onPaste(
      selection.r,
      selection.c,
      text.split('\n').map((l) => l.split('\t')),
    );
  };

  const totalW = lefts[cols]!;
  const cellTitle = (c: Cell | undefined) =>
    c?.stale
      ? 'Not recalculated: this formula uses functions MyDocs does not support. The value saved in the file is shown.'
      : c?.f
        ? `=${c.f}`
        : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-hairline-soft px-2 py-1">
        <span
          className="w-14 shrink-0 text-center font-mono text-caption text-steel"
          aria-label="Selected cell"
        >
          {addr(selection.r, selection.c)}
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
        data-testid="sheet-grid"
        onKeyDown={onGridKey}
        onCopy={onCopy}
        onPaste={onPasteEvent}
      >
        <div style={{ height: (rows + 1) * ROW_H, width: totalW, position: 'relative' }}>
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
                className={`sheet-head ${c === selection.c ? 'is-active' : ''}`}
                style={{ width: w }}
              >
                {colName(c)}
              </div>
            ))}
          </div>
          {Array.from({ length: Math.max(0, last - first) }, (_, k) => {
            const r = first + k;
            return (
              <div
                key={r}
                className="absolute left-0 flex"
                style={{ top: (r + 1) * ROW_H, height: ROW_H, width: totalW }}
                role="row"
                aria-rowindex={r + 1}
              >
                <div
                  role="rowheader"
                  className={`sheet-rownum sticky left-0 z-10 ${r === selection.r ? 'is-active' : ''}`}
                  style={{ width: NUM_W }}
                >
                  {r + 1}
                </div>
                {widths.map((w, c) => {
                  const v = cell(r, c);
                  const isActive = r === selection.r && c === selection.c;
                  const shown = displayValue(v);
                  const numeric = typeof v?.v === 'number';
                  return (
                    <div
                      key={c}
                      role="gridcell"
                      aria-selected={isActive}
                      aria-colindex={c + 1}
                      data-cell={addr(r, c)}
                      title={cellTitle(v)}
                      className={`sheet-cell ${isActive ? 'is-active' : ''} ${numeric ? 'text-right' : ''} ${v && isError(v.v) ? 'text-danger' : ''} ${headerRow && r === 0 ? 'font-semibold' : ''} ${v?.stale ? 'is-stale' : ''}`}
                      style={{ width: w }}
                      onMouseDown={(e) => {
                        if (editing && isActive) return;
                        e.preventDefault();
                        if (editing) commit(editing.value);
                        onSelect({ r, c });
                        scroller.current?.focus({ preventScroll: true });
                      }}
                      onDoubleClick={() =>
                        !readOnly && setEditing({ value: editValue(v), from: 'cell' })
                      }
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
                        <span className="truncate">{shown}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
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
