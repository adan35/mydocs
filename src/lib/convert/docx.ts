/**
 * DOCX (WordprocessingML) ↔ document AST.
 *
 * The writer produces real Word structure: heading styles with outline levels (so the
 * navigation pane and table of contents work), numbered and bulleted lists through
 * numbering definitions, real tables with a repeating header row, hyperlinks, embedded
 * images and document properties. The reader maps the same structure back and reports
 * everything it had to approximate (comments, tracked changes, merged cells, fields).
 */
import {
  ConversionReport,
  describeAst,
  inlineText,
  normalizeInlines,
  type Block,
  type DocAst,
  type DocMeta,
  type Inline,
  type ListItem,
  type Marks,
  type TableCell,
} from './doc-ast';
import {
  attr,
  descendants,
  esc,
  isEl,
  kid,
  kids,
  local,
  parseXml,
  tag,
  textOf,
  XML_DECL,
  type XmlElement,
} from './xml';
import {
  imageInfo,
  isoNow,
  readPackage,
  resolveTarget,
  writePackage,
  type ImageInfo,
} from './package';

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const REL_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MONO = 'Consolas';
const EMU_PER_PX = 9525;
const MAX_IMAGE_WIDTH_PX = 600;

/** Image bytes for `src` values found in the document, resolved by the caller. */
export type ImageResolver = (src: string) => Uint8Array | undefined;

// ================================================================== writing

interface WriteCtx {
  rels: string[];
  relIds: Map<string, string>;
  media: Record<string, Uint8Array>;
  mediaTypes: Set<string>;
  nums: string[];
  nextNum: number;
  nextDocPr: number;
  images?: ImageResolver;
  report: ConversionReport;
}

function relId(ctx: WriteCtx, type: string, target: string, external = false): string {
  const key = `${type}|${target}`;
  const existing = ctx.relIds.get(key);
  if (existing) return existing;
  const id = `rId${ctx.rels.length + 10}`;
  ctx.rels.push(
    tag('Relationship', {
      Id: id,
      Type: `${REL_BASE}/${type}`,
      Target: target,
      TargetMode: external ? 'External' : undefined,
    }),
  );
  ctx.relIds.set(key, id);
  return id;
}

function runProps(m: Marks | undefined, extra = ''): string {
  if (!m && !extra) return '';
  let p = '';
  if (m?.code) p += tag('w:rStyle', { 'w:val': 'CodeChar' });
  if (m?.bold) p += '<w:b/>';
  if (m?.italic) p += '<w:i/>';
  if (m?.strike) p += '<w:strike/>';
  if (m?.underline) p += tag('w:u', { 'w:val': 'single' });
  if (m?.sup) p += tag('w:vertAlign', { 'w:val': 'superscript' });
  if (m?.sub) p += tag('w:vertAlign', { 'w:val': 'subscript' });
  p += extra;
  return p ? `<w:rPr>${p}</w:rPr>` : '';
}

function textRun(text: string, marks?: Marks, extra = ''): string {
  // Tabs and line breaks are their own elements in WordprocessingML.
  const parts = text.split(/(\t|\n)/);
  let inner = '';
  for (const part of parts) {
    if (part === '\t') inner += '<w:tab/>';
    else if (part === '\n') inner += '<w:br/>';
    else if (part) inner += tag('w:t', { 'xml:space': 'preserve' }, esc(part));
  }
  return inner ? `<w:r>${runProps(marks, extra)}${inner}</w:r>` : '';
}

