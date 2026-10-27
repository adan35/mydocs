import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Filter as FilterIcon, Table2, X } from 'lucide-react';
import type { EntryId } from '@/domain/types';
import { extensionOf } from '@/domain/names';
import { serializeTable, emptyTable } from '@/domain/table';
import { docModel } from '@/app/doc-model';
import { editorActions } from '@/app/editor-store';
import { toast } from '@/app/toast-store';
import { dialogs } from '@/app/dialog-store';
import {
  DELIMITED_EXTENSIONS,
  delimitedToSheet,
  detectDialect,
  findMarkdownTables,
  rewriteDelimited,
  sheetToTable,
  tableToSheet,
} from '@/lib/convert/delimited';
import type { Cell, Sheet } from '@/lib/convert/workbook';
import type { Align } from '@/domain/table';
import {
  FILTER_OPS,
  autoSum,
  deleteColsAt,
  deleteRowsAt,
  describeFilter,
  evaluateRows,
  fillRange,
  filterRows,
  insertColsAt,
  insertRowsAt,
  setBlock,
  setCellText,
  sortRows,
  toggleEmphasis,
  type Filter,
  type FilterOp,
  type Rows,
} from '@/lib/convert/table-sheet';
import { SheetGrid, selectionRange, type RowAction, type Selection } from './SheetGrid';
import { SheetRibbon, type SheetCommand } from './SheetRibbon';
import { publishOutline } from '@/app/outline-store';
import { aonCanSee } from '@/app/aon/tools';
import type { SheetContext, SheetEdit } from '@/app/aon/sheet';

const SheetAskDialog = lazy(() =>
  import('../aon/SheetAskDialog').then((m) => ({ default: m.SheetAskDialog })),
);

/** Replaces the document text with one minimal change, so undo and other views stay exact. */
function applyText(id: EntryId, prev: string, next: string) {
  if (prev === next) return;
  let start = 0;
  while (start < prev.length && start < next.length && prev[start] === next[start]) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--;
    endNext--;
  }
  editorActions.edit(id, {
    changes: { from: start, to: endPrev, insert: next.slice(start, endNext) },
    userEvent: 'input.sheet',
  });
}

const rowsOf = (sheet: Sheet): string[][] => {
  const width = Math.max(0, ...sheet.rows.map((r) => r?.length ?? 0));
  return sheet.rows.map((r) => Array.from({ length: width }, (_, c) => cellText(r?.[c])));
};
const cellText = (c: Cell | undefined) => (c ? String(c.v ?? '') : '');
const colLetter = (c: number): string =>
  (c >= 26 ? colLetter(Math.floor(c / 26) - 1) : '') + String.fromCharCode(65 + (c % 26));

/** Empty rows between tables when a document's tables are shown together. */
const TABLE_GAP = 2;

/**
 * Edits CSV/TSV/UNL files and Markdown tables as a grid. Every change is written back to the
 * text as one transaction on the document model: only the edited row (CSV) or the
 * edited table (Markdown) changes, and undo works across the grid and the source.
 *
 * A Markdown document with several tables shows them all in one grid, stacked with a gap.
 * Each table keeps its own cell addresses (A1 is its header's first cell) and its own row
 * numbers, so a formula means the same thing here as in the file.
 */
