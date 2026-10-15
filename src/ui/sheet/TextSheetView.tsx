import { useMemo, useState } from 'react';
import { Table2 } from 'lucide-react';
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
import { SheetGrid, type RowAction, type Selection } from './SheetGrid';
import { SheetRibbon, type SheetCommand } from './SheetRibbon';

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

  const write = (rows: string[][]) => {
    if (dialect) {
      applyText(docId, text, rewriteDelimited(text, rows, dialect));
      return;
    }
    if (!table) return;
    const s: Sheet = {
      name: 'Table',
      rows: rows.map((r) => r.map((v) => (v === '' ? undefined : { v }))),
    };
    const t = sheetToTable(s, table.table.align, true);
    const lines = text.split('\n');
    const next = [
      ...lines.slice(0, table.start),
      serializeTable(t),
      ...lines.slice(table.end),
    ].join('\n');
    applyText(docId, text, next);
  };

  const onEdit = (r: number, c: number, input: string) => {
    if (input.startsWith('=')) {
      toast({
        message: markdown
          ? 'Markdown tables hold text, not formulas. Convert the table to an Excel workbook to calculate.'
          : `${ext.toUpperCase()} files hold values, not formulas. Convert to an Excel workbook to calculate.`,
        action: onConvert ? { label: 'Convert…', run: onConvert } : undefined,
      });
      return;
    }
    const value = input; // cells are text, kept exactly as typed
    const rows = rowsOf(sheet!);
    while (rows.length <= r) rows.push([]);
    const row = rows[r]!;
    while (row.length <= c) row.push('');
    row[c] = value;
    write(rows);
  };

  const onPaste = (r: number, c: number, block: string[][]) => {
    const rows = rowsOf(sheet!);
    block.forEach((line, i) =>
      line.forEach((v, j) => {
        while (rows.length <= r + i) rows.push([]);
        const row = rows[r + i]!;
        while (row.length <= c + j) row.push('');
        row[c + j] = v;
      }),
    );
    write(rows);
  };

  const run = (cmd: SheetCommand) => {
    if (cmd === 'undo') return void docModel.undo(docId);
    if (cmd === 'redo') return void docModel.redo(docId);
    if (!sheet) return;
    const rows = rowsOf(sheet);
    const width = Math.max(1, ...rows.map((r) => r.length));
    const { r, c } = selection;
    switch (cmd) {
      case 'row-above':
      case 'row-below': {
        const at = cmd === 'row-above' ? r : r + 1;
        if (markdown && at === 0) return;
        rows.splice(
          Math.min(at, rows.length),
          0,
          Array.from({ length: width }, () => ''),
        );
        setSelection({ r: at, c });
        break;
      }
      case 'delete-row':
        if (r >= rows.length || (markdown && r === 0)) return;
        rows.splice(r, 1);
        setSelection({ r: Math.max(0, Math.min(r, rows.length - 1)), c });
        break;
      case 'col-left':
      case 'col-right': {
        const at = cmd === 'col-left' ? c : c + 1;
        for (const row of rows) {
          while (row.length < at) row.push('');
          row.splice(at, 0, '');
        }
        if (markdown && table) {
          table.table.align.splice(at, 0, null);
        }
        setSelection({ r, c: at });
        break;
      }
      case 'delete-col':
        if (width <= 1) return;
        for (const row of rows) row.splice(c, 1);
        if (markdown && table) table.table.align.splice(c, 1);
        setSelection({ r, c: Math.max(0, Math.min(c, width - 2)) });
        break;
      case 'sort-asc':
      case 'sort-desc': {
        const skip = markdown || headerRow ? 1 : 0;
        const body = rows.slice(skip);
        const dir = cmd === 'sort-asc' ? 1 : -1;
        body.sort((a, b) => {
          const x = a[c] ?? '';
          const y = b[c] ?? '';
          if (!x && !y) return 0;
          if (!x) return 1;
          if (!y) return -1;
          return dir * x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
        });
        rows.splice(skip, body.length, ...body);
        break;
      }
    }
    write(rows);
  };

  const onRows = (a: RowAction) => {
    if (!sheet) return;
    const rows = rowsOf(sheet);
    const width = Math.max(1, ...rows.map((r) => r.length));
    if (a.kind === 'insert') {
      while (rows.length < a.at) rows.push([]);
      rows.splice(
        a.at,
        0,
        ...Array.from({ length: a.count }, () => Array.from({ length: width }, () => '')),
      );
    } else rows.splice(a.at, a.count);
    write(rows);
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

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onKeyDown}>
      <SheetRibbon
        run={run}
        disabled={{
          undo: !docModel.canUndo(docId),
          redo: !docModel.canRedo(docId),
          'row-above': markdown && selection.r === 0,
          'delete-row': markdown && selection.r === 0,
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
      {sheet && (
        <div className="min-h-0 flex-1">
          <SheetGrid
            sheet={sheet}
            label={markdown ? 'Table cells' : `${name} cells`}
            headerRow={markdown || headerRow}
            selection={selection}
            onSelect={setSelection}
            onEdit={onEdit}
            onPaste={onPaste}
            onClear={(r, c) => onEdit(r, c, '')}
            onRows={onRows}
            fixedHeader={markdown}
            pad={markdown ? { rows: 0, cols: 0 } : undefined}
            textOnly
            align={markdown ? table?.table.align : undefined}
          />
        </div>
      )}
    </div>
  );
}
