/**
 * Conversions and exports between formats, as the app runs them.
 *
 * `runConversion` produces the output and a report without touching the workspace;
 * the dialog previews exactly that output. `saveConversion` then creates new files next
 * to the original (never replacing it), and `exportConversion` hands the output to the
 * platform's save/share flow.
 */
import type { Entry, EntryId } from '@/domain/types';
import { baseName, extensionOf, isMarkdownName } from '@/domain/names';
import {
  encodeHrefPath,
  isExternalHref,
  relativePath,
  resolvePath,
  safeDecode,
} from '@/domain/paths';
import { ConversionReport, walkBlocks, type Inline, type ReportData } from '@/lib/convert/doc-ast';
import { convert } from '@/lib/convert/client';
import { formatOf, type FormatId } from '@/lib/convert/capabilities';
import { MEDIA_SRC } from '@/lib/convert/docx';
import { astToMarkdown, markdownToAst, WIKI_IMAGE } from '@/lib/convert/markdown';
import { htmlToAst, textToAst } from '@/lib/convert/html';
import {
  delimitedToSheet,
  detectDialect,
  findMarkdownTables,
  sheetToDelimited,
  tableToSheet,
  typeTextCells,
  type Dialect,
} from '@/lib/convert/delimited';
import { serializeTable } from '@/domain/table';
import { sheetToTable } from '@/lib/convert/delimited';
import { textValue, type Sheet, type Workbook } from '@/lib/convert/workbook';
import { ws } from './app-store';
import { editorActions } from './editor-store';
import { ATTACHMENTS_FOLDER } from './attachments';
import { documentHtml, downloadBlob } from './exporter';
import { markdownToPlainText } from './search';
import { resolveWikiLink } from './workspace';

export type Preview =
  | { kind: 'markdown'; text: string; media?: Record<string, Blob> }
  | { kind: 'sheet'; workbook: Workbook }
  | { kind: 'text'; text: string }
  /** The PDF itself; the dialog shows its pages. */
  | { kind: 'pdf' }
  | { kind: 'none'; message: string };

export interface ConversionResult {
  source: EntryId;
  from: FormatId;
  to: FormatId;
  /** File name for the output (made unique when saved). */
  name: string;
  blob: Blob;
  /** Images extracted from a Word document, saved next to the new Markdown file. */
  media?: { name: string; blob: Blob }[];
  preview: Preview;
  report: ReportData;
}

export interface ConversionOptions {
  /** Markdown source: which table (for CSV). */
  table?: number;
  /** Spreadsheet source: which sheet (for CSV/TSV). */
  sheet?: number;
}

const MIME: Record<FormatId, string> = {
  md: 'text/markdown;charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv;charset=utf-8',
  tsv: 'text/tab-separated-values;charset=utf-8',
  html: 'text/html;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
  pdf: 'application/pdf',
};

/** US-style paper where that's the norm, A4 elsewhere. */
const pageSize = (): 'a4' | 'letter' =>
  /^(en-(US|CA|PH)|es-(MX|US))\b/i.test(typeof navigator === 'undefined' ? '' : navigator.language)
    ? 'letter'
    : 'a4';

const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
const blobOf = (data: Uint8Array | string, to: FormatId) =>
  new Blob([data as BlobPart], { type: MIME[to] });

/** The current text of a text document, including unsaved edits. */
async function currentText(id: EntryId): Promise<string> {
  return editorActions.textOf(id) ?? (await ws().readText(id));
}

/** Reads image bytes for every image a Markdown document references inside the workspace. */
async function workspaceImages(
  docId: EntryId,
  markdown: string,
): Promise<Record<string, Uint8Array>> {
  const tree = ws().tree;
  const dir = tree.dirOf(docId);
  const srcs = new Set<string>();
  const visit = (inl: Inline[]) => {
    for (const i of inl) {
      if (i.type === 'image') srcs.add(i.src);
      if (i.type === 'link') visit(i.children);
    }
  };
  walkBlocks(markdownToAst(markdown).blocks, (b) => {
    if (b.type === 'paragraph' || b.type === 'heading') visit(b.inlines);
    if (b.type === 'table')
      for (const r of [b.header, ...b.rows]) for (const c of r) visit(c.inlines);
  });
  const out: Record<string, Uint8Array> = {};
  for (const src of srcs) {
    if (isExternalHref(src) || src.startsWith('data:')) continue;
    const target = src.startsWith(WIKI_IMAGE)
      ? resolveWikiLink(tree, src.slice(WIKI_IMAGE.length))
      : (() => {
          const path = resolvePath(dir, safeDecode(src.split('#')[0]!.split('?')[0]!));
          return path !== null ? tree.findByPath(path) : undefined;
        })();
    if (!target) continue;
    const blob = await ws().readBlob(target.id);
    if (blob) out[src] = await bytes(blob);
  }
  return out;
}

