import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Entry } from '@/domain/types';
import { baseName } from '@/domain/names';
import { ws } from '@/app/app-store';
import { toast, toastError } from '@/app/toast-store';
import { dialogs } from '@/app/dialog-store';
import { externalSaves } from '@/app/external-saves';
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
import { setCellRaw, type Workbook } from '@/lib/convert/workbook';
import { SheetGrid, type Selection } from './SheetGrid';
import { SheetRibbon, type SheetCommand } from './SheetRibbon';
import { publishOutline } from '@/app/outline-store';
import { openMenu, openMenuAt, type MenuEntry } from '../components/Menu';
import {
  deleteSheet,
  duplicateSheet,
  formatCell,
  NUMBER_FORMATS,
  parseCellInput,
  renameSheet,
} from './workbook-controls';

type SaveState = 'saved' | 'saving' | 'error';
const SAVE_DELAY = 700;

/**
 * An Excel workbook in the sheet view. Opening never changes the file. Editing is a
 * deliberate step when the workbook has features MyDocs can't write back (styling,
 * charts, merged cells); every save keeps the previous file as a version.
 */
export function XlsxView({ entry, onConvert }: { entry: Entry; onConvert(): void }) {
  return <WorkbookEditor key={entry.id} entry={entry} onConvert={onConvert} />;
}