function imageRun(ctx: WriteCtx, src: string, alt: string): string {
  const data = ctx.images?.(src);
  const info: ImageInfo | null = data ? imageInfo(data) : null;
  if (!data || !info || info.ext === 'svg' || info.ext === 'webp') {
    ctx.report.note(
      data
        ? 'Images in formats Word cannot show (SVG, WebP) were replaced by their description.'
        : 'Images that are not in this workspace were replaced by their description.',
    );
    return textRun(`[${alt || 'image'}]`, { italic: true });
  }
  const n = Object.keys(ctx.media).length + 1;
  const name = `image${n}.${info.ext === 'jpeg' ? 'jpeg' : info.ext}`;
  ctx.media[`word/media/${name}`] = data;
  ctx.mediaTypes.add(info.ext);
  const rid = relId(ctx, 'image', `media/${name}`);
  let w = info.width || 300;
  let h = info.height || 200;
  if (w > MAX_IMAGE_WIDTH_PX) {
    h = Math.round((h * MAX_IMAGE_WIDTH_PX) / w);
    w = MAX_IMAGE_WIDTH_PX;
  }
  const cx = w * EMU_PER_PX;
  const cy = h * EMU_PER_PX;
  const id = ctx.nextDocPr++;
  ctx.report.keep('images');
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}" descr="${esc(alt)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="${NS_PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(name)}" descr="${esc(alt)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

function inlinesXml(ctx: WriteCtx, inl: Inline[], marks?: Marks): string {
  let out = '';
  for (const n of inl) {
    if (n.type === 'text') out += textRun(n.text, { ...marks, ...n.marks });
    else if (n.type === 'break') out += '<w:r><w:br/></w:r>';
    else if (n.type === 'math') {
      ctx.report.note('Equations were written as TeX text; Word does not read TeX.', 'info');
      out += textRun(n.tex, { ...marks, code: true });
    } else if (n.type === 'image') out += imageRun(ctx, n.src, n.alt);
    else if (n.type === 'link') {
      const runs = n.children
        .map((c) =>
          c.type === 'text'
            ? textRun(c.text, { ...marks, ...c.marks }, tag('w:rStyle', { 'w:val': 'Hyperlink' }))
            : inlinesXml(ctx, [c], marks),
        )
        .join('');
      if (n.href.startsWith('#')) out += tag('w:hyperlink', { 'w:anchor': n.href.slice(1) }, runs);
      else {
        const rid = relId(ctx, 'hyperlink', n.href, true);
        out += tag('w:hyperlink', { 'r:id': rid, 'w:history': '1' }, runs);
      }
    }
  }
  return out;
}

function para(style: string | null, inner: string, extraPPr = ''): string {
  const pPr = (style ? tag('w:pStyle', { 'w:val': style }) : '') + extraPPr;
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${inner}</w:p>`;
}

function bookmarkName(text: string): string {
  // The same slugs the preview uses for heading links.
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

function newNum(ctx: WriteCtx, ordered: boolean, start: number | undefined, level: number): number {
  const id = ctx.nextNum++;
  // Every list gets its own numbering instance so ordered lists restart where Markdown says.
  const override = ordered
    ? `<w:lvlOverride w:ilvl="${level}"><w:startOverride w:val="${start ?? 1}"/></w:lvlOverride>`
    : '';
  ctx.nums.push(
    `<w:num w:numId="${id}"><w:abstractNumId w:val="${ordered ? 2 : 1}"/>${override}</w:num>`,
  );
  return id;
}

function blocksXml(
  ctx: WriteCtx,
  blocks: Block[],
  opts: { quote?: number; list?: { num: number; level: number } } = {},
): string {
  let out = '';
  const quoteInd = opts.quote ? tag('w:ind', { 'w:left': 720 * opts.quote }) : '';
  const quoteStyle = (s: string | null) => (opts.quote ? 'Quote' : s);
  let bookmark = 0;
  // In a list item only the first paragraph carries the number; the rest are indented.
  let numberNext = !!opts.list;
  const listInd = opts.list ? tag('w:ind', { 'w:left': 720 * (opts.list.level + 1) }) : '';
  for (const b of blocks) {
    switch (b.type) {
      case 'heading': {
        const name = bookmarkName(inlineText(b.inlines));
        const id = ctx.nextDocPr++ + bookmark++;
        out += para(
          `Heading${b.level}`,
          `<w:bookmarkStart w:id="${id}" w:name="${esc(name.slice(0, 40))}"/>${inlinesXml(ctx, b.inlines)}<w:bookmarkEnd w:id="${id}"/>`,
          quoteInd,
        );
        break;
      }
      case 'paragraph': {
        const list = opts.list;
        if (list && numberNext) {
          const numPr = `<w:numPr><w:ilvl w:val="${list.level}"/><w:numId w:val="${list.num}"/></w:numPr>`;
          out += para('ListParagraph', inlinesXml(ctx, b.inlines), numPr);
          numberNext = false;
        } else
          out += para(
            list ? 'ListParagraph' : quoteStyle(null),
            inlinesXml(ctx, b.inlines),
            list ? listInd : quoteInd,
          );
        break;
      }
      case 'list': {
        const level = opts.list ? opts.list.level + 1 : 0;
        const num = newNum(ctx, b.ordered, b.start, level);
        for (const item of b.items)
          out += listItemXml(ctx, item, num, level, b.ordered, opts.quote);
        break;
      }
      case 'quote':
        out += blocksXml(ctx, b.blocks, { quote: (opts.quote ?? 0) + 1 });
        break;
      case 'code': {
        const lines = b.text.split('\n');
        if (b.lang) ctx.report.note('Code block languages are not kept in Word.', 'info');
        for (const line of lines) out += para('Code', textRun(line), quoteInd);
        break;
      }
      case 'math':
        ctx.report.note('Equations were written as TeX text; Word does not read TeX.', 'info');
        for (const line of b.tex.split('\n')) out += para('Code', textRun(line), quoteInd);
        break;
      case 'rule':
        out += para(
          null,
          '',
          '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="C8C4BE"/></w:pBdr>',
        );
        break;
      case 'raw':
        ctx.report.note('Raw HTML blocks were written as plain text.');
        for (const line of b.text.split('\n')) out += para('Code', textRun(line), quoteInd);
        break;
      case 'table':
        out += tableXml(ctx, b);
        break;
    }
  }
  return out;
}

function listItemXml(
  ctx: WriteCtx,
  item: ListItem,
  num: number,
  level: number,
  _ordered: boolean,
  quote?: number,
): string {
  const blocks = [...item.blocks];
  if (item.checked !== undefined) {
    const box: Inline = { type: 'text', text: item.checked ? '☒ ' : '☐ ' };
    const first = blocks[0];
    if (first?.type === 'paragraph') blocks[0] = { ...first, inlines: [box, ...first.inlines] };
    else blocks.unshift({ type: 'paragraph', inlines: [box] });
  }
  if (blocks[0]?.type !== 'paragraph') blocks.unshift({ type: 'paragraph', inlines: [] });
  return blocksXml(ctx, blocks, { list: { num, level }, quote });
}

function tableXml(ctx: WriteCtx, t: Extract<Block, { type: 'table' }>): string {
  const cols = Math.max(t.header.length, ...t.rows.map((r) => r.length), 1);
  const width = Math.floor(9360 / cols); // 6.5" text width in twentieths of a point
  const jc = (k: number) => {
    const a = t.align[k];
    return a ? tag('w:jc', { 'w:val': a }) : '';
  };
  const row = (cells: TableCell[], header: boolean) => {
    let r = header ? '<w:trPr><w:tblHeader/></w:trPr>' : '';
    for (let k = 0; k < cols; k++) {
      const inner = inlinesXml(ctx, cells[k]?.inlines ?? [], header ? { bold: true } : undefined);
      r += `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${para(null, inner, jc(k))}</w:tc>`;
    }
    return `<w:tr>${r}</w:tr>`;
  };
  const grid = Array.from({ length: cols }, () => `<w:gridCol w:w="${width}"/>`).join('');
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${row(t.header, true)}${t.rows.map((r) => row(r, false)).join('')}</w:tbl>${para(null, '')}`;
}

function numberingXml(nums: string[]): string {
  const lvl = (i: number, ordered: boolean) => {
    const fmt = ordered ? ['decimal', 'lowerLetter', 'lowerRoman'][i % 3]! : 'bullet';
    const text = ordered ? `%${i + 1}.` : ['•', '◦', '▪'][i % 3]!;
    const font = ordered
      ? ''
      : `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:hint="default"/></w:rPr>`;
    return `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr>${font}</w:lvl>`;
  };
  const abs = (id: number, ordered: boolean) =>
    `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${Array.from({ length: 9 }, (_, i) => lvl(i, ordered)).join('')}</w:abstractNum>`;
  return `${XML_DECL}<w:numbering xmlns:w="${NS_W}">${abs(1, false)}${abs(2, true)}${nums.join('')}</w:numbering>`;
}

const STYLES = (() => {
  const heading = (n: number, size: number) =>
    `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${n <= 2 ? 360 : 240}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
  return `${XML_DECL}<w:styles xmlns:w="${NS_W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:sz w:val="56"/></w:rPr></w:style>
${heading(1, 40)}${heading(2, 32)}${heading(3, 28)}${heading(4, 24)}${heading(5, 22)}${heading(6, 22)}
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="C8C4BE"/></w:pBdr></w:pPr><w:rPr><w:i/><w:color w:val="5D5B54"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:shd w:val="clear" w:color="auto" w:fill="F6F5F4"/></w:pPr><w:rPr><w:rFonts w:ascii="${MONO}" w:hAnsi="${MONO}" w:cs="${MONO}"/><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="CodeChar"><w:name w:val="Code Char"/><w:rPr><w:rFonts w:ascii="${MONO}" w:hAnsi="${MONO}" w:cs="${MONO}"/><w:shd w:val="clear" w:color="auto" w:fill="F6F5F4"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:color="BFBFBF"/></w:tblBorders><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;
})();

function coreXml(meta: DocMeta): string {
  const now = isoNow();
  return `${XML_DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${
    meta.title ? tag('dc:title', {}, esc(meta.title)) : ''
  }${meta.subject ? tag('dc:subject', {}, esc(meta.subject)) : ''}${meta.author ? tag('dc:creator', {}, esc(meta.author)) : ''}${
    meta.keywords?.length ? tag('cp:keywords', {}, esc(meta.keywords.join(', '))) : ''
  }<dcterms:created xsi:type="dcterms:W3CDTF">${esc(isoDate(meta.created) ?? now)}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
}

function isoDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const APP_XML = `${XML_DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>MyDocs</Application></Properties>`;

/** Writes a DOCX package. */
export function astToDocx(
  ast: DocAst,
  opts: { images?: ImageResolver } = {},
): { data: Uint8Array; report: ConversionReport } {
  const report = new ConversionReport();
  describeAst(ast, report);
  report.kept.delete('images'); // counted as they are embedded
  const ctx: WriteCtx = {
    rels: [],
    relIds: new Map(),
    media: {},
    mediaTypes: new Set(),
    nums: [],
    nextNum: 1,
    nextDocPr: 1,
    images: opts.images,
    report,
  };
  if (ast.meta.extra && Object.keys(ast.meta.extra).length)
    report.note(
      'Front matter fields other than title, author, subject, tags and dates are not kept in Word.',
    );
  const body = blocksXml(ctx, ast.blocks);
  const sect =
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';
  const document = `${XML_DECL}<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:wp="${NS_WP}" xmlns:a="${NS_A}" xmlns:pic="${NS_PIC}"><w:body>${body}${sect}</w:body></w:document>`;
  const imageTypes = [...ctx.mediaTypes]
    .map((e) =>
      tag('Default', {
        Extension: e === 'jpeg' ? 'jpeg' : e,
        ContentType: e === 'jpeg' ? 'image/jpeg' : `image/${e}`,
      }),
    )
    .join('');
  const parts: Record<string, string | Uint8Array> = {
    '[Content_Types].xml': `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageTypes}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    '_rels/.rels': `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_BASE}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL_BASE}/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    'docProps/core.xml': coreXml(ast.meta),
    'docProps/app.xml': APP_XML,
    'word/document.xml': document,
    'word/styles.xml': STYLES,
    'word/numbering.xml': numberingXml(ctx.nums),
    'word/_rels/document.xml.rels': `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_BASE}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${REL_BASE}/numbering" Target="numbering.xml"/>${ctx.rels.join('')}</Relationships>`,
    ...ctx.media,
  };
  return { data: writePackage(parts), report };
}