export function TextSheetView({
  docId,
  name,
  text,
  onConvert,
}: {
  docId: EntryId;
  name: string;
  text: string;
  onConvert?(): void;
}) {
  const ext = extensionOf(name);
  const markdown = !DELIMITED_EXTENSIONS.includes(ext);
  // Used when one table is shown on its own (a filter is open).
  const [tableIndex, setTableIndex] = useState(0);
  const [selection, setSelection] = useState<Selection>({ r: 0, c: 0 });
  // UNL exports have no header row; their columns are named A, B, C…
  const [headerRow, setHeaderRow] = useState(ext !== 'unl');
  const [filters, setFilters] = useState<Filter[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [freeze, setFreeze] = useState({ rows: 0, cols: 0 });
  const [asking, setAsking] = useState(false);

  const dialect = useMemo(
    () => (markdown ? null : detectDialect(text, ext)),
    [markdown, text, ext],
  );
  const tables = useMemo(() => (markdown ? findMarkdownTables(text) : []), [markdown, text]);
  // Every table (or the one CSV sheet): the file's cell text and the calculated view of it.
  const parts = useMemo(() => {
    const sheets = dialect
      ? [delimitedToSheet(text, dialect).sheet]
      : tables.map((t) => tableToSheet(t.table));
    return sheets.map((sh) => {
      const rows = rowsOf(sh);
      return { rows, shown: evaluateRows(rows, markdown) };
    });
  }, [dialect, text, tables, markdown]);
  const header = headerRow || markdown;
  const skip = header ? 1 : 0;

  // Which tables are on the grid, and where each starts. With a filter open only one is shown.
  const stacked = markdown && parts.length > 1 && !filterOpen;
  const only = Math.max(0, Math.min(tableIndex, parts.length - 1));
  const visible = useMemo(
    () => (stacked ? parts.map((_, i) => i) : parts.length ? [only] : []),
    [stacked, parts, only],
  );
  const starts = useMemo(() => {
    const out: number[] = [];
    let y = 0;
    for (const t of visible) {
      out.push(y);
      y += parts[t]!.rows.length + TABLE_GAP;
    }
    return out;
  }, [visible, parts]);

  const rowMap = useMemo(
    () => (filters.length && parts[only] ? filterRows(parts[only]!.shown, filters, skip) : null),
    [filters, parts, only, skip],
  );
  const view = useMemo<Sheet>(() => {
    const rows: (Cell | undefined)[][] = [];
    visible.forEach((t, k) => {
      const own = parts[t]!.shown.rows;
      rows.push(...(rowMap && !stacked ? rowMap.map((i) => own[i]!) : own));
      if (k < visible.length - 1) for (let g = 0; g < TABLE_GAP; g++) rows.push([]);
    });
    return { name: 'Table', rows };
  }, [visible, parts, rowMap, stacked]);
  // Row numbers: each table counts from 1 (as its formulas do); gaps have none.
  const rowLabels = useMemo<(number | string)[] | undefined>(() => {
    if (rowMap) return rowMap.map((i) => i + 1);
    if (!stacked) return undefined;
    const out: (number | string)[] = [];
    visible.forEach((t, k) => {
      const n = parts[t]!.rows.length;
      for (let i = 0; i < n; i++) out.push(i + 1);
      if (k < visible.length - 1) for (let g = 0; g < TABLE_GAP; g++) out.push('');
      else for (let i = 0; i < 200; i++) out.push(n + i + 1);
    });
    return out;
  }, [rowMap, stacked, visible, parts]);

  /** The table a grid row belongs to, and the row inside it; null for the gaps between tables. */
  const locate = (r: number): { k: number; t: number; r: number } | null => {
    if (!visible.length) return null;
    if (!stacked) return { k: 0, t: visible[0]!, r: rowMap ? (rowMap[r] ?? r) : r };
    let k = visible.length - 1;
    while (k > 0 && r < starts[k]!) k--;
    const local = r - starts[k]!;
    if (k < visible.length - 1 && local >= parts[visible[k]!]!.rows.length) return null;
    return { k, t: visible[k]!, r: local };
  };
  const at = locate(selection.r);
  const activeTable = at ? at.t : only;
  const resetFilters = () => {
    setFilters([]);
    setSelection({ r: 0, c: 0 });
  };

  // Outline: the document's tables (Markdown), or the file's columns (CSV and the like).
  useEffect(() => {
    if (markdown) {
      publishOutline(docId, {
        items: tables.map((t) => ({
          key: `${t.index}`,
          level: 1,
          text: t.label ? t.label : `Table ${t.index + 1}`,
          badge: `T${t.index + 1}`,
          detail: `${t.table.rows.length} rows`,
        })),
        active: activeTable,
        noun: 'tables',
        empty: 'This document has no tables.',
        jump: (i) => {
          setTableIndex(i);
          setSelection({ r: stacked ? (starts[i] ?? 0) : 0, c: 0 });
        },
      });
      return;
    }
    const sheet = parts[0]?.shown;
    const first = sheet?.rows[0] ?? [];
    const width = Math.max(0, ...(sheet?.rows.map((r) => r?.length ?? 0) ?? [0]));
    const rows = sheet ? sheet.rows.length - (header ? 1 : 0) : 0;
    publishOutline(docId, {
      items: Array.from({ length: width }, (_, c) => ({
        key: `${c}`,
        level: 1,
        text: (header && first[c] ? String(first[c]!.v ?? '') : '') || `Column ${colLetter(c)}`,
        badge: colLetter(c),
      })),
      active: selection.c,
      noun: 'columns',
      summary: `${rows.toLocaleString()} rows`,
      empty: 'This file is empty.',
      jump: (c) => setSelection({ r: header ? 1 : 0, c }),
    });
  }, [markdown, tables, activeTable, parts, header, selection.c, docId, stacked, starts]);
  useEffect(() => () => publishOutline(docId, null), [docId]);

  /** Changes that move or add rows would act on hidden rows too; ask to clear the filter first. */
  const blockedByFilter = () => {
    if (!rowMap) return false;
    toast({ message: 'Clear the filter first: this would also change the rows it hides.' });
    return true;
  };

  /** Writes one table (or the CSV file) back to the text. */
  const write = (t: number, rows: Rows, align?: Align[]) => {
    if (dialect) {
      applyText(docId, text, rewriteDelimited(text, rows, dialect));
      return;
    }
    const tb = tables[t];
    if (!tb) return;
    const s: Sheet = {
      name: 'Table',
      rows: rows.map((r) => r.map((v) => (v === '' ? undefined : { v }))),
    };
    const out = sheetToTable(s, align ?? tb.table.align, true);
    const lines = text.split('\n');
    applyText(
      docId,
      text,
      [...lines.slice(0, tb.start), serializeTable(out), ...lines.slice(tb.end)].join('\n'),
    );
  };

  /** The selected range inside a single table, or null (with a hint) when it spans several. */
  const selected = () => {
    const [r1, c1, r2, c2] = selectionRange(selection);
    const a = locate(r1);
    const b = locate(r2);
    if (!a || !b || a.k !== b.k) {
      toast({ message: 'Select cells inside one table.' });
      return null;
    }
    const part = parts[a.t]!;
    return {
      ...a,
      src: part.rows,
      shown: part.shown,
      range: [a.r, c1, b.r, c2] as [number, number, number, number],
      /** Where a cell of this table sits on the grid. */
      row: (local: number) => starts[a.k]! + local,
    };
  };

  const onEdit = (r: number, c: number, input: string) => {
    if (!markdown && input.startsWith('=')) {
      toast({
        message: `${ext.toUpperCase()} files hold values, not formulas. Convert to an Excel workbook to calculate.`,
        action: onConvert ? { label: 'Convert…', run: onConvert } : undefined,
      });
      return;
    }
    const loc = locate(r);
    if (!loc) {
      toast({ message: 'These rows sit between two tables. Type inside a table to edit it.' });
      return;
    }
    // Cells are text, kept exactly as typed; a Markdown cell starting with "=" is a formula.
    write(loc.t, setCellText(parts[loc.t]!.rows, loc.r, c, input));
  };

  const onPaste = (r: number, c: number, block: string[][]) => {
    if (blockedByFilter()) return;
    const loc = locate(r);
    if (!loc) return void toast({ message: 'Paste inside a table, not between tables.' });
    write(loc.t, setBlock(parts[loc.t]!.rows, loc.r, c, block));
  };

  const onClearRange = () => {
    const sel = selected();
    if (!sel) return;
    const [r1, c1, r2, c2] = sel.range;
    const out = sel.src.map((row) => [...row]);
    for (let r = r1; r <= r2; r++)
      for (let c = c1; c <= c2; c++) {
        const row = out[rowMap ? (rowMap[r] ?? r) : r];
        if (row && row[c] !== undefined) row[c] = '';
      }
    write(sel.t, out);
  };

  const fill = (dir: 'down' | 'right') => {
    if (blockedByFilter()) return;
    const sel = selected();
    if (!sel) return;
    const out = fillRange(sel.src, sel.range, dir);
    if (out) write(sel.t, out);
    else toast({ message: `Nothing to fill ${dir === 'down' ? 'down' : 'right'} from.` });
  };

  /** What AON sees: the table the cursor is in, and the selected cells when they are inside it. */
  const aonContext = (): { ctx: SheetContext; t: number } => {
    const [a, b, c, d] = selectionRange(selection);
    const first = locate(a);
    const last = locate(c);
    const t = first ? first.t : only;
    const rows = parts[t]?.rows ?? [];
    const inside = !!first && !!last && first.k === last.k;
    const ctx: SheetContext = {
      name: markdown ? `Table ${t + 1}` : name,
      rowCount: rows.length,
      colCount: Math.max(0, ...rows.map((r) => r.length)),
      cell: (r, col) => rows[r]?.[col] ?? '',
      formulas: markdown,
      selection: inside ? [first.r, b, last.r, d] : undefined,
    };
    return { ctx, t };
  };
  const applyAon = (t: number, edits: SheetEdit[]) => {
    let rows = parts[t]!.rows;
    for (const e of edits) rows = setCellText(rows, e.r, e.c, e.value);
    write(t, rows);
    toast({
      message: `AON changed ${edits.length} cell${edits.length === 1 ? '' : 's'}. Ctrl+Z undoes it.`,
    });
  };

  const run = (cmd: SheetCommand) => {
    if (cmd === 'undo') return void docModel.undo(docId);
    if (cmd === 'redo') return void docModel.redo(docId);
    if (cmd === 'filter') {
      if (filterOpen) resetFilters();
      else {
        // The filter works on one table: the one the cursor is in.
        setTableIndex(activeTable);
        setSelection({ r: 0, c: selection.c });
      }
      setFilterOpen(!filterOpen);
      return;
    }
    if (cmd === 'freeze-row') return void setFreeze((f) => ({ ...f, rows: f.rows ? 0 : 1 }));
    if (cmd === 'freeze-col') return void setFreeze((f) => ({ ...f, cols: f.cols ? 0 : 1 }));
    if (cmd === 'fill-down' || cmd === 'fill-right') return fill(cmd.slice(5) as 'down' | 'right');
    if (!parts.length) return;
    if (cmd !== 'sort-asc' && cmd !== 'sort-desc' && blockedByFilter()) return;
    const sel = selected();
    if (!sel) return;
    const [r1, c1, r2, c2] = sel.range;
    const c = selection.c;
    const { src, shown } = sel;
    const width = Math.max(1, ...src.map((row) => row.length));
    const tb = tables[sel.t];
    const align: Align[] = tb ? [...tb.table.align] : [];
    while (align.length < width) align.push(null);
    switch (cmd) {
      case 'row-above':
      case 'row-below': {
        const count = r2 - r1 + 1;
        const to = cmd === 'row-above' ? r1 : r2 + 1;
        if (markdown && to === 0) return;
        write(sel.t, insertRowsAt(src, Math.min(to, src.length), count));
        setSelection({ r: sel.row(to), c });
        return;
      }
      case 'delete-row': {
        const first = markdown ? Math.max(1, r1) : r1; // a Markdown table keeps its header
        const last = Math.min(r2, src.length - 1);
        if (last < first) return;
        write(sel.t, deleteRowsAt(src, first, last - first + 1));
        setSelection({
          r: sel.row(Math.max(0, Math.min(first, src.length - (last - first + 1) - 1))),
          c,
        });
        return;
      }
      case 'col-left':
      case 'col-right': {
        const count = c2 - c1 + 1;
        const to = cmd === 'col-left' ? c1 : c2 + 1;
        align.splice(to, 0, ...Array.from({ length: count }, () => null));
        write(sel.t, insertColsAt(src, to, count), align);
        setSelection({ r: selection.r, c: to });
        return;
      }
      case 'delete-col': {
        const count = Math.min(c2 - c1 + 1, width - 1);
        if (count < 1) return;
        align.splice(c1, count);
        write(sel.t, deleteColsAt(src, c1, count), align);
        setSelection({ r: selection.r, c: Math.max(0, Math.min(c1, width - count - 1)) });
        return;
      }
      case 'sort-asc':
      case 'sort-desc':
        if (blockedByFilter()) return;
        write(sel.t, sortRows(src, shown, c, cmd === 'sort-asc' ? 'asc' : 'desc', skip));
        return;
      case 'autosum': {
        const out = autoSum(src, shown, sel.range);
        if (!out) {
          toast({
            message: 'Select the numbers to add up, or an empty cell under or beside them.',
          });
          return;
        }
        write(sel.t, out.rows);
        setSelection({ r: sel.row(out.at.r), c: out.at.c });
        return;
      }
      case 'bold':
      case 'italic':
      case 'strike':
        write(sel.t, toggleEmphasis(src, sel.range, cmd));
        return;
      case 'align-left':
      case 'align-center':
      case 'align-right': {
        const to = cmd.slice(6) as 'left' | 'center' | 'right';
        const all = align.slice(c1, c2 + 1).every((a) => a === to);
        for (let k = c1; k <= c2; k++) align[k] = all ? null : to;
        write(sel.t, src, align);
        return;
      }
    }
  };

  const onRows = (a: RowAction) => {
    if (blockedByFilter()) return;
    // "Insert below" the last row of a table lands in the gap: it still belongs to that table.
    const below = a.kind === 'insert' && !locate(a.at) && a.at > 0 ? locate(a.at - 1) : null;
    const loc = below ?? locate(a.at);
    if (!loc) return;
    const rows = parts[loc.t]!.rows;
    const row = below ? loc.r + 1 : loc.r;
    write(
      loc.t,
      a.kind === 'insert' ? insertRowsAt(rows, row, a.count) : deleteRowsAt(rows, row, a.count),
    );
    if (a.select !== undefined) setSelection({ r: a.select, c: selection.c });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod || (e.target as HTMLElement).tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k === 'z' || k === 'y') {
      e.preventDefault();
      run(k === 'y' || e.shiftKey ? 'redo' : 'undo');
    }
  };

  if (markdown && !tables.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Table2 size={30} className="text-stone" aria-hidden />
        <p className="font-medium text-ink">This document has no tables</p>
        <p className="max-w-sm text-caption text-steel">
          The sheet view edits Markdown tables cell by cell. Add a table to start.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={async () => {
            const t = await dialogs.table(emptyTable(), true);
            if (!t) return;
            const sep = text && !text.endsWith('\n\n') ? (text.endsWith('\n') ? '\n' : '\n\n') : '';
            editorActions.edit(docId, {
              changes: { from: text.length, insert: `${sep}${serializeTable(t)}\n` },
            });
          }}
        >
          Insert table
        </button>
      </div>
    );
  }

  const src = parts[activeTable]?.rows ?? [];
  const columnNames = Array.from(
    { length: Math.max(1, ...src.map((row) => row.length)) },
    (_, c) => {
      const name = header && src[0]?.[c] ? ` · ${src[0][c]!.replace(/[*~]/g, '')}` : '';
      return `${colLetter(c)}${name}`;
    },
  );
  const groups: SheetCommand[][] = [
    ['undo', 'redo'],
    ['row-above', 'row-below', 'delete-row'],
    ['col-left', 'col-right', 'delete-col'],
    ['sort-asc', 'sort-desc'],
    markdown ? ['autosum', 'fill-down', 'fill-right'] : ['fill-down', 'fill-right'],
    ...(markdown
      ? [
          ['bold', 'italic', 'strike'] as SheetCommand[],
          ['align-left', 'align-center', 'align-right'] as SheetCommand[],
        ]
      : []),
    ['filter', 'freeze-row', 'freeze-col'],
  ];
  const [r1, c1, r2, c2] = selectionRange(selection);
  const firstLoc = locate(r1);
  const lastLoc = locate(r2);
  const alignNow = (firstLoc && tables[firstLoc.t]?.table.align.slice(c1, c2 + 1)) || [];
  /** A header row of a Markdown table: bold, and locked in place. */
  const isHeader = (r: number) => markdown && locate(r)?.r === 0;
  const alignAt = (r: number, c: number) => {
    const loc = locate(r);
    return loc ? tables[loc.t]?.table.align[c] : null;
  };

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onKeyDown}>
      <SheetRibbon
        run={run}
        onAsk={() => setAsking(true)}
        groups={groups}
        pressed={{
          filter: filterOpen,
          'freeze-row': !!freeze.rows,
          'freeze-col': !!freeze.cols,
          'align-left': markdown && alignNow.length > 0 && alignNow.every((a) => a === 'left'),
          'align-center': markdown && alignNow.length > 0 && alignNow.every((a) => a === 'center'),
          'align-right': markdown && alignNow.length > 0 && alignNow.every((a) => a === 'right'),
        }}
        disabled={{
          undo: !docModel.canUndo(docId),
          redo: !docModel.canRedo(docId),
          'row-above': markdown && firstLoc?.r === 0,
          'delete-row': markdown && firstLoc?.r === 0 && lastLoc?.r === 0,
        }}
      >
        {markdown && tables.length > 1 && !stacked && (
          <select
            className="input h-8 w-auto max-w-[220px] shrink-0 py-0 text-caption"
            aria-label="Table"
            value={only}
            onChange={(e) => {
              setTableIndex(Number(e.target.value));
              setSelection({ r: 0, c: 0 });
              setFilters([]);
            }}
          >
            {tables.map((t) => (
              <option key={t.index} value={t.index}>
                {`Table ${t.index + 1}${t.label ? ` · ${t.label}` : ''} (${t.table.rows.length} rows)`}
              </option>
            ))}
          </select>
        )}
        {stacked && (
          <span className="shrink-0 px-2 text-caption text-steel">{tables.length} tables</span>
        )}
        {markdown && tables.length === 1 && (
          <span className="shrink-0 px-2 text-caption text-steel">
            {tables[0]?.label ? `Table under “${tables[0].label}”` : 'Table 1'}
          </span>
        )}
        {!markdown && (
          <label className="flex shrink-0 items-center gap-1.5 px-2 text-caption text-steel">
            <input
              type="checkbox"
              checked={headerRow}
              onChange={(e) => setHeaderRow(e.target.checked)}
            />
            Header row
          </label>
        )}
      </SheetRibbon>
      {filterOpen && (
        <FilterBar
          columns={columnNames}
          filters={filters}
          onChange={(next) => {
            setFilters(next);
            setSelection({ r: 0, c: 0 });
          }}
          shown={rowMap ? rowMap.length - skip : null}
          total={Math.max(0, src.length - skip)}
        />
      )}
      {parts.length > 0 && (
        <div className="min-h-0 flex-1">
          <SheetGrid
            sheet={view}
            label={markdown ? 'Table cells' : `${name} cells`}
            headerRow={markdown ? isHeader : headerRow}
            selection={selection}
            onSelect={setSelection}
            onEdit={onEdit}
            onPaste={onPaste}
            onClear={(r, c) => onEdit(r, c, '')}
            onClearRange={onClearRange}
            onFill={fill}
            onRows={onRows}
            freeze={freeze}
            rowLabels={rowLabels}
            markdownText={markdown}
            fixedHeader={markdown ? isHeader : false}
            // Empty cells all around, like a spreadsheet; typing in one adds it to the table.
            pad={{ rows: rowMap ? 0 : 100, cols: 24 }}
            textOnly
            align={markdown ? alignAt : undefined}
          />
        </div>
      )}
      {asking && (
        <Suspense fallback={null}>
          <SheetAskDialog
            ctx={aonContext().ctx}
            allowed={aonCanSee(docId)}
            canApply
            onApply={(edits) => applyAon(aonContext().t, edits)}
            onClose={() => setAsking(false)}
          />
        </Suspense>
      )}
    </div>
  );
}

