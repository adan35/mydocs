import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Entry } from '@/domain/types';
import { baseName, extensionOf } from '@/domain/names';
import { ws } from '@/app/app-store';
import { toast, toastError } from '@/app/toast-store';
import { dialogs } from '@/app/dialog-store';
import { openEntry } from '@/app/actions';
import { runConversion, saveConversion } from '@/app/convert';
import { convert } from '@/lib/convert/client';
import type { ReportData } from '@/lib/convert/doc-ast';
import { recalculate } from '@/lib/convert/formula';
import {
  addSheet,
  cloneWorkbook,
  deleteCols,
  deleteRows,
  deleteSheet,
  duplicateSheet,
  insertCols,
  colMoveTarget,
  insertRows,
  moveCols,
  moveSheet,
  renameSheet,
  sortRows,
} from '@/lib/convert/sheet-ops';
import { applyColor, resolveStyle, targetFor } from '@/lib/convert/sheet-format';
import {
  colName,
  displayValue,
  editValue,
  parseInput,
  setCellRaw,
  sheetSize,
  type Workbook,
} from '@/lib/convert/workbook';
import { SheetGrid, selectionRange, type ColMove, type Selection } from './SheetGrid';
import { SheetRibbon, type PaintScope, type SheetCommand } from './SheetRibbon';

const XLSX_GROUPS: SheetCommand[][] = [
  ['undo', 'redo'],
  ['row-above', 'row-below', 'delete-row'],
  ['col-left', 'col-right', 'delete-col', 'col-move-left', 'col-move-right'],
  ['sort-asc', 'sort-desc'],
  ['filter'],
];
import { SheetTabs } from './SheetTabs';
import { ColumnFilterPanel, FilterChips } from './ColumnFilter';
import {
  columnValues,
  filteredColumns,
  filterRows,
  type ColumnFilter,
  type ColumnFilters,
} from '@/lib/convert/table-sheet';
import { PAINT_SCOPES, usePaintScope } from './paint';
import { publishOutline } from '@/app/outline-store';
import { aonCanSee } from '@/app/aon/tools';
import type { SheetContext, SheetEdit } from '@/app/aon/sheet';

const SheetAskDialog = lazy(() =>
  import('../aon/SheetAskDialog').then((m) => ({ default: m.SheetAskDialog })),
);

type SaveState = 'saved' | 'saving' | 'error';
const SAVE_DELAY = 700;

/**
 * An Excel workbook in the sheet view. Opening never changes the file. Editing is a
 * deliberate step when the workbook has features MyDocs can't write back (styling,
 * charts, merged cells); every save keeps the previous file as a version.
 */