function WorkbookEditor({ entry, onConvert }: { entry: Entry; onConvert(): void }) {
  // Keep writes attached to the workspace that opened this workbook, including on leave.
  const [workspace] = useState(ws);
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
  const saveTask = useRef<Promise<void> | null>(null);
  const latestWb = useRef<Workbook | null>(null);
  const [hasRecovery] = useState(() => !!externalSaves.snapshot<Workbook>(entry.id));
  const recoveryChecked = useRef(false);

  // Load (and reload when the file changes from elsewhere, e.g. a version restore).
  useEffect(() => {
    // Our own saves change updatedAt too; only reload for changes from elsewhere.
    if (entry.updatedAt === savedAt.current || saving.current) return;
    let cancelled = false;
    setError(null);
    void (async () => {
      try {
        if (hasRecovery && !recoveryChecked.current) {
          // Finish any detached writer before a reopened view can issue new writes.
          await externalSaves.flush([entry.id]);
          if (cancelled) return;
          recoveryChecked.current = true;
          const draft = externalSaves.snapshot<Workbook>(entry.id);
          if (draft) {
            latestWb.current = draft;
            pendingSave.current = draft;
            setWb(draft);
            setEditable(true);
            setSave('error');
            return;
          }
        }
        const blob = await workspace.readBlob(entry.id);
        if (!blob) throw new Error('The file could not be read.');
        const out = await convert('readXlsx', { data: new Uint8Array(await blob.arrayBuffer()) });
        if (cancelled) return;
        latestWb.current = out.workbook;
        setWb(out.workbook);
        setSheetIndex(0);
        setSelection({ r: 0, c: 0 });
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
  }, [entry.id, entry.updatedAt, workspace, hasRecovery]);

  const serialize = useCallback(
    async (book: Workbook): Promise<Blob> => {
      const out = await convert('writeXlsx', { workbook: book, title: baseName(entry.name) });
      return new Blob([out.data as BlobPart], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    },
    [entry.name],
  );

  const flush = useCallback((): Promise<void> => {
    clearTimeout(timer.current);
    if (saveTask.current) return saveTask.current;
    if (!pendingSave.current) return Promise.resolve();
    const task = (async () => {
      saving.current = true;
      try {
        // New edits made during conversion are saved next; older writes never overtake them.
        while (pendingSave.current) {
          const book = pendingSave.current;
          pendingSave.current = null;
          setSave('saving');
          try {
            const saved = await workspace.saveBlob(entry.id, await serialize(book));
            savedAt.current = saved.updatedAt;
          } catch (e) {
            pendingSave.current ??= book;
            setSave('error');
            toastError('Unable to save the workbook.', e, {
              label: 'Retry',
              run: () => void flush(),
            });
            return;
          }
        }
        setSave('saved');
      } finally {
        saving.current = false;
      }
    })();
    saveTask.current = task;
    void task.finally(() => {
      if (saveTask.current === task) saveTask.current = null;
    });
    return task;
  }, [entry.id, serialize, workspace]);

  const loaded = wb !== null;
  useEffect(() => {
    if (!loaded) return;
    return externalSaves.register(entry.id, {
      flush,
      hasUnsaved: () => !!pendingSave.current || saving.current,
      snapshot: () => latestWb.current,
      exportBlob: async () => {
        const book = latestWb.current;
        if (!book) throw new Error('The current workbook could not be read for export.');
        return serialize(book);
      },
    });
  }, [entry.id, flush, loaded, serialize]);

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

  const commit = (next: Workbook) => {
    if (!wb) return;
    undo.current.push(wb);
    if (undo.current.length > 100) undo.current.shift();
    redo.current = [];
    recalculate(next);
    latestWb.current = next;
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
      latestWb.current = prev;
      setWb(prev);
      setSheetIndex(Math.min(sheetIndex, prev.sheets.length - 1));
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

  const rename = async (index: number) => {
    if (!wb || !editable) return;
    const current = wb.sheets[index]!;
    const name = await dialogs.prompt({
      title: 'Rename sheet',
      label: 'Sheet name',
      initial: current.name,
      validate: (v) => {
        if (!v.trim()) return 'Enter a sheet name.';
        if (v.trim().length > 31) return 'Use 31 characters or fewer.';
        if (/[\\/?*[\]:]/.test(v)) return 'Sheet names cannot contain \\ / ? * [ ] or :.';
        if (
          wb.sheets.some((s, i) => i !== index && s.name.toLowerCase() === v.trim().toLowerCase())
        )
          return 'A sheet with this name already exists.';
        return null;
      },
    });
    if (name && name.trim() !== current.name)
      edit((book) => void renameSheet(book, index, name.trim()));
  };

  const sheetMenu = (index: number): MenuEntry[] => [
    { label: 'Rename sheet…', icon: <Pencil />, onSelect: () => void rename(index) },
    {
      label: 'Duplicate sheet',
      icon: <Copy />,
      onSelect: () =>
        edit((book) => {
          setSheetIndex(duplicateSheet(book, index));
          setSelection({ r: 0, c: 0 });
        }),
    },
    'separator',
    {
      label: 'Delete sheet…',
      icon: <Trash2 />,
      danger: true,
      disabled: !wb || wb.sheets.length <= 1,
      onSelect: async () => {
        if (!wb || wb.sheets.length <= 1) return;
        const ok = await dialogs.confirm({
          title: 'Delete sheet?',
          message: `Delete “${wb.sheets[index]!.name}” and its contents? Formulas referring to this sheet will show #REF!. You can undo this change.`,
          confirmLabel: 'Delete sheet',
          cancelLabel: 'Keep sheet',
          danger: true,
        });
        if (!ok) return;
        edit((book) => {
          deleteSheet(book, index);
          setSheetIndex(
            Math.max(
              0,
              Math.min(index < sheetIndex ? sheetIndex - 1 : sheetIndex, book.sheets.length - 1),
            ),
          );
          setSelection({ r: 0, c: 0 });
        });
      },
    },
  ];

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
  const activeFormat = sheet.rows[selection.r]?.[selection.c]?.fmt ?? '';

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
        {editable && (
          <select
            aria-label="Number format for selected cell"
            title="Number format for selected cell"
            className="input h-8 w-32 shrink-0 py-0 text-caption"
            value={activeFormat}
            onChange={(e) => {
              const code = e.target.value;
              edit((book) => {
                const s = book.sheets[sheetIndex]!;
                setCellRaw(
                  s,
                  selection.r,
                  selection.c,
                  formatCell(s.rows[selection.r]?.[selection.c], code),
                );
              });
            }}
          >
            {NUMBER_FORMATS.map((f) => (
              <option key={f.code} value={f.code}>
                {f.label}
              </option>
            ))}
            {!NUMBER_FORMATS.some((f) => f.code === activeFormat) && (
              <option value={activeFormat}>Custom format</option>
            )}
          </select>
        )}
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
        {save === 'error' && (
          <button
            type="button"
            className="btn btn-secondary h-8 shrink-0"
            onClick={() => void flush()}
          >
            Retry save
          </button>
        )}
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
          key={sheetIndex}
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
                parseCellInput(input, book.sheets[sheetIndex]!.rows[r]?.[c]),
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
          onClear={(r, c) =>
            edit((book) => {
              const s = book.sheets[sheetIndex]!;
              setCellRaw(s, r, c, parseCellInput('', s.rows[r]?.[c]));
            })
          }
          onClearRange={(from, to) =>
            edit((book) => {
              const s = book.sheets[sheetIndex]!;
              for (let r = from.r; r <= Math.min(to.r, s.rows.length - 1); r++)
                for (let c = from.c; c <= Math.min(to.c, (s.rows[r]?.length ?? 0) - 1); c++)
                  setCellRaw(s, r, c, parseCellInput('', s.rows[r]?.[c]));
            })
          }
          onResizeColumn={(c, width) =>
            edit((book) => {
              const s = book.sheets[sheetIndex]!;
              (s.widths ??= [])[c] = width / 7.5;
            })
          }
          onPaste={(r, c, block) =>
            edit((book) => {
              const s = book.sheets[sheetIndex]!;
              block.forEach((line, i) =>
                line.forEach((v, j) =>
                  setCellRaw(s, r + i, c + j, parseCellInput(v, s.rows[r + i]?.[c + j])),
                ),
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
          <div key={i} role="presentation" className="flex shrink-0 items-center">
            <button
              type="button"
              role="tab"
              aria-selected={i === sheetIndex}
              tabIndex={i === sheetIndex ? 0 : -1}
              className="shrink-0 rounded-l-md border border-transparent px-3 py-1.5 text-caption text-steel hover:bg-hover"
              onClick={() => {
                setSheetIndex(i);
                setSelection({ r: 0, c: 0 });
              }}
              onKeyDown={(e) => {
                const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
                if (!keys.includes(e.key)) return;
                e.preventDefault();
                const next =
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? wb.sheets.length - 1
                      : (i + (e.key === 'ArrowRight' ? 1 : -1) + wb.sheets.length) %
                        wb.sheets.length;
                setSheetIndex(next);
                setSelection({ r: 0, c: 0 });
                const tabs = e.currentTarget
                  .closest('[role="tablist"]')
                  ?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                tabs?.[next]?.focus();
              }}
              onDoubleClick={() => void rename(i)}
              onContextMenu={(e) => {
                if (!editable) return;
                e.preventDefault();
                openMenu({
                  items: sheetMenu(i),
                  at: { x: e.clientX, y: e.clientY },
                  label: s.name,
                  returnFocus: e.currentTarget,
                });
              }}
            >
              {s.name}
            </button>
            {editable && (
              <button
                type="button"
                className="icon-btn size-8 rounded-l-none"
                aria-label={`Sheet options for ${s.name}`}
                aria-haspopup="menu"
                onClick={(e) => openMenuAt(e.currentTarget, sheetMenu(i), s.name)}
              >
                <ChevronDown size={13} aria-hidden />
              </button>
            )}
          </div>
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
                setSelection({ r: 0, c: 0 });
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