function markdownTablesWorkbook(markdown: string, report: ConversionReport): Workbook {
  const tables = findMarkdownTables(markdown);
  const taken = new Set<string>();
  const sheets: Sheet[] = tables.map((t, i) => {
    let name = (t.label || `Table ${i + 1}`).slice(0, 31);
    for (let k = 2; taken.has(name.toLowerCase()); k++) name = `${name.slice(0, 27)} (${k})`;
    taken.add(name.toLowerCase());
    return typeTextCells(tableToSheet(t.table, name));
  });
  report.keep('tables', tables.length);
  return { sheets };
}

function workbookMarkdown(wb: Workbook, report: ConversionReport): string {
  const parts: string[] = [];
  let formulas = 0;
  for (const s of wb.sheets) {
    for (const r of s.rows) for (const c of r ?? []) if (c?.f !== undefined) formulas++;
    const text: Sheet = {
      name: s.name,
      rows: s.rows.map((r) => (r ?? []).map((c) => (c ? { v: textValue(c) } : undefined))),
    };
    const table = sheetToTable(text, []);
    parts.push(`## ${s.name}\n\n${serializeTable(table)}`);
  }
  if (formulas) report.note(`${formulas} formulas were saved as their values.`);
  report.keep('sheets', wb.sheets.length);
  return `${parts.join('\n\n')}\n`;
}

