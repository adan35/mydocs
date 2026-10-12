/**
 * HTML → document AST (import) and plain text ↔ AST.
 *
 * HTML is sanitized before it is read, scripts and styles never run, and elements with
 * no Markdown equivalent are reported. Reading needs DOMParser, so it runs on the main
 * thread; the result is plain data.
 */
import { sanitizeHtml } from '@/lib/markdown/sanitize';
import {
  ConversionReport,
  describeAst,
  normalizeInlines,
  type Align,
  type Block,
  type DocAst,
  type Inline,
  type ListItem,
  type Marks,
  type TableCell,
} from './doc-ast';

const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'SECTION',
  'ARTICLE',
  'MAIN',
  'HEADER',
  'FOOTER',
  'ASIDE',
  'NAV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'UL',
  'OL',
  'LI',
  'BLOCKQUOTE',
  'PRE',
  'TABLE',
  'HR',
  'FIGURE',
  'FIGCAPTION',
  'DL',
  'DT',
  'DD',
  'ADDRESS',
  'DETAILS',
  'SUMMARY',
]);

export function htmlToAst(html: string): { ast: DocAst; report: ConversionReport } {
  const report = new ConversionReport();
  const raw = new DOMParser().parseFromString(html, 'text/html');
  const title = raw.querySelector('title')?.textContent?.trim();
  const meta = (name: string) =>
    raw.querySelector(`meta[name="${name}"]`)?.getAttribute('content')?.trim() || undefined;
  if (raw.querySelector('script')) report.note('Scripts were removed.', 'info');
  if (raw.querySelector('form, input:not([type=checkbox]), select, textarea, button'))
    report.note('Forms and buttons were not imported.');
  if (raw.querySelector('iframe, video, audio, object, embed, canvas'))
    report.note('Embedded media (video, audio, frames) was not imported.');
  if (raw.querySelector('[style], style, link[rel=stylesheet]'))
    report.note('Colors, fonts and layout styling were not kept.', 'info');
  const doc = new DOMParser().parseFromString(
    `<body>${sanitizeHtml(raw.body.innerHTML)}</body>`,
    'text/html',
  );

  const inlines = (node: Node, marks: Marks = {}): Inline[] => {
    const out: Inline[] = [];
    for (const c of node.childNodes) {
      if (c.nodeType === Node.TEXT_NODE) {
        const t = (c.nodeValue ?? '').replace(/\s+/g, ' ');
        if (t) out.push({ type: 'text', text: t, marks: { ...marks } });
        continue;
      }
      if (!(c instanceof HTMLElement)) continue;
      const tag = c.tagName;
      if (BLOCK_TAGS.has(tag)) {
        // A block inside an inline context (e.g. <div> in <li>): keep its text on a new line.
        if (out.length) out.push({ type: 'break' });
        out.push(...inlines(c, marks));
        continue;
      }
      switch (tag) {
        case 'B':
        case 'STRONG':
          out.push(...inlines(c, { ...marks, bold: true }));
          break;
        case 'I':
        case 'EM':
        case 'CITE':
        case 'DFN':
          out.push(...inlines(c, { ...marks, italic: true }));
          break;
        case 'S':
        case 'DEL':
        case 'STRIKE':
          out.push(...inlines(c, { ...marks, strike: true }));
          break;
        case 'U':
        case 'INS':
          out.push(...inlines(c, { ...marks, underline: true }));
          break;
        case 'SUP':
          out.push(...inlines(c, { ...marks, sup: true }));
          break;
        case 'SUB':
          out.push(...inlines(c, { ...marks, sub: true }));
          break;
        case 'CODE':
        case 'KBD':
        case 'SAMP':
        case 'TT':
          out.push({ type: 'text', text: c.textContent ?? '', marks: { ...marks, code: true } });
          break;
        case 'BR':
          out.push({ type: 'break' });
          break;
        case 'A': {
          const href = c.getAttribute('href') ?? '';
          const children = inlines(c, marks);
          if (href && !/^javascript:/i.test(href))
            out.push({
              type: 'link',
              href,
              title: c.getAttribute('title') ?? undefined,
              children: normalizeInlines(children),
            });
          else out.push(...children);
          break;
        }
        case 'IMG': {
          const src = c.getAttribute('src') ?? '';
          if (src)
            out.push({
              type: 'image',
              src,
              alt: c.getAttribute('alt') ?? '',
              title: c.getAttribute('title') ?? undefined,
            });
          break;
        }
        case 'INPUT':
          break;
        default:
          out.push(...inlines(c, marks));
      }
    }
    return out;
  };

  const trim = (inl: Inline[]): Inline[] => {
    const n = normalizeInlines(inl);
    const first = n[0];
    if (first?.type === 'text') n[0] = { ...first, text: first.text.replace(/^\s+/, '') };
    const last = n[n.length - 1];
    if (last?.type === 'text') n[n.length - 1] = { ...last, text: last.text.replace(/\s+$/, '') };
    while (n[0]?.type === 'break') n.shift();
    while (n[n.length - 1]?.type === 'break') n.pop();
    return normalizeInlines(n);
  };

  const blocks = (node: Node): Block[] => {
    const out: Block[] = [];
    let pending: Inline[] = [];
    const flush = () => {
      const t = trim(pending);
      if (t.some((i) => i.type !== 'text' || i.text.trim()))
        out.push({ type: 'paragraph', inlines: t });
      pending = [];
    };
    for (const c of node.childNodes) {
      if (!(c instanceof HTMLElement)) {
        if (c.nodeType === Node.TEXT_NODE)
          pending.push(...inlines({ childNodes: [c] } as unknown as Node));
        continue;
      }
      const tag = c.tagName;
      if (!BLOCK_TAGS.has(tag)) {
        pending.push(...inlines({ childNodes: [c] } as unknown as Node));
        continue;
      }
      flush();
      switch (tag) {
        case 'H1':
        case 'H2':
        case 'H3':
        case 'H4':
        case 'H5':
        case 'H6':
          out.push({
            type: 'heading',
            level: Number(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6,
            inlines: trim(inlines(c)).filter((i) => i.type !== 'break'),
          });
          break;
        case 'P':
        case 'ADDRESS':
        case 'FIGCAPTION':
        case 'DT':
        case 'DD':
        case 'SUMMARY':
          out.push({ type: 'paragraph', inlines: trim(inlines(c)) });
          break;
        case 'UL':
        case 'OL': {
          const items: ListItem[] = [];
          for (const li of c.children) {
            if (li.tagName !== 'LI') continue;
            const box = li.querySelector(
              ':scope > input[type=checkbox], :scope > p > input[type=checkbox]',
            ) as HTMLInputElement | null;
            const item: ListItem = { blocks: blocks(li) };
            if (box) item.checked = box.hasAttribute('checked');
            if (!item.blocks.length) item.blocks.push({ type: 'paragraph', inlines: [] });
            items.push(item);
          }
          const start = tag === 'OL' ? Number(c.getAttribute('start') ?? 1) : undefined;
          out.push({
            type: 'list',
            ordered: tag === 'OL',
            start: start && start !== 1 ? start : undefined,
            items,
          });
          break;
        }
        case 'BLOCKQUOTE':
          out.push({ type: 'quote', blocks: blocks(c) });
          break;
        case 'PRE': {
          const code = c.querySelector('code');
          const lang = /language-([\w+-]+)/.exec(code?.className ?? '')?.[1] ?? '';
          out.push({ type: 'code', lang, text: (c.textContent ?? '').replace(/\n$/, '') });
          break;
        }
        case 'HR':
          out.push({ type: 'rule' });
          break;
        case 'TABLE':
          out.push(table(c as HTMLTableElement));
          break;
        default:
          out.push(...blocks(c));
      }
    }
    flush();
    return out;
  };

  const table = (t: HTMLTableElement): Block => {
    const rows = [...t.rows];
    const cellsOf = (r: HTMLTableRowElement): TableCell[] => {
      const out: TableCell[] = [];
      for (const cell of r.cells) {
        if (cell.colSpan > 1 || cell.rowSpan > 1)
          report.note('Merged table cells were split; the text stays in the first cell.');
        if (cell.querySelector('table, ul, ol, pre'))
          report.note('Lists and tables inside table cells were flattened to text.');
        out.push({ inlines: trim(inlines(cell)) });
        for (let k = 1; k < cell.colSpan; k++) out.push({ inlines: [] });
      }
      return out;
    };
    const first = rows[0];
    const header = first ? cellsOf(first) : [];
    const align: Align[] = first
      ? [...first.cells].map((c) => {
          const a = (c.getAttribute('align') ?? c.style.textAlign ?? '').toLowerCase();
          return a === 'center' || a === 'right' || a === 'left' ? a : null;
        })
      : [];
    return { type: 'table', align, header, rows: rows.slice(1).map(cellsOf) };
  };

  const ast: DocAst = {
    meta: {
      title,
      author: meta('author'),
      subject: meta('description'),
      keywords: meta('keywords')?.split(/,\s*/),
    },
    blocks: blocks(doc.body),
  };
  if (!ast.meta.keywords) delete ast.meta.keywords;
  for (const k of ['title', 'author', 'subject'] as const) if (!ast.meta[k]) delete ast.meta[k];
  describeAst(ast, report);
  return { ast, report };
}

/** Plain text → AST: blank lines separate paragraphs; single newlines are kept as breaks. */
export function textToAst(text: string): DocAst {
  const paras = text.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  return {
    meta: {},
    blocks: paras
      .filter((p) => p.trim())
      .map((p) => ({
        type: 'paragraph' as const,
        inlines: p
          .split('\n')
          .flatMap((line, i): Inline[] =>
            i ? [{ type: 'break' }, { type: 'text', text: line }] : [{ type: 'text', text: line }],
          ),
      })),
  };
}
