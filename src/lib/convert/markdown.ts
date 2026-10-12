/**
 * Markdown ↔ document AST.
 *
 * Reading uses its own markdown-it instance (no preview-only rules such as heading
 * anchors or callout titles), so the AST holds what the author wrote. Writing produces
 * plain CommonMark + GFM that the preview, GitHub and Obsidian all read the same way.
 */
import markdownIt, { type Token } from 'markdown-it';
import katex from '@vscode/markdown-it-katex';
import { stripFrontMatter, withFrontMatter, type FrontMatter } from '@/domain/frontmatter';
import {
  normalizeInlines,
  type Align,
  type Block,
  type DocAst,
  type DocMeta,
  type Inline,
  type ListItem,
  type Marks,
  type TableCell,
} from './doc-ast';

let md: ReturnType<typeof markdownIt> | null = null;

/** CommonJS plugins may arrive wrapped in `{ default }` depending on the bundler. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const plugin = <T>(mod: T): T => ((mod as any)?.default ?? mod) as T;

function parser() {
  if (md) return md;
  md = markdownIt({ html: true, linkify: true });
  md.use(plugin(katex));
  // [[Target|Label]] → a link to Target.md, the way the app resolves it.
  md.inline.ruler.before('link', 'wikilink', (state, silent) => {
    const src = state.src;
    const start = state.pos;
    if (src.charCodeAt(start) !== 0x5b || src.charCodeAt(start + 1) !== 0x5b) return false;
    const m = /^\[\[([^\]|#\n]+)(#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/.exec(src.slice(start));
    if (!m) return false;
    const target = m[1]!.trim();
    if (!target) return false;
    if (!silent) {
      const fragment = m[2]?.slice(1).trim();
      const label = m[3]?.trim() || (fragment ? `${target} › ${fragment}` : target);
      const file = /\.[a-z0-9]+$/i.test(target) ? target : `${target}.md`;
      const open = state.push('link_open', 'a', 1);
      open.attrs = [
        ['href', encodeURI(file) + (fragment ? `#${encodeURIComponent(fragment)}` : '')],
        ['data-wiki', target],
      ];
      state.push('text', '', 0).content = label;
      state.push('link_close', 'a', -1);
    }
    state.pos += m[0].length;
    return true;
  });
  // ![[image.png]] embeds an image found by name in the workspace.
  md.inline.ruler.before('image', 'wikiembed', (state, silent) => {
    const src = state.src;
    const start = state.pos;
    if (src.charCodeAt(start) !== 0x21 || !src.startsWith('[[', start + 1)) return false;
    const m = /^!\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/.exec(src.slice(start));
    if (!m) return false;
    if (!/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(m[1]!.trim())) {
      // ![[Note]] links to the note, as in the preview.
      state.pos += 1;
      return true;
    }
    if (!silent) {
      const t = state.push('wiki_image', '', 0);
      t.content = m[1]!.trim();
      t.info = m[2]?.trim() ?? '';
    }
    state.pos += m[0].length;
    return true;
  });
  return md;
}

/** Image sources written as ![[name]] carry this prefix in the AST. */
export const WIKI_IMAGE = 'wiki:';

function metaFrom(data: FrontMatter | null): DocMeta {
  if (!data) return {};
  const meta: DocMeta = {};
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === 'title' || k === 'author' || k === 'subject') meta[k] = String(v);
    else if (k === 'keywords' || k === 'tags')
      meta.keywords = [
        ...(meta.keywords ?? []),
        ...(Array.isArray(v) ? v.map(String) : String(v).split(/,\s*/)),
      ];
    else if (k === 'created' || k === 'modified' || k === 'date')
      meta[k === 'date' ? 'created' : k] = v instanceof Date ? v.toISOString() : String(v);
    else extra[k] = v;
  }
  if (Object.keys(extra).length) meta.extra = extra;
  return meta;
}

