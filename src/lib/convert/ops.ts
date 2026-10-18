/**
 * Conversion operations that run off the main thread. Inputs and outputs are plain,
 * structured-cloneable data so the same functions run in the worker or, where workers
 * are unavailable, directly.
 */
import { astToDocx, docxToAst, MEDIA_SRC, type ExtractedMedia } from './docx';
import { astToPdf } from './pdf';
import { astToMarkdown, markdownToAst } from './markdown';
import { workbookToXlsx, xlsxToWorkbook } from './xlsx';
import { recalculate } from './formula';
import { ConversionReport, type DocAst, type ReportData } from './doc-ast';
import type { Workbook } from './workbook';

type PageSize = 'a4' | 'letter';

function writePdf(
  ast: DocAst,
  input: { images?: Record<string, Uint8Array>; pageSize?: PageSize },
  readReport?: ReportData,
): { data: Uint8Array; report: ReportData } {
  const { data, report } = astToPdf(ast, {
    images: (src) => input.images?.[src],
    pageSize: input.pageSize,
  });
  // What the source file lost on the way in counts too.
  const merged = readReport ? ConversionReport.from(readReport) : new ConversionReport();
  for (const n of report.notes) merged.notes.push({ ...n });
  for (const [k, v] of report.kept) merged.kept.set(k, v);
  return { data, report: merged.toJSON() };
}

export const ops = {
  markdownToPdf(input: {
    markdown: string;
    images: Record<string, Uint8Array>;
    title?: string;
    pageSize?: PageSize;
  }): { data: Uint8Array; report: ReportData } {
    const ast = markdownToAst(input.markdown);
    if (!ast.meta.title && input.title) ast.meta.title = input.title;
    return writePdf(ast, input);
  },
  docxToPdf(input: { data: Uint8Array; title?: string; pageSize?: PageSize }): {
    data: Uint8Array;
    report: ReportData;
  } {
    const { ast, media, report } = docxToAst(input.data);
    if (!ast.meta.title && input.title) ast.meta.title = input.title;
    const images: Record<string, Uint8Array> = {};
    for (const m of media) images[MEDIA_SRC + m.name] = m.data;
    return writePdf(ast, { images, pageSize: input.pageSize }, report.toJSON());
  },
  /** For sources parsed on the main thread (HTML needs the DOM). */
  astToPdf(input: { ast: DocAst; readReport?: ReportData; pageSize?: PageSize }): {
    data: Uint8Array;
    report: ReportData;
  } {
    return writePdf(input.ast, input, input.readReport);
  },
  markdownToDocx(input: { markdown: string; images: Record<string, Uint8Array>; title?: string }): {
    data: Uint8Array;
    report: ReportData;
  } {
    const ast = markdownToAst(input.markdown);
    if (!ast.meta.title && input.title) ast.meta.title = input.title;
    const { data, report } = astToDocx(ast, { images: (src) => input.images[src] });
    return { data, report: report.toJSON() };
  },
  docxToMarkdown(input: { data: Uint8Array }): {
    markdown: string;
    media: ExtractedMedia[];
    report: ReportData;
  } {
    const { ast, media, report } = docxToAst(input.data);
    return { markdown: astToMarkdown(ast), media, report: report.toJSON() };
  },
  readXlsx(input: { data: Uint8Array }): { workbook: Workbook; stale: number; report: ReportData } {
    const { workbook, report } = xlsxToWorkbook(input.data);
    const { stale } = recalculate(workbook);
    if (stale)
      report.note(
        `${stale} formula${stale === 1 ? ' uses' : 's use'} functions MyDocs can't calculate; ${stale === 1 ? 'it shows' : 'they show'} the value saved in the file.`,
        'info',
      );
    return { workbook, stale, report: report.toJSON() };
  },
  writeXlsx(input: { workbook: Workbook; title?: string }): {
    data: Uint8Array;
    report: ReportData;
  } {
    const { data, report } = workbookToXlsx(input.workbook, { title: input.title });
    return { data, report: report.toJSON() };
  },
};

export type Ops = typeof ops;
export type OpName = keyof Ops;