/** Runs one conversion and returns its output, preview and report. Nothing is saved. */
export async function runConversion(
  id: EntryId,
  to: FormatId,
  opts: ConversionOptions = {},
): Promise<ConversionResult> {
  await editorActions.flush(id);
  const entry = ws().get(id);
  if (!entry) throw new Error('The file no longer exists.');
  const from = formatOf(entry.name)?.id;
  if (!from) throw new Error(`MyDocs can't convert .${extensionOf(entry.name)} files.`);
  const base = baseName(entry.name);
  const report = new ConversionReport();
  const result = (
    blob: Blob,
    preview: Preview,
    r: ReportData = report.toJSON(),
    name = `${base}.${to}`,
  ): ConversionResult => ({ source: id, from, to, name, blob, preview, report: r });

  // ---------------------------------------------------------------- Markdown sources
  if (from === 'md') {
    const md = await currentText(id);
    if (to === 'docx') {
      const out = await convert('markdownToDocx', {
        markdown: md,
        images: await workspaceImages(id, md),
        title: base,
      });
      // The preview is the Word file read back: what Word will show, not what we hoped.
      const back = await convert('docxToMarkdown', { data: out.data.slice() });
      return result(
        blobOf(out.data, 'docx'),
        { kind: 'markdown', text: back.markdown, media: mediaBlobs(back.media) },
        out.report,
      );
    }
    if (to === 'pdf') {
      const out = await convert('markdownToPdf', {
        markdown: md,
        images: await workspaceImages(id, md),
        title: base,
        pageSize: pageSize(),
      });
      return result(blobOf(out.data, 'pdf'), { kind: 'pdf' }, out.report);
    }
    if (to === 'html') {
      const html = await exportableHtml(id, base, md);
      return result(blobOf(html, 'html'), { kind: 'markdown', text: md });
    }
    if (to === 'txt') {
      const text = markdownToPlainText(md);
      report.note(
        'All formatting, link destinations and images are left out of plain text.',
        'info',
      );
      return result(blobOf(text, 'txt'), { kind: 'text', text });
    }
    if (to === 'xlsx') {
      const wb = markdownTablesWorkbook(md, report);
      if (!wb.sheets.length)
        throw new Error('This document has no tables to put in a spreadsheet.');
      const out = await convert('writeXlsx', { workbook: wb, title: base });
      return result(
        blobOf(out.data, 'xlsx'),
        { kind: 'sheet', workbook: wb },
        merge(report, out.report),
      );
    }
    if (to === 'csv') {
      const tables = findMarkdownTables(md);
      const t = tables[opts.table ?? 0];
      if (!t) throw new Error('This document has no tables.');
      const sheet = tableToSheet(t.table);
      const { text } = sheetToDelimited(sheet, {
        delimiter: ',',
        eol: '\n',
        quoteAll: false,
        bom: false,
      });
      report.keep('rows', t.table.rows.length + 1);
      const name =
        tables.length > 1 ? `${base} - ${t.label || `table ${t.index + 1}`}.csv` : `${base}.csv`;
      return result(
        blobOf(text, 'csv'),
        { kind: 'sheet', workbook: { sheets: [sheet] } },
        report.toJSON(),
        name,
      );
    }
  }

  // ---------------------------------------------------------------- Word sources
  if (from === 'docx') {
    const blob = await ws().readBlob(id);
    if (!blob) throw new Error('The file could not be read.');
    const out = await convert('docxToMarkdown', { data: await bytes(blob) });
    const media = mediaBlobs(out.media);
    if (to === 'md')
      return {
        ...result(
          blobOf(out.markdown, 'md'),
          { kind: 'markdown', text: out.markdown, media },
          out.report,
        ),
        media: out.media.map((m) => ({
          name: m.name,
          blob: new Blob([m.data as BlobPart], { type: m.mime }),
        })),
      };
    if (to === 'pdf') {
      const pdf = await convert('docxToPdf', {
        data: await bytes(blob),
        title: base,
        pageSize: pageSize(),
      });
      return result(blobOf(pdf.data, 'pdf'), { kind: 'pdf' }, pdf.report);
    }
    if (to === 'html') {
      let html = await documentHtml(base, out.markdown);
      for (const m of out.media) {
        const url = `data:${m.mime};base64,${toBase64(m.data)}`;
        html = html.split(`src="${MEDIA_SRC}${m.name}"`).join(`src="${url}"`);
      }
      return result(
        blobOf(html, 'html'),
        { kind: 'markdown', text: out.markdown, media },
        out.report,
      );
    }
    if (to === 'txt') {
      const text = markdownToPlainText(out.markdown);
      return result(blobOf(text, 'txt'), { kind: 'text', text }, out.report);
    }
  }

  // ---------------------------------------------------------------- spreadsheet sources
  if (from === 'xlsx' || from === 'csv' || from === 'tsv') {
    let wb: Workbook;
    let sourceReport: ReportData | undefined;
    if (from === 'xlsx') {
      const blob = await ws().readBlob(id);
      if (!blob) throw new Error('The file could not be read.');
      const out = await convert('readXlsx', { data: await bytes(blob) });
      wb = out.workbook;
      sourceReport = out.report;
    } else {
      const text = await currentText(id);
      const { sheet, report: r } = delimitedToSheet(text, detectDialect(text, from), base);
      wb = { sheets: [sheet] };
      sourceReport = r.toJSON();
    }
    const merged = sourceReport ? merge(report, sourceReport) : report.toJSON();
    if (to === 'xlsx') {
      const typed: Workbook = { sheets: wb.sheets.map(typeTextCells) };
      const out = await convert('writeXlsx', { workbook: typed, title: base });
      return result(
        blobOf(out.data, 'xlsx'),
        { kind: 'sheet', workbook: typed },
        merge(ConversionReport.from(merged), out.report),
      );
    }
    if (to === 'csv' || to === 'tsv') {
      const sheet = wb.sheets[opts.sheet ?? 0] ?? wb.sheets[0]!;
      const dialect: Dialect = {
        delimiter: to === 'tsv' ? '\t' : ',',
        eol: '\n',
        quoteAll: false,
        bom: false,
      };
      const { text, report: r } = sheetToDelimited(sheet, dialect);
      const name = wb.sheets.length > 1 ? `${base} - ${sheet.name}.${to}` : `${base}.${to}`;
      const preview = delimitedToSheet(text, dialect, sheet.name).sheet;
      return result(
        blobOf(text, to),
        { kind: 'sheet', workbook: { sheets: [preview] } },
        merge(ConversionReport.from(merged), r.toJSON()),
        name,
      );
    }
    if (to === 'md') {
      const r = ConversionReport.from(merged);
      let md: string;
      if (from === 'xlsx') md = workbookMarkdown(wb, r);
      else {
        const table = sheetToTable(wb.sheets[0]!, []);
        md = `${serializeTable(table)}\n`;
        if (
          wb.sheets[0]!.rows.some((row) =>
            row?.some((c) => typeof c?.v === 'string' && /\n/.test(c.v)),
          )
        )
          r.note('Line breaks inside cells became spaces.');
      }
      return result(blobOf(md, 'md'), { kind: 'markdown', text: md }, r.toJSON());
    }
  }

  // ---------------------------------------------------------------- HTML and text
  if (from === 'html' && to === 'pdf') {
    const { ast, report: r } = htmlToAst(await currentText(id));
    if (!ast.meta.title) ast.meta.title = base;
    const out = await convert('astToPdf', { ast, readReport: r.toJSON(), pageSize: pageSize() });
    return result(blobOf(out.data, 'pdf'), { kind: 'pdf' }, out.report);
  }
  if (from === 'txt' && to === 'pdf') {
    const ast = textToAst(await currentText(id));
    ast.meta.title = base;
    const out = await convert('astToPdf', { ast, pageSize: pageSize() });
    return result(blobOf(out.data, 'pdf'), { kind: 'pdf' }, out.report);
  }
  if (from === 'html' && to === 'md') {
    const { ast, report: r } = htmlToAst(await currentText(id));
    if (!ast.meta.title) ast.meta.title = base;
    const md = astToMarkdown(ast);
    return result(blobOf(md, 'md'), { kind: 'markdown', text: md }, r.toJSON());
  }
  if (from === 'txt' && to === 'md') {
    const md = astToMarkdown(textToAst(await currentText(id)));
    report.note(
      'Characters that mean something in Markdown were escaped, so the text reads exactly as before.',
      'info',
    );
    return result(blobOf(md, 'md'), { kind: 'markdown', text: md });
  }

  throw new Error(`MyDocs can't convert ${formatOf(entry.name)?.label ?? 'this file'} to .${to}.`);
}

