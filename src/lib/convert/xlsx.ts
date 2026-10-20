/**
 * XLSX (SpreadsheetML) ↔ workbook model.
 *
 * Kept: sheet names and order, cell types (numbers, text, booleans, errors), formulas
 * with their cached results (shared formulas are expanded), number formats (dates,
 * percentages, decimals), column widths. Reported, not silently dropped: charts,
 * images, comments, merged cells, conditional formatting, data validation, styling
 * other than number formats, pivot tables and macros.
 */
import { ConversionReport } from './doc-ast';
import { shiftFormula } from './formula';
import { readPackage, resolveTarget, writePackage, isoNow } from './package';
import {
  addr,
  colName,
  isError,
  parseAddr,
  trimSheet,
  type Cell,
  type Sheet,
  type Workbook,
} from './workbook';
import {
  attr,
  descendants,
  esc,
  kid,
  kids,
  parseXml,
  tag,
  textOf,
  XML_DECL,
  type XmlElement,
} from './xml';

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Built-in number formats (ECMA-376 18.8.30) that matter for display. */
const BUILTIN_FORMATS: Record<number, string> = {
  0: 'General',
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  9: '0%',
  10: '0.00%',
  11: '0.00E+00',
  12: '# ?/?',
  13: '# ??/??',
  14: 'yyyy-mm-dd',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'yyyy-mm-dd h:mm',
  37: '#,##0 ;(#,##0)',
  38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)',
  40: '#,##0.00;[Red](#,##0.00)',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mmss.0',
  48: '##0.0E+0',
  49: '@',
};

// ================================================================== reading

export interface XlsxReadResult {
  workbook: Workbook;
  report: ConversionReport;
}

