import { useEffect, useState } from 'react';
import { canPrint } from '@/platform';
import { AlertTriangle, ArrowRight, Download, FilePlus2, Printer } from 'lucide-react';
import type { EntryId } from '@/domain/types';
import { ws } from '@/app/app-store';
import { exportEntry, openEntry } from '@/app/actions';
import { toast, toastError } from '@/app/toast-store';
import {
  exportConversion,
  markdownTables,
  runConversion,
  saveConversion,
  type ConversionResult,
} from '@/app/convert';
import {
  conversionsFrom,
  formatLabel,
  formatOf,
  type Conversion,
  type FormatId,
} from '@/lib/convert/capabilities';
import { convert } from '@/lib/convert/client';
import { Dialog } from '../components/Dialog';
import { SheetGrid } from '../sheet/SheetGrid';
import { StaticMarkdown } from './StaticMarkdown';
import { ReportList } from './ReportList';
import { PdfPreview } from './PdfPreview';

/**
 * Convert (new file in the workspace) or export (a copy outside MyDocs). The preview and
 * the report come from running the real conversion, so what is shown is what is saved.
 */
export function ConvertDialog({
  entryId,
  initial,
  onClose,
}: {
  entryId: EntryId;
  initial?: FormatId;
  onClose(): void;
}) {
  const entry = ws().get(entryId);
  const from = entry ? formatOf(entry.name)?.id : undefined;
  const options = from ? conversionsFrom(from) : [];
  const [to, setTo] = useState<FormatId | undefined>(
    initial && options.some((o) => o.to === initial) ? initial : options[0]?.to,
  );
  const [table, setTable] = useState(0);
  const [sheet, setSheet] = useState(0);
  const [tables, setTables] = useState<{ index: number; label: string; rows: number }[]>([]);
  const [sheets, setSheets] = useState<string[]>([]);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewSheet, setPreviewSheet] = useState(0);
  const option = options.find((o) => o.to === to);

  // Choices that depend on the content: tables in a Markdown file, sheets in a workbook.
  useEffect(() => {
    if (from === 'md')
      void markdownTables(entryId).then((t) =>
        setTables(t.map((x) => ({ index: x.index, label: x.label, rows: x.table.rows.length }))),
      );
    if (from === 'xlsx')
      void ws()
        .readBlob(entryId)
        .then(async (b) =>
          b ? convert('readXlsx', { data: new Uint8Array(await b.arrayBuffer()) }) : null,
        )
        .then((out) => out && setSheets(out.workbook.sheets.map((s) => s.name)))
        .catch(() => undefined);
  }, [entryId, from]);

  useEffect(() => {
    if (!to) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(null);
    setPreviewSheet(0);
    runConversion(entryId, to, { table, sheet })
      .then((r) => !cancelled && setResult(r))
      .catch((e) => {
        if (cancelled) return;
        setResult(null);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [entryId, to, table, sheet]);

  if (!entry || !from) {
    return (
      <Dialog title="Convert" onClose={onClose}>
        <p className="py-4 text-slate">This file type can't be converted.</p>
      </Dialog>
    );
  }

  const canConvert = !!option?.kinds.includes('convert') && !!result && !busy;
  const canExport = !!option?.kinds.includes('export') && !!result && !busy;

  const doConvert = async () => {
    if (!result) return;
    try {
      const created = await saveConversion(result);
      onClose();
      toast({
        message: `Created ${created.name} next to ${entry.name}. The original is unchanged.`,
        action: { label: 'Open', run: () => void openEntry(created.id) },
      });
      void openEntry(created.id);
    } catch (e) {
      toastError('Unable to create the converted file.', e);
    }
  };

  const doExport = async () => {
    if (!result) return;
    try {
      if (await exportConversion(result)) onClose();
    } catch (e) {
      toastError('Unable to export.', e);
    }
  };

  return (
    <Dialog
      title={`Convert or export ${entry.name}`}
      description={`From ${formatLabel(from)}. Converting creates a new file next to the original; exporting saves a copy outside MyDocs. The original is never changed.`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          {to === 'pdf' && from === 'md' && canPrint && (
            <button
              type="button"
              className="btn btn-secondary mr-auto"
              title="Opens your system's print dialog with the reading view. Choose “Save as PDF”. Keeps every script, emoji, equation and diagram."
              onClick={() => {
                onClose();
                void exportEntry(entryId, 'print');
              }}
            >
              <Printer size={15} aria-hidden /> Print instead…
            </button>
          )}
          {option?.kinds.includes('export') && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!canExport}
              onClick={() => void doExport()}
            >
              <Download size={15} aria-hidden /> Export
            </button>
          )}
          {option?.kinds.includes('convert') && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canConvert}
              onClick={() => void doConvert()}
            >
              <FilePlus2 size={15} aria-hidden /> Create {result?.name ?? 'file'}
            </button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-1 md:flex-row">
        <div
          className="flex shrink-0 flex-col gap-1 md:w-52"
          role="radiogroup"
          aria-label="Convert to"
        >
          {options.map((o) => (
            <TargetButton key={o.to} option={o} active={o.to === to} onSelect={() => setTo(o.to)} />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {to === 'csv' && from === 'md' && tables.length > 1 && (
            <label className="flex items-center gap-2 text-caption text-steel">
              Table
              <select
                className="input h-8 w-auto py-0"
                value={table}
                onChange={(e) => setTable(Number(e.target.value))}
              >
                {tables.map((t) => (
                  <option key={t.index} value={t.index}>
                    {`Table ${t.index + 1}${t.label ? ` · ${t.label}` : ''} (${t.rows} rows)`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(to === 'csv' || to === 'tsv') && from === 'xlsx' && sheets.length > 1 && (
            <label className="flex items-center gap-2 text-caption text-steel">
              Sheet
              <select
                className="input h-8 w-auto py-0"
                value={sheet}
                onChange={(e) => setSheet(Number(e.target.value))}
              >
                {sheets.map((s, i) => (
                  <option key={s} value={i}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}
          {error && (
            <p
              className="flex items-start gap-2 rounded-md bg-danger-soft p-3 text-caption text-charcoal"
              role="alert"
            >
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-danger" aria-hidden />{' '}
              {error}
            </p>
          )}
          {busy && <div className="skeleton h-48" aria-busy="true" aria-label="Converting" />}
          {result && !busy && (
            <>
              <div className="text-caption">
                <p className="font-medium text-ink">What this conversion does</p>
                <ReportList report={result.report} showKept />
              </div>
              <div>
                <p className="mb-1 text-caption font-medium text-ink">
                  Preview{' '}
                  {result.to === 'docx'
                    ? '(the Word file, read back)'
                    : result.to === 'pdf'
                      ? '(the PDF file)'
                      : ''}
                </p>
                <div
                  className="max-h-[42vh] overflow-auto rounded-md border border-hairline bg-canvas"
                  data-testid="conversion-preview"
                >
                  {result.preview.kind === 'markdown' && (
                    <div className="px-5 py-4 text-[14px]">
                      <StaticMarkdown
                        text={result.preview.text}
                        media={result.preview.media}
                        className="[--prose-size:14px]"
                      />
                    </div>
                  )}
                  {result.preview.kind === 'pdf' && <PdfPreview blob={result.blob} />}
                  {result.preview.kind === 'text' && (
                    <pre className="p-4 font-mono text-[12.5px] whitespace-pre-wrap text-charcoal">
                      {result.preview.text}
                    </pre>
                  )}
                  {result.preview.kind === 'sheet' && (
                    <div className="flex h-[38vh] flex-col">
                      {result.preview.workbook.sheets.length > 1 && (
                        <div
                          className="sheet-tabs flex gap-1 border-b border-hairline bg-surface-soft px-2 py-1"
                          role="tablist"
                        >
                          {result.preview.workbook.sheets.map((s, i) => (
                            <button
                              key={i}
                              type="button"
                              role="tab"
                              aria-selected={i === previewSheet}
                              className="rounded-md border border-transparent px-2 py-0.5 text-caption text-steel"
                              onClick={() => setPreviewSheet(i)}
                            >
                              {s.name}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="min-h-0 flex-1">
                        <SheetGrid
                          sheet={
                            result.preview.workbook.sheets[previewSheet] ??
                            result.preview.workbook.sheets[0]!
                          }
                          readOnly
                          headerRow
                          label="Preview"
                          selection={{ r: 0, c: 0 }}
                          onSelect={() => undefined}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
          {option && !busy && (
            <details className="text-caption text-steel">
              <summary className="cursor-pointer">
                Everything {formatLabel(option.from)} → {formatLabel(option.to)} keeps and loses
              </summary>
              <p className="mt-2 font-medium text-charcoal">Keeps</p>
              <ul className="ml-4 list-disc">
                {option.keeps.map((k) => (
                  <li key={k}>{k}</li>
                ))}
              </ul>
              <p className="mt-2 font-medium text-charcoal">Loses</p>
              <ul className="ml-4 list-disc">
                {option.loses.length ? (
                  option.loses.map((k) => <li key={k}>{k}</li>)
                ) : (
                  <li>Nothing</li>
                )}
              </ul>
            </details>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function TargetButton({
  option,
  active,
  onSelect,
}: {
  option: Conversion;
  active: boolean;
  onSelect(): void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      className="menu-item flex-col !items-start !gap-0"
      data-active={active}
      onClick={onSelect}
    >
      <span className="flex items-center gap-1 text-ink">
        <ArrowRight size={13} className="text-stone" aria-hidden /> {formatLabel(option.to)}
      </span>
      <span className="text-xs text-steel">
        {option.kinds.map((k) => (k === 'convert' ? 'New file' : 'Export')).join(' · ')}
        {option.scope === 'table'
          ? ' · one table'
          : option.scope === 'sheet'
            ? ' · one sheet'
            : option.scope === 'all-tables'
              ? ' · all tables'
              : ''}
      </span>
    </button>
  );
}
