import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Plus } from 'lucide-react';
import type { Entry } from '@/domain/types';
import { baseName } from '@/domain/names';
import { ws } from '@/app/app-store';
import { toast, toastError } from '@/app/toast-store';
import { dialogs } from '@/app/dialog-store';
import { convert } from '@/lib/convert/client';
import type { ReportData } from '@/lib/convert/doc-ast';
import { recalculate } from '@/lib/convert/formula';
import { cleanSheetName } from '@/lib/convert/xlsx';
import {
  cloneWorkbook,
  deleteCols,
  deleteRows,
  insertCols,
  insertRows,
  sortRows,
} from '@/lib/convert/sheet-ops';
import { parseInput, setCellRaw, type Workbook } from '@/lib/convert/workbook';
import { SheetGrid, type Selection } from './SheetGrid';
import { SheetRibbon, type SheetCommand } from './SheetRibbon';

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
        setEditable(!out.report.notes.some((n) => n.severity === 'warning'));
        undo.current = [];
        redo.current = [];
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry.id, entry.updatedAt]);

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
      pendingSave.current = prev;
      setSave('saving');
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY);
      return;
    }
    const { r, c } = selection;
    edit((book) => {
      switch (cmd) {
        case 'row-above':
          return insertRows(book, sheetIndex, r);
        case 'row-below':
          insertRows(book, sheetIndex, r + 1);
          setSelection({ r: r + 1, c });
          return;
        case 'delete-row':
          return deleteRows(book, sheetIndex, r);
        case 'col-left':
          return insertCols(book, sheetIndex, c);
        case 'col-right':
          insertCols(book, sheetIndex, c + 1);
          setSelection({ r, c: c + 1 });
          return;
        case 'delete-col':
          return deleteCols(book, sheetIndex, c);
        case 'sort-asc':
        case 'sort-desc': {
          const { ok } = sortRows(book.sheets[sheetIndex]!, c, cmd === 'sort-asc' ? 'asc' : 'desc');
          if (!ok) {
            toast({
              message:
                "Rows with formulas can't be sorted here: their references would point at different cells.",
            });
            return false;
          }
        }
      }
    });
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

  const sheet = wb.sheets[Math.min(sheetIndex, wb.sheets.length - 1)]!;
  const warnings = report?.notes.filter((n) => n.severity === 'warning') ?? [];
  const stale = report?.notes.find((n) => /can't calculate/.test(n.message));

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(e) => {
        const mod = e.metaKey || e.ctrlKey;
        if (!mod || (e.target as HTMLElement).tagName === 'INPUT') return;
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
      {!editable && (
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
        readOnly={!editable}
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
      <div className="min-h-0 flex-1">
        <SheetGrid
          sheet={sheet}
          label={`${sheet.name} cells`}
          readOnly={!editable}
          selection={selection}
          onSelect={setSelection}
          onEdit={(r, c, input) =>
            edit((book) =>
              setCellRaw(
                book.sheets[sheetIndex]!,
                r,
                c,
                parseInput(input, book.sheets[sheetIndex]!.rows[r]?.[c]),
              ),
            )
          }
          onRows={(a) => {
            edit((book) => {
              if (a.kind === 'insert') insertRows(book, sheetIndex, a.at, a.count);
              else deleteRows(book, sheetIndex, a.at, a.count);
            });
            if (a.select !== undefined) setSelection({ r: a.select, c: selection.c });
          }}
          onClear={(r, c) => edit((book) => setCellRaw(book.sheets[sheetIndex]!, r, c, undefined))}
          onPaste={(r, c, block) =>
            edit((book) => {
              const s = book.sheets[sheetIndex]!;
              block.forEach((line, i) =>
                line.forEach((v, j) => setCellRaw(s, r + i, c + j, parseInput(v))),
              );
            })
          }
        />
      </div>
      <div
        className="sheet-tabs flex shrink-0 items-center gap-1 overflow-x-auto border-t border-hairline bg-surface-soft px-2 py-1"
        role="tablist"
        aria-label="Sheets"
      >
        {wb.sheets.map((s, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === sheetIndex}
            className="shrink-0 rounded-md border border-transparent px-3 py-1 text-caption text-steel hover:bg-hover"
            onClick={() => {
              setSheetIndex(i);
              setSelection({ r: 0, c: 0 });
            }}
            onDoubleClick={async () => {
              if (!editable) return;
              const name = await dialogs.prompt({
                title: 'Rename sheet',
                label: 'Sheet name',
                initial: s.name,
              });
              if (!name || name === s.name) return;
              edit((book) => {
                const taken = new Set(
                  book.sheets.filter((_, k) => k !== i).map((x) => x.name.toLowerCase()),
                );
                const clean = cleanSheetName(name, taken);
                const old = book.sheets[i]!.name;
                book.sheets[i]!.name = clean;
                // Formulas that name the sheet follow the rename.
                const quote = (n: string) =>
                  /^[A-Za-z_][\w.]*$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`;
                for (const sh of book.sheets)
                  for (const row of sh.rows)
                    for (const cell of row ?? [])
                      if (cell?.f) cell.f = cell.f.split(`${quote(old)}!`).join(`${quote(clean)}!`);
              });
            }}
            title={editable ? 'Double-click to rename' : undefined}
          >
            {s.name}
          </button>
        ))}
        {editable && (
          <button
            type="button"
            className="icon-btn size-7"
            aria-label="Add sheet"
            title="Add sheet"
            onClick={() =>
              edit((book) => {
                const taken = new Set(book.sheets.map((x) => x.name.toLowerCase()));
                book.sheets.push({
                  name: cleanSheetName(`Sheet${book.sheets.length + 1}`, taken),
                  rows: [],
                });
                setSheetIndex(book.sheets.length - 1);
              })
            }
          >
            <Plus size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