/** Parses Markdown into the document AST. */
export function markdownToAst(src: string): DocAst {
  const { body, data } = stripFrontMatter(src);
  const tokens = parser().parse(body, {});
  const attr = (t: Token, name: string) => {
    const v = t.attrGet(name);
    return v === null ? undefined : String(v);
  };
  let i = 0;

  const inlines = (children: Token[] | null): Inline[] => {
    const out: Inline[] = [];
    const marks: Marks = {};
    const stack: { href: string; title?: string; children: Inline[] }[] = [];
    const push = (n: Inline) => (stack.length ? stack[stack.length - 1]!.children : out).push(n);
    for (const t of children ?? []) {
      switch (t.type) {
        case 'text':
          push({ type: 'text', text: t.content, marks: { ...marks } });
          break;
        case 'code_inline':
          push({ type: 'text', text: t.content, marks: { ...marks, code: true } });
          break;
        case 'softbreak':
          push({ type: 'text', text: ' ', marks: { ...marks } });
          break;
        case 'hardbreak':
          push({ type: 'break' });
          break;
        case 'strong_open':
          marks.bold = true;
          break;
        case 'strong_close':
          marks.bold = false;
          break;
        case 'em_open':
          marks.italic = true;
          break;
        case 'em_close':
          marks.italic = false;
          break;
        case 's_open':
          marks.strike = true;
          break;
        case 's_close':
          marks.strike = false;
          break;
        case 'link_open':
          stack.push({ href: attr(t, 'href') ?? '', title: attr(t, 'title'), children: [] });
          break;
        case 'link_close': {
          const l = stack.pop();
          if (l)
            push({
              type: 'link',
              href: l.href,
              title: l.title,
              children: normalizeInlines(l.children),
            });
          break;
        }
        case 'image':
          push({
            type: 'image',
            src: attr(t, 'src') ?? '',
            alt: t.children?.map((c) => c.content).join('') ?? t.content,
            title: attr(t, 'title'),
          });
          break;
        case 'math_inline':
          push({ type: 'math', tex: t.content });
          break;
        case 'wiki_image':
          push({
            type: 'image',
            src: WIKI_IMAGE + t.content,
            alt: t.info && !/^\d+(x\d+)?$/.test(t.info) ? t.info : t.content,
          });
          break;
        case 'html_inline': {
          const tagMatch = /^<(\/?)(u|ins|sup|sub|kbd|mark)>$/i.exec(t.content.trim());
          if (tagMatch) {
            const name = tagMatch[2]!.toLowerCase();
            const on = !tagMatch[1];
            if (name === 'u' || name === 'ins') marks.underline = on;
            else if (name === 'sup') marks.sup = on;
            else if (name === 'sub') marks.sub = on;
            else if (name === 'kbd') marks.code = on;
            break;
          }
          if (/^<br\s*\/?>$/i.test(t.content.trim())) push({ type: 'break' });
          else push({ type: 'text', text: t.content, marks: { ...marks } });
          break;
        }
        default:
          if (t.content) push({ type: 'text', text: t.content, marks: { ...marks } });
      }
    }
    return normalizeInlines(out);
  };

  const blocks = (until: string | null): Block[] => {
    const out: Block[] = [];
    while (i < tokens.length) {
      const t = tokens[i]!;
      if (until && t.type === until) {
        i++;
        return out;
      }
      switch (t.type) {
        case 'heading_open': {
          const level = Number(t.tag.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6;
          out.push({ type: 'heading', level, inlines: inlines(tokens[i + 1]!.children) });
          i += 3;
          break;
        }
        case 'paragraph_open': {
          out.push({ type: 'paragraph', inlines: inlines(tokens[i + 1]!.children) });
          i += 3;
          break;
        }
        case 'bullet_list_open':
        case 'ordered_list_open': {
          const ordered = t.type === 'ordered_list_open';
          const start = ordered ? Number(t.attrGet('start') ?? 1) : undefined;
          const close = ordered ? 'ordered_list_close' : 'bullet_list_close';
          i++;
          const items: ListItem[] = [];
          while (i < tokens.length && tokens[i]!.type !== close) {
            if (tokens[i]!.type === 'list_item_open') {
              i++;
              const itemBlocks = blocks('list_item_close');
              const item: ListItem = { blocks: itemBlocks };
              const first = itemBlocks[0];
              const head = first?.type === 'paragraph' ? first.inlines[0] : undefined;
              const m = head?.type === 'text' ? /^\[([ xX])\]\s/.exec(head.text) : null;
              if (m && first?.type === 'paragraph' && head?.type === 'text') {
                item.checked = m[1] !== ' ';
                first.inlines[0] = { ...head, text: head.text.slice(m[0].length) };
              }
              items.push(item);
            } else i++;
          }
          i++;
          out.push({ type: 'list', ordered, start: start !== 1 ? start : undefined, items });
          break;
        }
        case 'blockquote_open':
          i++;
          out.push({ type: 'quote', blocks: blocks('blockquote_close') });
          break;
        case 'fence':
        case 'code_block':
          out.push({
            type: 'code',
            lang: t.info.trim().split(/\s+/)[0] ?? '',
            text: t.content.replace(/\n$/, ''),
          });
          i++;
          break;
        case 'math_block':
          out.push({ type: 'math', tex: t.content.trim() });
          i++;
          break;
        case 'hr':
          out.push({ type: 'rule' });
          i++;
          break;
        case 'html_block':
          out.push({ type: 'raw', format: 'html', text: t.content.replace(/\n$/, '') });
          i++;
          break;
        case 'table_open': {
          i++;
          const align: Align[] = [];
          let header: TableCell[] = [];
          const rows: TableCell[][] = [];
          let row: TableCell[] = [];
          let inHead = false;
          while (i < tokens.length && tokens[i]!.type !== 'table_close') {
            const c = tokens[i]!;
            if (c.type === 'thead_open') inHead = true;
            else if (c.type === 'thead_close') inHead = false;
            else if (c.type === 'tr_open') row = [];
            else if (c.type === 'tr_close') {
              if (inHead) header = row;
              else rows.push(row);
            } else if (c.type === 'th_open' || c.type === 'td_open') {
              if (inHead) {
                const style = attr(c, 'style') ?? '';
                const m = /text-align:\s*(left|center|right)/.exec(style);
                align.push((m?.[1] as Align) ?? null);
              }
              row.push({ inlines: inlines(tokens[i + 1]!.children) });
              i += 2;
            }
            i++;
          }
          i++;
          out.push({ type: 'table', align, header, rows });
          break;
        }
        default:
          i++;
      }
    }
    return out;
  };

  return { meta: metaFrom(data), blocks: blocks(null) };
}

// ------------------------------------------------------------------ writing

function escapeMd(text: string, atStart: boolean): string {
  let s = text.replace(/[\\`*_[\]<]/g, '\\$&');
  if (atStart) s = s.replace(/^(\s*)([#>+-]|\d+[.)])(?=\s)/, '$1\\$2');
  return s;
}

function inlineMd(inl: Inline[], opts: { cell?: boolean } = {}): string {
  let out = '';
  for (const n of inl) {
    if (n.type === 'text') {
      const m = n.marks ?? {};
      let t: string;
      if (m.code) {
        const ticks = Math.max(0, ...(n.text.match(/`+/g) ?? []).map((r) => r.length)) + 1;
        const f = '`'.repeat(ticks);
        const pad = n.text.startsWith('`') || n.text.endsWith('`') ? ' ' : '';
        t = `${f}${pad}${n.text}${pad}${f}`;
      } else t = escapeMd(n.text, out === '' || out.endsWith('\n'));
      if (!m.code && t.trim()) {
        const lead = t.match(/^\s*/)![0];
        const trail = t.match(/\s*$/)![0];
        let core = t.trim();
        if (m.bold) core = `**${core}**`;
        if (m.italic) core = `*${core}*`;
        if (m.strike) core = `~~${core}~~`;
        if (m.underline) core = `<u>${core}</u>`;
        if (m.sup) core = `<sup>${core}</sup>`;
        if (m.sub) core = `<sub>${core}</sub>`;
        t = lead + core + trail;
      }
      out += t;
    } else if (n.type === 'link') {
      const label = inlineMd(n.children, opts);
      const dest = /[\s()<>]/.test(n.href) ? `<${n.href}>` : n.href;
      out += `[${label}](${dest}${n.title ? ` "${n.title.replace(/"/g, '\\"')}"` : ''})`;
    } else if (n.type === 'image' && n.src.startsWith(WIKI_IMAGE)) {
      const target = n.src.slice(WIKI_IMAGE.length);
      out += `![[${target}${n.alt && n.alt !== target ? `|${n.alt}` : ''}]]`;
    } else if (n.type === 'image') {
      const dest = /[\s()<>]/.test(n.src) ? `<${n.src}>` : n.src;
      out += `![${escapeMd(n.alt, false)}](${dest}${n.title ? ` "${n.title.replace(/"/g, '\\"')}"` : ''})`;
    } else if (n.type === 'break') out += opts.cell ? '<br>' : '\\\n';
    else if (n.type === 'math') out += `$${n.tex}$`;
  }
  if (opts.cell) out = out.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return out;
}

