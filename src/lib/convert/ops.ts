/**
 * Conversion operations that run off the main thread. Inputs and outputs are plain,
 * structured-cloneable data so the same functions run in the worker or, where workers
 * are unavailable, directly.
 */
import { astToDocx, docxToAst, type ExtractedMedia } from './docx';
import { astToMarkdown, markdownToAst } from './markdown';
import { workbookToXlsx, xlsxToWorkbook } from './xlsx';
import { recalculate } from './formula';
import type { ReportData } from './doc-ast';
import type { Workbook } from './workbook';

export const ops = {
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