// ================================================================== reading

export interface ExtractedMedia {
  /** File name inside the package (`image1.png`). */
  name: string;
  data: Uint8Array;
  mime: string;
}

export interface DocxReadResult {
  ast: DocAst;
  media: ExtractedMedia[];
  report: ConversionReport;
}

/** Placeholder image source for extracted media; the app rewrites it to a saved path. */
export const MEDIA_SRC = 'docx-media/';

interface StyleInfo {
  name: string;
  basedOn?: string;
  outline?: number;
  mono?: boolean;
  numId?: string;
}

const MONO_FONTS = /consolas|courier|mono|menlo|monaco|source code|fira code|lucida console/i;

function readStyles(xml: string | undefined): Map<string, StyleInfo> {
  const map = new Map<string, StyleInfo>();
  if (!xml) return map;
  const root = parseXml(xml);
  for (const s of kids(root, 'style')) {
    const id = attr(s, 'styleId');
    if (!id) continue;
    const pPr = kid(s, 'pPr');
    const outline = attr(kid(pPr, 'outlineLvl'), 'val');
    const fonts = kid(kid(s, 'rPr'), 'rFonts');
    map.set(id, {
      name: (attr(kid(s, 'name'), 'val') ?? id).toLowerCase(),
      basedOn: attr(kid(s, 'basedOn'), 'val'),
      outline: outline !== undefined ? Number(outline) : undefined,
      mono: !!fonts && MONO_FONTS.test(attr(fonts, 'ascii') ?? attr(fonts, 'hAnsi') ?? ''),
      numId: attr(kid(kid(pPr, 'numPr'), 'numId'), 'val'),
    });
  }
  return map;
}