/** Row filters: a condition per column, all of which must hold. Nothing is written to the file. */
function FilterBar({
  columns,
  filters,
  onChange,
  shown,
  total,
}: {
  columns: string[];
  filters: Filter[];
  onChange(next: Filter[]): void;
  shown: number | null;
  total: number;
}) {
  const [col, setCol] = useState(0);
  const [op, setOp] = useState<FilterOp>('contains');
  const [value, setValue] = useState('');
  const needsValue = FILTER_OPS.find((o) => o.id === op)!.needsValue;
  const add = () => {
    if (needsValue && !value.trim()) return;
    onChange([...filters, { col, op, value: needsValue ? value : '' }]);
    setValue('');
  };
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline-soft bg-surface-soft px-2 py-1.5 text-caption"
      role="search"
      aria-label="Filter rows"
      data-testid="filter-bar"
    >
      <FilterIcon size={14} className="text-steel" aria-hidden />
      <span className="text-steel">Show rows where</span>
      <select
        className="input h-8 w-auto max-w-[180px] py-0 text-caption"
        aria-label="Filter column"
        value={Math.min(col, columns.length - 1)}
        onChange={(e) => setCol(Number(e.target.value))}
      >
        {columns.map((n, i) => (
          <option key={i} value={i}>
            {n}
          </option>
        ))}
      </select>
      <select
        className="input h-8 w-auto py-0 text-caption"
        aria-label="Filter condition"
        value={op}
        onChange={(e) => setOp(e.target.value as FilterOp)}
      >
        {FILTER_OPS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {needsValue && (
        <input
          className="input h-8 w-36 py-0 text-caption"
          aria-label="Filter value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
      )}
      <button type="button" className="btn btn-secondary h-8" onClick={add}>
        Add filter
      </button>
      {filters.map((f, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-full border border-hairline bg-canvas py-0.5 pl-2.5 pr-1"
        >
          {describeFilter(f, columns[f.col]?.split(' · ')[0] ?? '?')}
          <button
            type="button"
            className="icon-btn size-5"
            aria-label={`Remove filter ${i + 1}`}
            onClick={() => onChange(filters.filter((_, k) => k !== i))}
          >
            <X size={12} />
          </button>
        </span>
      ))}
      {shown !== null && (
        <span className="ml-auto text-steel" aria-live="polite">
          {shown.toLocaleString()} of {total.toLocaleString()} rows
        </span>
      )}
    </div>
  );
}
