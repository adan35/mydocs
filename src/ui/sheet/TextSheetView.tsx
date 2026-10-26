import { useEffect, useMemo, useState } from 'react';
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
} from '@/lib/convert/table-sheet';
import { SheetGrid, selectionRange, type RowAction, type Selection } from './SheetGrid';
import { SheetRibbon, type SheetCommand } from './SheetRibbon';
import { publishOutline } from '@/app/outline-store';

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

/**
 * Edits CSV/TSV/UNL files and Markdown tables as a grid. Every change is written back to the
 * text as one transaction on the document model: only the edited row (CSV) or the
 * edited table (Markdown) changes, and undo works across the grid and the source.
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
  const [tableIndex, setTableIndex] = useState(0);
  const [selection, setSelection] = useState<Selection>({ r: 0, c: 0 });
  // UNL exports have no header row; their columns are named A, B, C…
  const [headerRow, setHeaderRow] = useState(ext !== 'unl');

  const dialect = useMemo(
    () => (markdown ? null : detectDialect(text, ext)),
    [markdown, text, ext],
  );
  const tables = useMemo(() => (markdown ? findMarkdownTables(text) : []), [markdown, text]);
  const table = tables[Math.min(tableIndex, tables.length - 1)];
  const sheet = useMemo<Sheet | null>(() => {
    if (dialect) return delimitedToSheet(text, dialect).sheet;
    return table ? tableToSheet(table.table) : null;
  }, [dialect, text, table]);

  // Outline: the document's tables (Markdown), or the file's columns (CSV and the like).
  const activeTable = Math.min(tableIndex, tables.length - 1);
  const header = headerRow || markdown;
  useEffect(() => {
    if (markdown) {
      publishOutline(docId, {
        items: tables.map((t) => ({
          key: `${t.index}`,
          level: 1,
          text: t.label ? t.label : `Table ${t.index + 1}`,
          badge: `T${t.index + 1}`,
          detail: `${Math.max(0, t.table.rows.length - 1)} rows`,
        })),
        active: activeTable,
        noun: 'tables',
        empty: 'This document has no tables.',
        jump: (i) => {
          setTableIndex(i);
          setSelection({ r: 0, c: 0 });
        },
      });
      return;
    }
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
  }, [markdown, tables, activeTable, sheet, header, selection.c, docId]);
  useEffect(() => () => publishOutline(docId, null), [docId]);

  // The file's cell text, and the table as it shows (formulas calculated).
  const src = useMemo(() => (sheet ? rowsOf(sheet) : []), [sheet]);
  const shown = useMemo(() => evaluateRows(src, markdown), [src, markdown]);
  const skip = header ? 1 : 0;
  const [filters, setFilters] = useState<Filter[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [freeze, setFreeze] = useState({ rows: 0, cols: 0 });
  const rowMap = useMemo(
    () => (filters.length ? filterRows(shown, filters, skip) : null),
    [filters, shown, skip],
  );
  const view = useMemo<Sheet>(
    () => (rowMap ? { ...shown, rows: rowMap.map((i) => shown.rows[i]!) } : shown),
    [rowMap, shown],
  );
  const mapRow = (r: number) => (rowMap ? (rowMap[r] ?? r) : r);
  const resetFilters = () => {
    setFilters([]);
    setSelection({ r: 0, c: 0 });
  };
  /** Changes that move or add rows would act on hidden rows too; ask to clear the filter first. */
  const blockedByFilter = () => {
    if (!rowMap) return false;
    toast({ message: 'Clear the filter first: this would also change the rows it hides.' });
    return true;
  };

  const write = (rows: string[][], align = table?.table.align) => {
    if (dialect) {
      applyText(docId, text, rewriteDelimited(text, rows, dialect));
      return;
    }
    if (!table) return;
    const s: Sheet = {
      name: 'Table',
      rows: rows.map((r) => r.map((v) => (v === '' ? undefined : { v }))),
    };
    const t = sheetToTable(s, align ?? table.table.align, true);
    const lines = text.split('\n');
    const next = [
      ...lines.slice(0, table.start),
      serializeTable(t),
      ...lines.slice(table.end),
    ].join('\n');
    applyText(docId, text, next);
  };

  const onEdit = (r: number, c: number, input: string) => {
    if (!markdown && input.startsWith('=')) {
      toast({
        message: `${ext.toUpperCase()} files hold values, not formulas. Convert to an Excel workbook to calculate.`,
        action: onConvert ? { label: 'Convert…', run: onConvert } : undefined,
      });
      return;
    }
    // Cells are text, kept exactly as typed; a Markdown cell starting with "=" is a formula.
    write(setCellText(src, mapRow(r), c, input));
  };

  const onPaste = (r: number, c: number, block: string[][]) => {
    if (blockedByFilter()) return;
    write(setBlock(src, r, c, block));
  };

  const onClearRange = ([r1, c1, r2, c2]: [number, number, number, number]) => {
    const out = src.map((row) => [...row]);
    for (let r = r1; r <= r2; r++)
      for (let c = c1; c <= c2; c++) {
        const row = out[mapRow(r)];
        if (row && row[c] !== undefined) row[c] = '';
      }
    write(out);
  };

  const fill = (dir: 'down' | 'right') => {
    if (blockedByFilter()) return;
    const out = fillRange(src, selectionRange(selection), dir);
    if (out) write(out);
    else toast({ message: `Nothing to fill ${dir === 'down' ? 'down' : 'right'} from.` });
  };

  const run = (cmd: SheetCommand) => {
    if (cmd === 'undo') return void docModel.undo(docId);
    if (cmd === 'redo') return void docModel.redo(docId);
    if (cmd === 'filter') {
      if (filterOpen) resetFilters();
      setFilterOpen(!filterOpen);
      return;
    }
    if (cmd === 'freeze-row') return void setFreeze((f) => ({ ...f, rows: f.rows ? 0 : 1 }));
    if (cmd === 'freeze-col') return void setFreeze((f) => ({ ...f, cols: f.cols ? 0 : 1 }));
    if (!sheet) return;
    const [r1, c1, r2, c2] = selectionRange(selection);
    const { r, c } = selection;
    const width = Math.max(1, ...src.map((row) => row.length));
    const align = table ? [...table.table.align] : [];
    while (align.length < width) align.push(null);
    switch (cmd) {
      case 'row-above':
      case 'row-below': {
        if (blockedByFilter()) return;
        const count = r2 - r1 + 1;
        const at = cmd === 'row-above' ? r1 : r2 + 1;
        if (markdown && at === 0) return;
        write(insertRowsAt(src, Math.min(at, src.length), count));
        setSelection({ r: at, c });
        return;
      }
      case 'delete-row': {
        if (blockedByFilter()) return;
        const first = markdown ? Math.max(1, r1) : r1; // a Markdown table keeps its header
        const last = Math.min(r2, src.length - 1);
        if (last < first) return;
        write(deleteRowsAt(src, first, last - first + 1));
        setSelection({ r: Math.max(0, Math.min(first, src.length - (last - first + 1) - 1)), c });
        return;
      }
      case 'col-left':
      case 'col-right': {
        const count = c2 - c1 + 1;
        const at = cmd === 'col-left' ? c1 : c2 + 1;
        align.splice(at, 0, ...Array.from({ length: count }, () => null));
        write(insertColsAt(src, at, count), align);
        setSelection({ r, c: at });
        return;
      }
      case 'delete-col': {
        const count = Math.min(c2 - c1 + 1, width - 1);
        if (count < 1) return;
        align.splice(c1, count);
        write(deleteColsAt(src, c1, count), align);
        setSelection({ r, c: Math.max(0, Math.min(c1, width - count - 1)) });
        return;
      }
      case 'sort-asc':
      case 'sort-desc':
        if (blockedByFilter()) return;
        write(sortRows(src, shown, c, cmd === 'sort-asc' ? 'asc' : 'desc', skip));
        return;
      case 'autosum': {
        if (blockedByFilter()) return;
        const out = autoSum(src, shown, [r1, c1, r2, c2]);
        if (!out) {
          toast({
            message: 'Select the numbers to add up, or an empty cell under or beside them.',
          });
          return;
        }
        write(out.rows);
        setSelection(out.at);
        return;
      }
      case 'fill-down':
        return fill('down');
      case 'fill-right':
        return fill('right');
      case 'bold':
      case 'italic':
      case 'strike':
        if (blockedByFilter()) return;
        write(toggleEmphasis(src, [r1, c1, r2, c2], cmd));
        return;
      case 'align-left':
      case 'align-center':
      case 'align-right': {
        const to = cmd.slice(6) as 'left' | 'center' | 'right';
        const all = align.slice(c1, c2 + 1).every((a) => a === to);
        for (let k = c1; k <= c2; k++) align[k] = all ? null : to;
        write(src, align);
        return;
      }
    }
  };

  const onRows = (a: RowAction) => {
    if (!sheet || blockedByFilter()) return;
    write(
      a.kind === 'insert' ? insertRowsAt(src, a.at, a.count) : deleteRowsAt(src, a.at, a.count),
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
  const alignNow = table?.table.align.slice(c1, c2 + 1) ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onKeyDown}>
      <SheetRibbon
        run={run}
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
          'row-above': markdown && r1 === 0,
          'delete-row': markdown && r1 === 0 && r2 === 0,
        }}
      >
        {markdown && tables.length > 1 && (
          <select
            className="input h-8 w-auto max-w-[220px] shrink-0 py-0 text-caption"
            aria-label="Table"
            value={Math.min(tableIndex, tables.length - 1)}
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
        {markdown && tables.length === 1 && (
          <span className="shrink-0 px-2 text-caption text-steel">
            {table?.label ? `Table under “${table.label}”` : 'Table 1'}
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
      {sheet && (
        <div className="min-h-0 flex-1">
          <SheetGrid
            sheet={view}
            label={markdown ? 'Table cells' : `${name} cells`}
            headerRow={markdown || headerRow}
            selection={selection}
            onSelect={setSelection}
            onEdit={onEdit}
            onPaste={onPaste}
            onClear={(r, c) => onEdit(r, c, '')}
            onClearRange={onClearRange}
            onFill={fill}
            onRows={onRows}
            freeze={freeze}
            rowLabels={rowMap ? rowMap.map((i) => i + 1) : undefined}
            markdownText={markdown}
            fixedHeader={markdown}
            pad={markdown || rowMap ? { rows: 0, cols: 0 } : undefined}
            textOnly
            align={markdown ? table?.table.align : undefined}
          />
        </div>
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