interface NumLevel {
  ordered: boolean;
  start: number;
}

function readNumbering(xml: string | undefined): Map<string, NumLevel[]> {
  const out = new Map<string, NumLevel[]>();
  if (!xml) return out;
  const root = parseXml(xml);
  const abstract = new Map<string, NumLevel[]>();
  for (const a of kids(root, 'abstractNum')) {
    const levels: NumLevel[] = [];
    for (const l of kids(a, 'lvl')) {
      const fmt = attr(kid(l, 'numFmt'), 'val') ?? 'bullet';
      levels[Number(attr(l, 'ilvl') ?? 0)] = {
        ordered: fmt !== 'bullet' && fmt !== 'none',
        start: Number(attr(kid(l, 'start'), 'val') ?? 1),
      };
    }
    abstract.set(attr(a, 'abstractNumId') ?? '', levels);
  }
  for (const n of kids(root, 'num')) {
    const levels = [...(abstract.get(attr(kid(n, 'abstractNumId'), 'val') ?? '') ?? [])];
    for (const o of kids(n, 'lvlOverride')) {
      const i = Number(attr(o, 'ilvl') ?? 0);
      const start = attr(kid(o, 'startOverride'), 'val');
      if (start !== undefined && levels[i]) levels[i] = { ...levels[i]!, start: Number(start) };
    }
    out.set(attr(n, 'numId') ?? '', levels);
  }
  return out;
}