function merge(report: ConversionReport, other: ReportData): ReportData {
  const r = ConversionReport.from(report.toJSON());
  for (const n of other.notes)
    for (let k = 0; k < (n.count ?? 1); k++) r.note(n.message, n.severity);
  for (const [k, v] of Object.entries(other.kept)) r.keep(k, v);
  return r.toJSON();
}

function mediaBlobs(
  media: { name: string; data: Uint8Array; mime: string }[],
): Record<string, Blob> {
  const out: Record<string, Blob> = {};
  for (const m of media) out[MEDIA_SRC + m.name] = new Blob([m.data as BlobPart], { type: m.mime });
  return out;
}

function toBase64(data: Uint8Array): string {
  let s = '';
  for (let i = 0; i < data.length; i += 0x8000)
    s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(s);
}

async function exportableHtml(id: EntryId, base: string, md: string): Promise<string> {
  const tree = ws().tree;
  const fromDir = tree.dirOf(id);
  return documentHtml(base, md, (target) => {
    const hit = resolveWikiLink(tree, target);
    return hit ? encodeHrefPath(relativePath(fromDir, tree.pathOf(hit.id))) : null;
  });
}

/** Saves the output next to the original. Returns the new file. */
export async function saveConversion(result: ConversionResult): Promise<Entry> {
  const workspace = ws();
  const source = workspace.get(result.source);
  if (!source) throw new Error('The original file no longer exists.');
  const parentId = source.parentId;
  let content: string | Blob = result.blob;
  const textual = result.to !== 'docx' && result.to !== 'xlsx' && result.to !== 'pdf';
  if (textual) content = (await result.blob.text()).replace(/^\uFEFF/, '');
  if (result.media?.length && typeof content === 'string') {
    // Word images go into the assets folder; links point at them relative to the new file.
    const folder = await workspace.ensureFolder(parentId, ATTACHMENTS_FOLDER);
    const base = baseName(result.name);
    const created = await workspace.createFiles(
      result.media.map((m) => ({
        parentId: folder.id,
        name: `${base} ${m.name}`,
        content: m.blob,
      })),
    );
    const tree = workspace.tree;
    const dir = parentId ? tree.pathOf(parentId) : '';
    result.media.forEach((m, i) => {
      const href = encodeHrefPath(relativePath(dir, tree.pathOf(created[i]!.id)));
      content = (content as string).split(`](${MEDIA_SRC}${m.name})`).join(`](${href})`);
    });
  }
  return workspace.createFile(parentId, result.name, content);
}

export async function exportConversion(result: ConversionResult): Promise<boolean> {
  return downloadBlob(result.blob, result.name);
}

/** Tables in a Markdown document, for the table picker. */
export async function markdownTables(id: EntryId) {
  const entry = ws().get(id);
  if (!entry || !isMarkdownName(entry.name)) return [];
  return findMarkdownTables(await currentText(id));
}