export function XlsxView({ entry, onConvert }: { entry: Entry; onConvert(): void }) {
  const [wb, setWb] = useState<Workbook | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [selection, setSelection] = useState<Selection>({ r: 0, c: 0 });
  const [editable, setEditable] = useState(false);
  const [save, setSave] = useState<SaveState>('saved');
  const [asking, setAsking] = useState(false);
  const [copying, setCopying] = useState(false);
  // MyDocs reads .xls but can't write it, so edits go to an .xlsx copy.
  const legacy = extensionOf(entry.name) === 'xls';
  const [lastColors, setLastColors] = useState<{ bg?: string | null; fg?: string | null }>({});
  const [paintScope, setPaintScope] = usePaintScope(selection);
  // Column filters per sheet. They hide rows in the view only; `rows` are the source rows that
  // pass, fixed when the filter is applied so a row you just edited does not vanish under you.
  const [filtBySheet, setFiltBySheet] = useState<
    Record<number, { filters: ColumnFilters; rows: number[] }>
  >({});
  const [filterMode, setFilterMode] = useState(false);
  const [filterPanel, setFilterPanel] = useState<{ col: number; anchor: HTMLElement } | null>(null);
  const undo = useRef<Workbook[]>([]);
  const redo = useRef<Workbook[]>([]);
  const timer = useRef(0);
  const pendingSave = useRef<Workbook | null>(null);
  const savedAt = useRef(0);
  const saving = useRef(false);

  // Load (and reload when the file changes from elsewhere, e.g. a version restore).
  useEffect(() => {
    // Our own saves change updatedAt too; only reload for changes from elsewhere.
    if (entry.updatedAt === savedAt.current || saving.current) return;
    let cancelled = false;
    setError(null);
    void (async () => {
      try {
        const blob = await ws().readBlob(entry.id);
        if (!blob) throw new Error('The file could not be read.');
        const out = await convert('readXlsx', { data: new Uint8Array(await blob.arrayBuffer()) });
        if (cancelled) return;
        setWb(out.workbook);
        setReport(out.report);
        setEditable(!legacy && !out.report.notes.some((n) => n.severity === 'warning'));
        setFiltBySheet({});
        setFilterPanel(null);
        undo.current = [];
        redo.current = [];
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry.id, entry.updatedAt, legacy]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const book = pendingSave.current;
    if (!book) return;
    pendingSave.current = null;
    setSave('saving');
    saving.current = true;
    try {
      const out = await convert('writeXlsx', { workbook: book, title: baseName(entry.name) });
      const saved = await ws().saveBlob(
        entry.id,
        new Blob([out.data as BlobPart], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      );
      savedAt.current = saved.updatedAt;
      setSave(pendingSave.current ? 'saving' : 'saved');
    } catch (e) {
      setSave('error');
      toastError('Unable to save the workbook.', e, { label: 'Retry', run: () => void retry() });
      pendingSave.current ??= book;
    } finally {
      saving.current = false;
    }
    function retry() {
      return flush();
    }
  }, [entry.id, entry.name]);

  // Save on leave.
  useEffect(() => () => void flush(), [flush]);

  // Outline: the workbook's sheets.
  useEffect(() => {
    if (!wb) return;
    const filled = (rows: unknown[][]) =>
      rows.filter((r) => r?.some((c) => c !== undefined)).length;
    publishOutline(entry.id, {
      items: wb.sheets.map((sh, i) => ({
        key: `${i}`,
        level: 1,
        text: sh.name,
        detail: `${filled(sh.rows).toLocaleString()} rows`,
      })),
      active: Math.min(sheetIndex, wb.sheets.length - 1),
      noun: 'sheets',
      jump: (i) => {
        setSheetIndex(i);
        setSelection({ r: 0, c: 0 });
      },
    });
  }, [wb, sheetIndex, entry.id]);
  useEffect(() => () => publishOutline(entry.id, null), [entry.id]);

  // The sheet on screen. A version restore or undo can leave fewer sheets than the index says.
  const si = wb ? Math.max(0, Math.min(sheetIndex, wb.sheets.length - 1)) : 0;

  // Row 1 is the header: it always shows and is never filtered.
  const HEADER_ROWS = 1;
  const cur = filtBySheet[si];
  const rowMap = cur && filteredColumns(cur.filters).length ? cur.rows : null;
  /** The sheet row behind a row of the (possibly filtered) grid. */
  const src = (r: number) => (rowMap ? (rowMap[r] ?? r) : r);
  const full = wb?.sheets[si];
  const view = useMemo(
    () => (full && rowMap ? { ...full, rows: rowMap.map((i) => full.rows[i] ?? []) } : full),
    [full, rowMap],
  );
  const panelValues = useMemo(
    () =>
      full && filterPanel
        ? columnValues(full, filterPanel.col, cur?.filters ?? {}, HEADER_ROWS)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [full, filterPanel?.col, cur?.filters],
  );
  const colLabel = (c: number) => {
    const head = displayValue(full?.rows[0]?.[c]).trim();
    return head
      ? `${colName(c)} · ${head.length > 24 ? `${head.slice(0, 24)}…` : head}`
      : colName(c);
  };
  const setFilters = (idx: number, filters: ColumnFilters, book: Workbook) =>
    setFiltBySheet((prev) => {
      const next = { ...prev };
      if (filteredColumns(filters).length)
        next[idx] = { filters, rows: filterRows(book.sheets[idx]!, filters, HEADER_ROWS) };
      else delete next[idx];
      return next;
    });
  /** Works out again which rows pass (after undo, redo or a sort changed the rows or values). */
  const refilter = (book: Workbook) =>
    setFiltBySheet((prev) => {
      const next: typeof prev = {};
      for (const [k, v] of Object.entries(prev)) {
        const sh = book.sheets[Number(k)];
        if (sh)
          next[Number(k)] = { filters: v.filters, rows: filterRows(sh, v.filters, HEADER_ROWS) };
      }
      return next;
    });
  const applyFilter = (col: number, f: ColumnFilter | null) => {
    if (!wb) return;
    const filters = { ...(cur?.filters ?? {}) };
    if (f) filters[col] = f;
    else delete filters[col];
    setFilters(si, filters, wb);
    setFilterMode(true);
    setSelection({ r: 0, c: selection.c });
    setFilterPanel(null);
    filterPanel?.anchor.focus();
  };
  /** Inserting or deleting rows and columns would act on the hidden rows too. */
  const blockedByFilter = () => {
    if (!rowMap) return false;
    toast({ message: 'Clear the filters first: this would also change the rows they hide.' });
    return true;
  };

  const commit = (next: Workbook) => {
    if (!wb) return;
    undo.current.push(wb);
    if (undo.current.length > 100) undo.current.shift();
    redo.current = [];
    recalculate(next);
    setWb(next);
    pendingSave.current = next;
    setSave('saving');
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), SAVE_DELAY);
  };

  const edit = (fn: (book: Workbook) => void | false) => {
    if (!wb || !editable) return;
    const next = cloneWorkbook(wb);
    if (fn(next) === false) return;
    commit(next);
  };

  const run = (cmd: SheetCommand) => {
    if (!wb) return;
    if (cmd === 'undo' || cmd === 'redo') {
      const from = cmd === 'undo' ? undo.current : redo.current;
      const to = cmd === 'undo' ? redo.current : undo.current;
      const prev = from.pop();
      if (!prev) return;
      to.push(wb);
      setWb(prev);
      refilter(prev);
      pendingSave.current = prev;
      setSave('saving');
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY);
      return;
    }
    if (cmd === 'filter') {
      // On: a funnel on every column header. Off: all the filters on this sheet go.
      if (filterMode || rowMap) {
        setFilters(si, {}, wb);
        setSelection({ r: 0, c: selection.c });
      }
      setFilterMode(!(filterMode || rowMap));
      return;
    }
    if (cmd === 'col-move-left' || cmd === 'col-move-right') {
      moveSelected(cmd === 'col-move-left' ? 'left' : 'right');
      return;
    }
    if (cmd !== 'sort-asc' && cmd !== 'sort-desc' && blockedByFilter()) return;
    const { r, c } = selection;
    edit((book) => {
      switch (cmd) {
        case 'row-above':
          return insertRows(book, si, r);
        case 'row-below':
          insertRows(book, si, r + 1);
          setSelection({ r: r + 1, c });
          return;
        case 'delete-row':
          return deleteRows(book, si, r);
        case 'col-left':
          return insertCols(book, si, c);
        case 'col-right':
          insertCols(book, si, c + 1);
          setSelection({ r, c: c + 1 });
          return;
        case 'delete-col':
          return deleteCols(book, si, c);
        case 'sort-asc':
        case 'sort-desc': {
          const { ok } = sortRows(book.sheets[si]!, c, cmd === 'sort-asc' ? 'asc' : 'desc');
          if (!ok) {
            toast({
              message:
                "Rows with formulas can't be sorted here: their references would point at different cells.",
            });
            return false;
          }
          refilter(book);
        }
      }
    });
  };

  /** Moves columns (a drag, the menu, a button or a key) and keeps them selected. */
  const moveColumns = ({ from, count, to, widths }: ColMove) => {
    if (!wb || !editable) return;
    edit((book) => {
      const s = book.sheets[si]!;
      // Widths set by dragging a border live in the grid; save them so they travel with the columns.
      for (const [c, px] of Object.entries(widths)) (s.widths ??= [])[Number(c)] = px / 7.5;
      return moveCols(book, si, from, count, to) ? undefined : false;
    });
    // Filters belong to their columns: they move along (the rows that pass don't change).
    const newCol = (c: number) => {
      if (c >= from && c < from + count) return to + c - from;
      const rest = c < from ? c : c - count;
      return rest < to ? rest : rest + count;
    };
    setFiltBySheet((prev) => {
      const f = prev[si];
      if (!f) return prev;
      const moved: ColumnFilters = {};
      for (const [c, cf] of Object.entries(f.filters)) moved[newCol(Number(c))] = cf;
      return { ...prev, [si]: { ...f, filters: moved } };
    });
    const bottom = Math.max(0, (view ?? wb.sheets[si]!).rows.length - 1);
    setSelection({
      r: 0,
      c: to,
      to: bottom > 0 || count > 1 ? { r: bottom, c: to + count - 1 } : undefined,
      scope: 'cols',
    });
  };
  const moveSelected = (where: 'left' | 'right') => {
    if (!wb || !editable) return;
    const [, c1, , c2] = selectionRange(selection);
    const count = c2 - c1 + 1;
    const to = colMoveTarget(c1, count, where, sheetSize(wb.sheets[si]!).cols);
    if (to !== null) moveColumns({ from: c1, count, to, widths: {} });
  };

  /** Saves the workbook as a new .xlsx next to the .xls (which stays as it is) and opens it. */
  const editAsXlsx = async () => {
    setCopying(true);
    try {
      const copy = await saveConversion(await runConversion(entry.id, 'xlsx'));
      toast({ message: `Saved ${copy.name} next to the original .xls. You are editing the copy.` });
      await openEntry(copy.id);
    } catch (e) {
      toastError('Unable to make an .xlsx copy.', e);
    } finally {
      setCopying(false);
    }
  };

  const switchTo = (i: number) => {
    setSheetIndex(i);
    setSelection({ r: 0, c: 0 });
  };

  /** Paints the selection (cells, whole rows or whole columns), or clears it with null. */
  const paint = (prop: 'bg' | 'fg', color: string | null) => {
    const [r1, c1, r2, c2] = selectionRange(selection);
    // The sheet rows behind the selection (a filter hides some), as runs of neighbours.
    const runs: [number, number][] = [];
    if (!rowMap) runs.push([r1, r2]);
    else
      for (let r = r1; r <= r2; r++) {
        const at = src(r);
        const last = runs[runs.length - 1];
        if (last && last[1] === at - 1) last[1] = at;
        else runs.push([at, at]);
      }
    try {
      edit((book) => {
        const s = book.sheets[si]!;
        if (paintScope === 'cols')
          s.format = applyColor(s.format, targetFor([0, c1, 0, c2], 'cols'), prop, color);
        else
          for (const [from, to] of runs)
            s.format = applyColor(s.format, targetFor([from, c1, to, c2], paintScope), prop, color);
      });
      setLastColors((l) => ({ ...l, [prop]: color }));
    } catch (e) {
      if (!(e instanceof RangeError)) throw e;
      toast({
        message:
          'That selection is too large to color cell by cell. Color whole rows or columns instead.',
      });
    }
  };

  if (error)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <AlertTriangle className="text-warning" size={28} aria-hidden />
        <p className="font-medium text-ink">This workbook could not be opened</p>
        <p className="max-w-md text-caption text-steel">{error}</p>
      </div>
    );
  if (!wb)
    return <div className="skeleton m-6 h-60" aria-busy="true" aria-label="Loading workbook" />;

  const sheet = wb.sheets[si]!;
  const shownSheet = view ?? sheet;
  const warnings = report?.notes.filter((n) => n.severity === 'warning') ?? [];
  const stale = report?.notes.find((n) => /can't calculate/.test(n.message));
  const aonContext = (): SheetContext => {
    const size = sheetSize(sheet);
    return {
      name: sheet.name,
      rowCount: size.rows,
      colCount: size.cols,
      cell: (r, c) => editValue(sheet.rows[r]?.[c]),
      formulas: true,
      selection: (([r1, c1, r2, c2]) =>
        [src(r1), c1, src(r2), c2] as [number, number, number, number])(selectionRange(selection)),
    };
  };
  const applyAon = (edits: SheetEdit[]) => {
    edit((book) => {
      const s = book.sheets[si]!;
      for (const e of edits) setCellRaw(s, e.r, e.c, parseInput(e.value, s.rows[e.r]?.[e.c]));
    });
    toast({
      message: `AON changed ${edits.length} cell${edits.length === 1 ? '' : 's'}. Ctrl+Z undoes it.`,
    });
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).tagName === 'INPUT') return;
        if (e.altKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          e.preventDefault();
          moveSelected(e.key === 'ArrowLeft' ? 'left' : 'right');
          return;
        }
        const mod = e.metaKey || e.ctrlKey;
        if (!mod) return;
        const k = e.key.toLowerCase();
        if (k === 'z' || k === 'y') {
          e.preventDefault();
          run(k === 'y' || e.shiftKey ? 'redo' : 'undo');
        } else if (k === 's') {
          e.preventDefault();
          void flush();
        }
      }}
    >
      {legacy && (
        <div
          className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline bg-surface-soft px-3 py-2 text-caption text-charcoal"
          role="status"
        >
          <AlertTriangle size={15} className="shrink-0 text-warning" aria-hidden />
          <span className="min-w-[min(100%,16rem)] flex-1">
            Legacy .xls files can&apos;t be saved in place. Edit as .xlsx makes a copy next to this
            file and keeps the original untouched.
          </span>
          <button type="button" className="btn btn-secondary h-8" onClick={onConvert}>
            Convert or export…
          </button>
          <button
            type="button"
            className="btn btn-primary h-8"
            disabled={copying}
            onClick={() => void editAsXlsx()}
          >
            {copying ? 'Making copy…' : 'Edit as .xlsx'}
          </button>
        </div>
      )}
      {!editable && !legacy && (
        <div
          className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline bg-surface-soft px-3 py-2 text-caption text-charcoal"
          role="status"
        >
          <AlertTriangle size={15} className="shrink-0 text-warning" aria-hidden />
          <span className="min-w-[min(100%,16rem)] flex-1">
            Viewing only. Saving changes would drop:{' '}
            {warnings.map((w) => w.message.replace(/\.$/, '').toLowerCase()).join('; ')}.
          </span>
          <button type="button" className="btn btn-secondary h-8" onClick={onConvert}>
            Convert or export…
          </button>
          <button
            type="button"
            className="btn btn-primary h-8"
            onClick={() => {
              setEditable(true);
              toast({
                message:
                  'Editing on. The original file is kept in version history on the first save.',
              });
            }}
          >
            Edit anyway
          </button>
        </div>
      )}
      <SheetRibbon
        run={run}
        groups={XLSX_GROUPS}
        readOnly={!editable}
        onAsk={() => setAsking(true)}
        pressed={{ filter: filterMode || !!rowMap }}
        colors={{
          last: lastColors,
          onPick: paint,
          scopes: PAINT_SCOPES,
          scope: paintScope as PaintScope,
          onScope: setPaintScope,
        }}
        disabled={{ undo: !undo.current.length, redo: !redo.current.length }}
      >
        <span
          className="shrink-0 px-2 text-caption text-steel"
          aria-live="polite"
          data-testid="sheet-save-status"
        >
          {save === 'saving'
            ? 'Saving…'
            : save === 'error'
              ? 'Not saved'
              : editable
                ? 'Saved'
                : 'Read only'}
        </span>
        {stale && (
          <span
            className="flex shrink-0 items-center gap-1 px-1 text-caption text-warning"
            title={stale.message}
          >
            <AlertTriangle size={13} aria-hidden /> Some formulas not recalculated
          </span>
        )}
      </SheetRibbon>
      {cur && (
        <FilterChips
          filters={cur.filters}
          labelOf={colLabel}
          onEdit={(col, anchor) => setFilterPanel({ col, anchor })}
          onRemove={(col) => applyFilter(col, null)}
          onClear={() => {
            setFilters(si, {}, wb);
            setSelection({ r: 0, c: selection.c });
          }}
          shown={Math.max(0, (rowMap?.length ?? 0) - HEADER_ROWS)}
          total={Math.max(0, sheet.rows.length - HEADER_ROWS)}
        />
      )}
      <div className="min-h-0 flex-1">
        <SheetGrid
          sheet={shownSheet}
          label={`${sheet.name} cells`}
          styleAt={(r, c) => resolveStyle(sheet.format, src(r), c)}
          readOnly={!editable}
          selection={selection}
          onSelect={setSelection}
          rowLabels={rowMap?.map((i) => i + 1)}
          pad={rowMap ? { rows: 0, cols: 0 } : undefined}
          onFilter={(col, anchor) => {
            setFilterMode(true);
            setFilterPanel({ col, anchor });
          }}
          filterColumns={new Set(cur ? filteredColumns(cur.filters) : [])}
          filterMode={filterMode || !!rowMap}
          onMoveCols={moveColumns}
          onEdit={(r, c, input) =>
            edit((book) =>
              setCellRaw(
                book.sheets[si]!,
                src(r),
                c,
                parseInput(input, book.sheets[si]!.rows[src(r)]?.[c]),
              ),
            )
          }
          onRows={(a) => {
            if (blockedByFilter()) return;
            edit((book) => {
              if (a.kind === 'insert') insertRows(book, si, a.at, a.count);
              else deleteRows(book, si, a.at, a.count);
            });
            if (a.select !== undefined) setSelection({ r: a.select, c: selection.c });
          }}
          onClear={(r, c) => edit((book) => setCellRaw(book.sheets[si]!, src(r), c, undefined))}
          onClearRange={([r1, c1, r2, c2]) =>
            edit((book) => {
              for (let r = r1; r <= r2; r++)
                for (let c = c1; c <= c2; c++) setCellRaw(book.sheets[si]!, src(r), c, undefined);
            })
          }
          onPaste={(r, c, block) =>
            edit((book) => {
              const s = book.sheets[si]!;
              block.forEach((line, i) => {
                // Pasting into a filtered view goes into the rows shown, one after the other.
                if (rowMap && r + i >= rowMap.length) return;
                line.forEach((v, j) => setCellRaw(s, src(r + i), c + j, parseInput(v)));
              });
            })
          }
        />
      </div>
      <SheetTabs
        sheets={wb.sheets.map((x) => ({ name: x.name, color: x.tabColor }))}
        active={si}
        editable={editable}
        onSelect={switchTo}
        onAdd={() =>
          edit((book) => {
            setFiltBySheet({});
            setSheetIndex(addSheet(book, si));
            setSelection({ r: 0, c: 0 });
          })
        }
        onRename={(i, name) => edit((book) => void renameSheet(book, i, name))}
        onDuplicate={(i) =>
          edit((book) => {
            setFiltBySheet({});
            setSheetIndex(duplicateSheet(book, i));
            setSelection({ r: 0, c: 0 });
          })
        }
        onDelete={async (i) => {
          const name = wb.sheets[i]!.name;
          const ok = await dialogs.confirm({
            title: `Delete “${name}”?`,
            message:
              'The sheet and everything on it are removed. Formulas on other sheets that use it will show #REF!. You can undo this with Ctrl+Z.',
            confirmLabel: 'Delete sheet',
            danger: true,
          });
          if (!ok) return;
          edit((book) => {
            if (!deleteSheet(book, i)) return false;
            setFiltBySheet({});
            setSheetIndex(Math.max(0, Math.min(i, book.sheets.length - 1)));
            setSelection({ r: 0, c: 0 });
          });
        }}
        onMove={(from, to) =>
          edit((book) => {
            if (!moveSheet(book, from, to)) return false;
            setFiltBySheet({});
            // The sheet on screen stays on screen, wherever it moved to.
            setSheetIndex(
              si === from
                ? to
                : si > from && si <= to
                  ? si - 1
                  : si < from && si >= to
                    ? si + 1
                    : si,
            );
          })
        }
        onColor={(i, color) =>
          edit((book) => {
            if (color) book.sheets[i]!.tabColor = color;
            else delete book.sheets[i]!.tabColor;
          })
        }
      />
      {filterPanel && (
        <ColumnFilterPanel
          anchor={filterPanel.anchor}
          title={colLabel(filterPanel.col)}
          values={panelValues}
          filter={cur?.filters[filterPanel.col]}
          onApply={(f) => applyFilter(filterPanel.col, f)}
          onClose={(restore) => {
            if (restore) filterPanel.anchor.focus();
            setFilterPanel(null);
          }}
        />
      )}
      {asking && (
        <Suspense fallback={null}>
          <SheetAskDialog
            ctx={aonContext()}
            allowed={aonCanSee(entry.id)}
            canApply={editable}
            onApply={applyAon}
            onClose={() => setAsking(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