function readRels(xml: string | undefined): Map<string, { target: string; external: boolean }> {
  const map = new Map<string, { target: string; external: boolean }>();
  if (!xml) return map;
  for (const r of kids(parseXml(xml), 'Relationship'))
    map.set(attr(r, 'Id') ?? '', {
      target: attr(r, 'Target') ?? '',
      external: attr(r, 'TargetMode') === 'External',
    });
  return map;
}

function readCore(xml: string | undefined): DocMeta {
  if (!xml) return {};
  const root = parseXml(xml);
  const get = (n: string) => {
    const el = kid(root, n);
    const t = el ? textOf(el).trim() : '';
    return t || undefined;
  };
  const meta: DocMeta = {};
  if (get('title')) meta.title = get('title');
  if (get('creator')) meta.author = get('creator');
  if (get('subject')) meta.subject = get('subject');
  const kw = get('keywords');
  if (kw) meta.keywords = kw.split(/[,;]\s*/).filter(Boolean);
  if (get('created')) meta.created = get('created');
  return meta;
}

/** Reads a DOCX package into the AST. */
export function docxToAst(data: Uint8Array): DocxReadResult {
  const pkg = readPackage(data);
  const report = new ConversionReport();
  const docPath = 'word/document.xml';
  const docXml = pkg.text(docPath);
  if (!docXml) throw new Error('This is not a Word document (word/document.xml is missing).');
  const styles = readStyles(pkg.text('word/styles.xml'));
  const numbering = readNumbering(pkg.text('word/numbering.xml'));
  const rels = readRels(pkg.text('word/_rels/document.xml.rels'));
  const media: ExtractedMedia[] = [];
  const mediaByTarget = new Map<string, string>();
  if (pkg.has('word/comments.xml')) report.note('Comments were not imported.');
  if (
    pkg.has('word/footnotes.xml') &&
    /<w:footnote [^>]*w:id="[1-9]/.test(pkg.text('word/footnotes.xml') ?? '')
  )
    report.note('Footnotes were not imported.');

  const styleChain = (id: string | undefined): StyleInfo[] => {
    const chain: StyleInfo[] = [];
    let cur = id;
    for (let guard = 0; cur && guard < 10; guard++) {
      const s = styles.get(cur);
      if (!s) break;
      chain.push(s);
      cur = s.basedOn;
    }
    return chain;
  };

  const image = (blip: XmlElement, alt: string): Inline | null => {
    const rid = attr(blip, 'embed');
    const rel = rid ? rels.get(rid) : undefined;
    if (!rel || rel.external) {
      report.note('Linked (not embedded) images were not imported.');
      return null;
    }
    const path = resolveTarget(docPath, rel.target);
    let name = mediaByTarget.get(path);
    if (!name) {
      const bytes = pkg.bytes(path);
      if (!bytes) return null;
      const info = imageInfo(bytes);
      name = path.split('/').pop()!;
      media.push({ name, data: bytes, mime: info?.mime ?? 'application/octet-stream' });
      mediaByTarget.set(path, name);
      if (!info) report.note('Some images are in a format browsers cannot show (EMF, WMF).');
    }
    return { type: 'image', src: MEDIA_SRC + name, alt };
  };

  const runMarks = (r: XmlElement, base: Marks): Marks => {
    const rPr = kid(r, 'rPr');
    const m: Marks = { ...base };
    if (!rPr) return m;
    const on = (n: string) => {
      const el = kid(rPr, n);
      if (!el) return undefined;
      const v = attr(el, 'val');
      return v === undefined || (v !== '0' && v !== 'false' && v !== 'none');
    };
    if (on('b') !== undefined) m.bold = on('b');
    if (on('i') !== undefined) m.italic = on('i');
    if (on('strike') || on('dstrike')) m.strike = true;
    if (on('u')) m.underline = true;
    const va = attr(kid(rPr, 'vertAlign'), 'val');
    if (va === 'superscript') m.sup = true;
    if (va === 'subscript') m.sub = true;
    const rStyle = attr(kid(rPr, 'rStyle'), 'val');
    const fonts = kid(rPr, 'rFonts');
    if (
      (fonts && MONO_FONTS.test(attr(fonts, 'ascii') ?? '')) ||
      styleChain(rStyle).some((s) => s.mono)
    )
      m.code = true;
    if (rStyle && styles.get(rStyle)?.name === 'hyperlink') m.underline = false;
    return m;
  };

  // Complex fields (HYPERLINK) span several runs: begin, instruction, separate, result, end.
  const inlinesOf = (p: XmlElement, base: Marks = {}): Inline[] => {
    const out: Inline[] = [];
    let field: { instr: string; result: Inline[]; phase: 'instr' | 'result' } | null = null;
    const emit = (n: Inline) =>
      (field?.phase === 'result' ? field.result : field ? [] : out).push(n);
    const visit = (el: XmlElement, marks: Marks) => {
      for (const c of el.children) {
        if (!isEl(c)) continue;
        const name = local(c.name);
        switch (name) {
          case 'r': {
            const m = runMarks(c, marks);
            for (const rc of c.children) {
              if (!isEl(rc)) continue;
              const rn = local(rc.name);
              if (rn === 't') emit({ type: 'text', text: textOf(rc), marks: m });
              else if (rn === 'tab') emit({ type: 'text', text: '\t', marks: m });
              else if (rn === 'br' || rn === 'cr') {
                if (attr(rc, 'type') === 'page') report.note('Page breaks were removed.', 'info');
                else emit({ type: 'break' });
              } else if (rn === 'noBreakHyphen') emit({ type: 'text', text: '-', marks: m });
              else if (rn === 'sym')
                emit({
                  type: 'text',
                  text: String.fromCharCode(parseInt(attr(rc, 'char') ?? '20', 16)),
                  marks: m,
                });
              else if (rn === 'drawing' || rn === 'pict' || rn === 'object') {
                const blip = descendants(rc, 'blip')[0] ?? descendants(rc, 'imagedata')[0];
                const docPr = descendants(rc, 'docPr')[0];
                const alt = attr(docPr, 'descr') ?? attr(docPr, 'title') ?? '';
                const img = blip ? image(blip, alt) : null;
                if (img) emit(img);
                const box = descendants(rc, 'txbxContent');
                if (box.length) {
                  report.note('Text boxes were imported as ordinary text.');
                  for (const b of box)
                    for (const bp of descendants(b, 'p'))
                      emit({ type: 'text', text: ` ${inlineText(inlinesOf(bp))} `, marks: m });
                }
                if (!img && !box.length && !blip)
                  report.note('Shapes and charts were not imported.');
              } else if (rn === 'fldChar') {
                const t = attr(rc, 'fldCharType');
                if (t === 'begin') field = { instr: '', result: [], phase: 'instr' };
                else if (t === 'separate' && field) field.phase = 'result';
                else if (t === 'end' && field) {
                  const f: { instr: string; result: Inline[] } = field;
                  field = null;
                  const m2 = /HYPERLINK\s+"([^"]+)"/.exec(f.instr);
                  const anchor = /HYPERLINK\s+\\l\s+"([^"]+)"/.exec(f.instr);
                  if (m2 || anchor)
                    out.push({
                      type: 'link',
                      href: m2 ? m2[1]! : `#${anchor![1]}`,
                      children: normalizeInlines(f.result),
                    });
                  else {
                    if (!/^\s*(PAGE|NUMPAGES|SEQ|REF|TOC|PAGEREF)\b/.test(f.instr))
                      report.note(
                        'Fields (dates, references) were imported as their last shown text.',
                        'info',
                      );
                    out.push(...f.result);
                  }
                }
              } else if (rn === 'instrText' && field) field.instr += textOf(rc);
              else if (rn === 'footnoteReference' || rn === 'endnoteReference')
                report.note('Footnotes were not imported.');
            }
            break;
          }
          case 'hyperlink': {
            const rid = attr(c, 'id');
            const anchor = attr(c, 'anchor');
            const rel = rid ? rels.get(rid) : undefined;
            const href = rel?.target ?? (anchor ? `#${anchor}` : '');
            const inner: Inline[] = [];
            const saved = out.length;
            visit(c, marks);
            inner.push(...out.splice(saved));
            if (href)
              out.push({
                type: 'link',
                href,
                children: normalizeInlines(
                  inner.map((n) =>
                    n.type === 'text' && n.marks
                      ? { ...n, marks: { ...n.marks, underline: false } }
                      : n,
                  ),
                ),
              });
            else out.push(...inner);
            break;
          }
          case 'ins':
            report.note('Tracked changes were imported as accepted.');
            visit(c, marks);
            break;
          case 'del':
          case 'moveFrom':
            report.note('Tracked changes were imported as accepted.');
            break;
          case 'fldSimple': {
            const instr = attr(c, 'instr') ?? '';
            const m2 = /HYPERLINK\s+"([^"]+)"/.exec(instr);
            const saved = out.length;
            visit(c, marks);
            if (m2)
              out.push({
                type: 'link',
                href: m2[1]!,
                children: normalizeInlines(out.splice(saved)),
              });
            break;
          }
          case 'smartTag':
          case 'customXml':
          case 'sdt':
          case 'sdtContent':
          case 'moveTo':
            visit(c, marks);
            break;
          case 'commentRangeStart':
          case 'commentReference':
            report.note('Comments were not imported.');
            break;
          case 'oMath':
          case 'oMathPara':
            report.note('Word equations were imported as plain text.');
            emit({ type: 'text', text: textOf(c), marks });
            break;
        }
      }
    };
    visit(p, base);
    return normalizeInlines(out);
  };

  const body = kid(parseXml(docXml), 'body');
  if (!body) throw new Error('The Word document has no body.');

  type Flat =
    | {
        kind: 'para';
        style: StyleInfo[];
        num?: { id: string; level: number };
        inlines: Inline[];
        code: boolean;
        align?: string;
      }
    | { kind: 'table'; block: Block };

  const flat: Flat[] = [];
  const flatten = (container: XmlElement) => {
    for (const c of container.children) {
      if (!isEl(c)) continue;
      const name = local(c.name);
      if (name === 'p') {
        const pPr = kid(c, 'pPr');
        const styleId = attr(kid(pPr, 'pStyle'), 'val');
        const chain = styleChain(styleId);
        const numPr = kid(pPr, 'numPr');
        let numId = attr(kid(numPr, 'numId'), 'val') ?? chain.find((s) => s.numId)?.numId;
        if (numId === '0') numId = undefined;
        const level = Number(attr(kid(numPr, 'ilvl'), 'val') ?? 0);
        const inlines = inlinesOf(c);
        const textRuns = inlines.filter((i) => i.type === 'text');
        const code =
          chain.some((s) => s.mono || /code|preformatted|source/.test(s.name)) ||
          (textRuns.length > 0 &&
            textRuns.every((i) => i.type === 'text' && i.marks?.code) &&
            inlines.every((i) => i.type === 'text' || i.type === 'break'));
        flat.push({
          kind: 'para',
          style: chain,
          num: numId ? { id: numId, level } : undefined,
          inlines,
          code,
          align: attr(kid(pPr, 'jc'), 'val'),
        });
      } else if (name === 'tbl') flat.push({ kind: 'table', block: readTable(c) });
      else if (name === 'sdt') flatten(kid(c, 'sdtContent') ?? c);
      else if (name === 'customXml') flatten(c);
    }
  };

  const readTable = (tbl: XmlElement): Block => {
    const rows: TableCell[][] = [];
    const align: Extract<Block, { type: 'table' }>['align'] = [];
    for (const tr of kids(tbl, 'tr')) {
      const row: TableCell[] = [];
      for (const tc of kids(tr, 'tc')) {
        const tcPr = kid(tc, 'tcPr');
        const span = Number(attr(kid(tcPr, 'gridSpan'), 'val') ?? 1);
        const vMerge = kid(tcPr, 'vMerge');
        if (span > 1 || (vMerge && attr(vMerge, 'val') !== 'restart'))
          report.note('Merged table cells were split; the text stays in the first cell.');
        if (kids(tc, 'tbl').length)
          report.note('Tables inside table cells were flattened to text.');
        const paras = descendants(tc, 'p');
        const inl: Inline[] = [];
        paras.forEach((p, k) => {
          if (k) inl.push({ type: 'break' });
          inl.push(...inlinesOf(p));
          const jc = attr(kid(kid(p, 'pPr'), 'jc'), 'val');
          const col = row.length;
          if (rows.length === 0 && align[col] === undefined)
            align[col] =
              jc === 'center'
                ? 'center'
                : jc === 'right' || jc === 'end'
                  ? 'right'
                  : jc === 'left' || jc === 'start'
                    ? 'left'
                    : null;
        });
        while (inl[inl.length - 1]?.type === 'break') inl.pop();
        row.push({ inlines: normalizeInlines(inl) });
        for (let s = 1; s < span; s++) row.push({ inlines: [] });
      }
      rows.push(row);
    }
    report.keep('tables');
    const [header = [], ...rest] = rows;
    const cols = Math.max(header.length, ...rest.map((r) => r.length));
    return {
      type: 'table',
      align: Array.from({ length: cols }, (_, k) => align[k] ?? null),
      header,
      rows: rest,
    };
  };

  flatten(body);

  // Group flat paragraphs into blocks: code runs, lists by numbering, quotes, headings.
  const blocks: Block[] = [];
  let i = 0;
  const headingLevel = (chain: StyleInfo[]): number | null => {
    for (const s of chain) {
      if (s.name === 'title') return 1;
      const m = /^heading (\d)$/.exec(s.name);
      if (m) return Math.min(6, Number(m[1]));
      if (s.outline !== undefined && s.outline < 6) return s.outline + 1;
    }
    return null;
  };
  const isQuote = (chain: StyleInfo[]) => chain.some((s) => /quote/.test(s.name));

  const readList = (start: number): [Block, number] => {
    const first = flat[start] as Extract<Flat, { kind: 'para' }>;
    const baseLevel = first.num!.level;
    const levels = numbering.get(first.num!.id) ?? [];
    const lvl = levels[baseLevel] ?? { ordered: false, start: 1 };
    const items: ListItem[] = [];
    let k = start;
    while (k < flat.length) {
      const f = flat[k]!;
      if (f.kind !== 'para' || !f.num || f.num.level < baseLevel) break;
      if (
        f.num.level === baseLevel &&
        f.num.id !== first.num!.id &&
        (numbering.get(f.num.id)?.[baseLevel]?.ordered ?? false) !== lvl.ordered
      )
        break;
      if (f.num.level > baseLevel) {
        const [nested, next] = readList(k);
        const last = items[items.length - 1];
        if (last) last.blocks.push(nested);
        else items.push({ blocks: [nested] });
        k = next;
        continue;
      }
      let inl = f.inlines;
      let checked: boolean | undefined;
      const head = inl[0];
      if (head?.type === 'text') {
        const m = /^([☐☒☑✓✔]|\[[ xX]\])\s*/.exec(head.text);
        if (m) {
          checked = !/[☐]|\[ \]/.test(m[1]!);
          inl = [{ ...head, text: head.text.slice(m[0].length) }, ...inl.slice(1)];
        }
      }
      items.push({ checked, blocks: [{ type: 'paragraph', inlines: normalizeInlines(inl) }] });
      k++;
    }
    return [
      {
        type: 'list',
        ordered: lvl.ordered,
        start: lvl.ordered && lvl.start !== 1 ? lvl.start : undefined,
        items,
      },
      k,
    ];
  };

  while (i < flat.length) {
    const f = flat[i]!;
    if (f.kind === 'table') {
      blocks.push(f.block);
      i++;
      continue;
    }
    const level = headingLevel(f.style);
    if (f.num && level === null) {
      const [list, next] = readList(i);
      blocks.push(list);
      i = next;
      continue;
    }
    if (f.code && level === null) {
      const lines: string[] = [];
      while (i < flat.length) {
        const g = flat[i]!;
        if (g.kind !== 'para' || !g.code || g.num) break;
        lines.push(inlineText(g.inlines));
        i++;
      }
      while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
      blocks.push({ type: 'code', lang: '', text: lines.join('\n') });
      continue;
    }
    if (isQuote(f.style) && level === null) {
      const inner: Block[] = [];
      while (i < flat.length) {
        const g = flat[i]!;
        if (g.kind !== 'para' || !isQuote(g.style)) break;
        if (g.inlines.length) inner.push({ type: 'paragraph', inlines: g.inlines });
        i++;
      }
      blocks.push({ type: 'quote', blocks: inner });
      continue;
    }
    i++;
    const empty = !f.inlines.some((n) => n.type !== 'text' || n.text.trim());
    if (empty) continue;
    if (level !== null) {
      blocks.push({
        type: 'heading',
        level: level as 1 | 2 | 3 | 4 | 5 | 6,
        inlines: f.inlines.filter((n) => n.type !== 'break'),
      });
    } else blocks.push({ type: 'paragraph', inlines: f.inlines });
  }

  const ast: DocAst = { meta: readCore(pkg.text('docProps/core.xml')), blocks };
  describeAst(ast, report);
  report.kept.delete('tables');
  let tables = 0;
  for (const b of blocks) if (b.type === 'table') tables++;
  if (tables) report.keep('tables', tables);
  return { ast, media, report };
}