export function xlsxToWorkbook(data: Uint8Array): XlsxReadResult {
  const pkg = readPackage(data);
  const report = new ConversionReport();
  const wbPath = 'xl/workbook.xml';
  const wbXml = pkg.text(wbPath);
  if (!wbXml) throw new Error('This is not an Excel workbook (xl/workbook.xml is missing).');
  if (pkg.has('xl/vbaProject.bin')) report.note('Macros were not kept.');
  const wb = parseXml(wbXml);
  if (
    attr(kid(wb, 'workbookPr'), 'date1904') === '1' ||
    attr(kid(wb, 'workbookPr'), 'date1904') === 'true'
  )
    report.note('This workbook uses the 1904 date system; dates are shown in the 1900 system.');

  const rels = new Map<string, string>();
  for (const r of kids(
    parseXml(pkg.text('xl/_rels/workbook.xml.rels') ?? '<Relationships/>'),
    'Relationship',
  ))
    rels.set(attr(r, 'Id') ?? '', resolveTarget(wbPath, attr(r, 'Target') ?? ''));

  // Shared strings: rich text runs are flattened to their text.
  const strings: string[] = [];
  const sst = pkg.text('xl/sharedStrings.xml');
  if (sst) {
    for (const si of kids(parseXml(sst), 'si')) {
      const runs = kids(si, 'r');
      if (runs.length > 1)
        report.note('Text formatting inside cells (mixed bold, colors) was not kept.', 'info');
      strings.push(
        runs.length
          ? runs.map((r) => textOf(kid(r, 't') ?? r)).join('')
          : textOf(kid(si, 't') ?? si),
      );
    }
  }

  // Number formats by style index.
  const formats: (string | undefined)[] = [];
  const stylesXml = pkg.text('xl/styles.xml');
  if (stylesXml) {
    const st = parseXml(stylesXml);
    const custom = new Map<number, string>();
    for (const nf of kids(kid(st, 'numFmts') ?? st, 'numFmt'))
      custom.set(Number(attr(nf, 'numFmtId')), attr(nf, 'formatCode') ?? 'General');
    for (const xf of kids(kid(st, 'cellXfs') ?? { name: '', attrs: {}, children: [] }, 'xf')) {
      const id = Number(attr(xf, 'numFmtId') ?? 0);
      const code = custom.get(id) ?? BUILTIN_FORMATS[id];
      formats.push(code && code !== 'General' ? code : undefined);
      if (id && !code)
        report.note('Some locale-specific number formats were shown as plain numbers.', 'info');
    }
    if (descendants(st, 'fill').length > 2 || descendants(st, 'font').length > 1)
      report.note(
        'Cell styling (fonts, colors, borders) is not shown; it is kept only when the file is saved unchanged.',
        'info',
      );
  }

  const sheets: Sheet[] = [];
  for (const s of descendants(kid(wb, 'sheets') ?? wb, 'sheet')) {
    const name = attr(s, 'name') ?? `Sheet${sheets.length + 1}`;
    const state = attr(s, 'state');
    const path = rels.get(attr(s, 'id') ?? '');
    const xml = path ? pkg.text(path) : undefined;
    if (!xml) {
      report.note('Chart sheets and dialog sheets were not imported.');
      continue;
    }
    if (state === 'hidden' || state === 'veryHidden')
      report.note('Hidden sheets are shown.', 'info');
    sheets.push(readSheet(name, path!, xml));
  }
  if (!sheets.length) sheets.push({ name: 'Sheet1', rows: [] });

  function readSheet(name: string, path: string, xml: string): Sheet {
    const root = parseXml(xml);
    const sheet: Sheet = { name, rows: [] };
    const shared = new Map<string, { f: string; r: number; c: number }>();
    const sheetRels = path.replace(/([^/]+)$/, '_rels/$1.rels');
    if (pkg.has(sheetRels)) {
      const t = pkg.text(sheetRels) ?? '';
      if (/\/drawing"/.test(t)) report.note('Charts, images and shapes were not imported.');
      if (/\/comments"/.test(t)) report.note('Cell comments were not imported.');
      if (/\/pivotTable"/.test(t)) report.note('Pivot tables were imported as their values.');
    }
    if (kid(root, 'mergeCells'))
      report.note('Merged cells were unmerged; the value stays in the first cell.');
    if (kid(root, 'conditionalFormatting')) report.note('Conditional formatting was not kept.');
    if (kid(root, 'dataValidations')) report.note('Data validation rules were not kept.');
    const cols = kid(root, 'cols');
    if (cols) {
      const widths: number[] = [];
      for (const c of kids(cols, 'col')) {
        const w = Number(attr(c, 'width'));
        const min = Number(attr(c, 'min')) - 1;
        const max = Math.min(Number(attr(c, 'max')) - 1, min + 200);
        if (Number.isFinite(w)) for (let k = min; k <= max; k++) widths[k] = w;
      }
      sheet.widths = widths;
    }
    const data = kid(root, 'sheetData');
    let rowIndex = -1;
    for (const row of data ? kids(data, 'row') : []) {
      rowIndex = attr(row, 'r') ? Number(attr(row, 'r')) - 1 : rowIndex + 1;
      let colIdx = -1;
      for (const c of kids(row, 'c')) {
        const ref = attr(c, 'r');
        const pos = ref ? parseAddr(ref) : null;
        colIdx = pos ? pos.c : colIdx + 1;
        const r = pos ? pos.r : rowIndex;
        const cell = readCell(c, r, colIdx);
        if (cell) {
          while (sheet.rows.length <= r) sheet.rows.push([]);
          (sheet.rows[r] ??= [])[colIdx] = cell;
        }
      }
    }
    return sheet;

    function readCell(c: XmlElement, r: number, col: number): Cell | undefined {
      const t = attr(c, 't') ?? 'n';
      const v = kid(c, 'v');
      const raw = v ? textOf(v) : undefined;
      const fEl = kid(c, 'f');
      let f: string | undefined;
      if (fEl) {
        const text = textOf(fEl);
        const si = attr(fEl, 'si');
        if (attr(fEl, 't') === 'shared' && si !== undefined) {
          if (text) shared.set(si, { f: text, r, c: col });
          else {
            const master = shared.get(si);
            if (master) f = shiftFormula(master.f, r - master.r, col - master.c);
          }
        }
        if (text) f = text;
        if (attr(fEl, 't') === 'array')
          report.note('Array formulas keep their saved results.', 'info');
      }
      const fmt = formats[Number(attr(c, 's') ?? 0)];
      let value: Cell['v'];
      switch (t) {
        case 's':
          value = strings[Number(raw)] ?? '';
          break;
        case 'inlineStr':
          value = textOf(kid(c, 'is') ?? c);
          break;
        case 'str':
          value = raw ?? '';
          break;
        case 'b':
          value = raw === '1' || raw === 'true';
          break;
        case 'e':
          value = { error: raw ?? '#VALUE!' };
          break;
        case 'd':
          value = raw ? (Date.parse(raw) - Date.UTC(1899, 11, 30)) / 86400000 : null;
          break;
        default:
          value = raw === undefined || raw === '' ? null : Number(raw);
      }
      if (value === null && f === undefined && !fmt) return undefined;
      const cell: Cell = { v: value };
      // Kept exactly (including _xlfn. prefixes) so Excel reads it back the same way.
      if (f !== undefined) cell.f = f;
      if (fmt) cell.fmt = fmt;
      return cell;
    }
  }

  return { workbook: { sheets }, report };
}

// ================================================================== writing

/** Sheet names: at most 31 characters, none of []:*?/\ and unique. */
export function cleanSheetName(name: string, taken: Set<string>): string {
  let n =
    name
      .replace(/[[\]:*?/\\]/g, ' ')
      .trim()
      .slice(0, 31) || 'Sheet';
  const base = n;
  for (let k = 2; taken.has(n.toLowerCase()); k++) {
    const suffix = ` (${k})`;
    n = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  taken.add(n.toLowerCase());
  return n;
}

export function workbookToXlsx(
  wb: Workbook,
  meta: { title?: string; author?: string } = {},
): { data: Uint8Array; report: ConversionReport } {
  const report = new ConversionReport();
  const strings: string[] = [];
  const stringIndex = new Map<string, number>();
  const sharedString = (s: string) => {
    let i = stringIndex.get(s);
    if (i === undefined) {
      i = strings.length;
      strings.push(s);
      stringIndex.set(s, i);
    }
    return i;
  };
  // Style 0 is General; every distinct number format gets its own xf. Codes that are
  // built into Excel keep their built-in id so every reader recognises them.
  const fmtIds = new Map<string, number>();
  const builtinId = new Map<string, number>();
  for (const id of [1, 2, 3, 4, 9, 10, 11, 49]) builtinId.set(BUILTIN_FORMATS[id]!, id);
  const xfOf = (fmt: string | undefined) => {
    if (!fmt || fmt === 'General') return 0;
    let id = fmtIds.get(fmt);
    if (id === undefined) {
      id = fmtIds.size + 1;
      fmtIds.set(fmt, id);
    }
    return id;
  };
  const taken = new Set<string>();
  const names = wb.sheets.map((s) => cleanSheetName(s.name, taken));
  wb.sheets.forEach((s, i) => {
    if (names[i] !== s.name)
      report.note(`Sheet "${s.name}" was renamed to "${names[i]}" (Excel's naming rules).`);
  });

  let formulas = 0;
  let cells = 0;
  const sheetXml = wb.sheets.map((raw) => {
    const s = trimSheet(raw);
    let rows = '';
    s.rows.forEach((row, r) => {
      let cs = '';
      row.forEach((cell, c) => {
        if (!cell) return;
        cells++;
        const ref = addr(r, c);
        const sAttr = xfOf(cell.fmt) || undefined;
        const f = cell.f !== undefined ? tag('f', {}, esc(cell.f)) : '';
        if (cell.f !== undefined) formulas++;
        const v = cell.v;
        if (v === null) cs += tag('c', { r: ref, s: sAttr }, f);
        else if (typeof v === 'number')
          cs += tag('c', { r: ref, s: sAttr }, f + tag('v', {}, String(v)));
        else if (typeof v === 'boolean')
          cs += tag('c', { r: ref, s: sAttr, t: 'b' }, f + tag('v', {}, v ? '1' : '0'));
        else if (isError(v))
          cs += tag(
            'c',
            { r: ref, s: sAttr, t: 'e' },
            f + tag('v', {}, esc(v.error === '#CIRC!' ? '#VALUE!' : v.error)),
          );
        else if (cell.f !== undefined)
          cs += tag('c', { r: ref, s: sAttr, t: 'str' }, f + tag('v', {}, esc(v)));
        else cs += tag('c', { r: ref, s: sAttr, t: 's' }, tag('v', {}, String(sharedString(v))));
      });
      if (cs) rows += tag('row', { r: r + 1 }, cs);
    });
    const width = Math.max(1, ...s.rows.map((r) => r.length));
    const dim = s.rows.length ? `A1:${colName(width - 1)}${s.rows.length}` : 'A1';
    const colsXml = s.widths?.length
      ? `<cols>${s.widths.map((w, k) => (w ? tag('col', { min: k + 1, max: k + 1, width: w, customWidth: 1 }) : '')).join('')}</cols>`
      : '';
    return `${XML_DECL}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_R}"><dimension ref="${dim}"/><sheetViews><sheetView workbookViewId="0"${wb.sheets.indexOf(raw) === 0 ? ' tabSelected="1"' : ''}/></sheetViews><sheetFormatPr defaultRowHeight="15"/>${colsXml}<sheetData>${rows}</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
  });
  report.keep('sheets', wb.sheets.length);
  report.keep('cells', cells);
  if (formulas) report.keep('formulas', formulas);

  const codes = [...fmtIds.keys()];
  const numFmtId = (code: string, k: number) => builtinId.get(code) ?? 164 + k;
  const custom = codes
    .map((code, k) => ({ code, id: numFmtId(code, k) }))
    .filter((x) => x.id >= 164);
  const numFmts = custom.map((x) => tag('numFmt', { numFmtId: x.id, formatCode: x.code })).join('');
  const xfs = [
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    ...codes.map(
      (code, k) =>
        `<xf numFmtId="${numFmtId(code, k)}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`,
    ),
  ].join('');
  const styles = `${XML_DECL}<styleSheet xmlns="${NS_MAIN}">${numFmts ? `<numFmts count="${custom.length}">${numFmts}</numFmts>` : ''}<fonts count="1"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${fmtIds.size + 1}">${xfs}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const sst = `${XML_DECL}<sst xmlns="${NS_MAIN}" count="${strings.length}" uniqueCount="${strings.length}">${strings
    .map(
      (s) => `<si>${tag('t', /^\s|\s$/.test(s) ? { 'xml:space': 'preserve' } : {}, esc(s))}</si>`,
    )
    .join('')}</sst>`;

  const workbook = `${XML_DECL}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_R}"><workbookPr/><bookViews><workbookView/></bookViews><sheets>${names
    .map((n, i) => tag('sheet', { name: n, sheetId: i + 1, 'r:id': `rId${i + 1}` }))
    .join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;

  const n = wb.sheets.length;
  const wbRels = `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names
    .map((_, i) =>
      tag('Relationship', {
        Id: `rId${i + 1}`,
        Type: `${REL}/worksheet`,
        Target: `worksheets/sheet${i + 1}.xml`,
      }),
    )
    .join(
      '',
    )}${tag('Relationship', { Id: `rId${n + 1}`, Type: `${REL}/styles`, Target: 'styles.xml' })}${tag(
    'Relationship',
    {
      Id: `rId${n + 2}`,
      Type: `${REL}/sharedStrings`,
      Target: 'sharedStrings.xml',
    },
  )}</Relationships>`;

  const now = isoNow();
  const parts: Record<string, string> = {
    '[Content_Types].xml': `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${names
      .map((_, i) =>
        tag('Override', {
          PartName: `/xl/worksheets/sheet${i + 1}.xml`,
          ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
        }),
      )
      .join(
        '',
      )}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    '_rels/.rels': `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    'docProps/core.xml': `${XML_DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${meta.title ? tag('dc:title', {}, esc(meta.title)) : ''}${meta.author ? tag('dc:creator', {}, esc(meta.author)) : ''}<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
    'docProps/app.xml': `${XML_DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>MyDocs</Application></Properties>`,
    'xl/workbook.xml': workbook,
    'xl/_rels/workbook.xml.rels': wbRels,
    'xl/styles.xml': styles,
    'xl/sharedStrings.xml': sst,
  };
  sheetXml.forEach((x, i) => (parts[`xl/worksheets/sheet${i + 1}.xml`] = x));
  return { data: writePackage(parts), report };
}