function blocksMd(blocks: Block[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
        parts.push(`${'#'.repeat(b.level)} ${inlineMd(b.inlines).replace(/\\\n/g, ' ')}`);
        break;
      case 'paragraph': {
        const text = inlineMd(b.inlines);
        if (text.trim()) parts.push(text);
        break;
      }
      case 'list': {
        // Tight unless an item holds more than one paragraph-like block.
        const tight = b.items.every((it) => it.blocks.filter((x) => x.type !== 'list').length <= 1);
        const items = b.items.map((item, n) => {
          const marker = b.ordered ? `${(b.start ?? 1) + n}.` : '-';
          const task = item.checked === undefined ? '' : item.checked ? '[x] ' : '[ ] ';
          let body = blocksMd(item.blocks);
          if (tight) body = body.replace(/\n\n(?=\s*([-*+]|\d+[.)]) )/g, '\n');
          const indent = ' '.repeat(marker.length + 1);
          const [first = '', ...rest] = body.split('\n');
          return [`${marker} ${task}${first}`, ...rest.map((l) => (l ? indent + l : ''))].join(
            '\n',
          );
        });
        parts.push(items.join(tight ? '\n' : '\n\n'));
        break;
      }
      case 'quote':
        parts.push(
          blocksMd(b.blocks)
            .split('\n')
            .map((l) => (l ? `> ${l}` : '>'))
            .join('\n'),
        );
        break;
      case 'code': {
        const ticks = Math.max(2, ...(b.text.match(/^`+/gm) ?? []).map((r) => r.length)) + 1;
        const f = '`'.repeat(ticks);
        parts.push(`${f}${b.lang}\n${b.text}\n${f}`);
        break;
      }
      case 'math':
        parts.push(`$$\n${b.tex}\n$$`);
        break;
      case 'rule':
        parts.push('---');
        break;
      case 'raw':
        parts.push(b.text);
        break;
      case 'table': {
        const cols = Math.max(b.header.length, ...b.rows.map((r) => r.length), 1);
        const cell = (c: TableCell | undefined) =>
          inlineMd(c?.inlines ?? [], { cell: true }) || ' ';
        const row = (r: TableCell[]) =>
          `| ${Array.from({ length: cols }, (_, k) => cell(r[k])).join(' | ')} |`;
        const sep = Array.from({ length: cols }, (_, k) => {
          const a = b.align[k];
          return a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---';
        });
        parts.push([row(b.header), `| ${sep.join(' | ')} |`, ...b.rows.map(row)].join('\n'));
        break;
      }
    }
  }
  return parts.join('\n\n');
}

function frontMatterOf(meta: DocMeta): FrontMatter {
  const fm: FrontMatter = {};
  if (meta.title) fm.title = meta.title;
  if (meta.author) fm.author = meta.author;
  if (meta.subject) fm.subject = meta.subject;
  if (meta.keywords?.length) fm.tags = meta.keywords;
  if (meta.created) fm.created = meta.created;
  if (meta.modified) fm.modified = meta.modified;
  return { ...fm, ...meta.extra };
}

/** Writes the AST as Markdown, with metadata as YAML front matter. */
export function astToMarkdown(ast: DocAst): string {
  const body = blocksMd(ast.blocks) + '\n';
  const fm = frontMatterOf(ast.meta);
  return Object.keys(fm).length ? withFrontMatter(body, fm) : body;
}

export { inlineMd as inlinesToMarkdown };
