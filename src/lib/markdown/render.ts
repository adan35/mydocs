import markdownIt, { type MarkdownIt, type Token } from 'markdown-it';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import katex from '@vscode/markdown-it-katex';
import hljs from 'highlight.js/lib/common';
import { uniqueSlugger } from '@/domain/outline';
import { stripFrontMatter, type FrontMatter } from '@/domain/frontmatter';
import { sanitizeHtml } from './sanitize';

/** Where an editable run of inline content lives in the source (for rich editing). */
export interface InlineSource {
  kind: 'heading' | 'paragraph' | 'item' | 'cell';
  /** 0-based first source line and the line after the last (whole document, front matter included). */
  line: number;
  end: number;
  /** The inline source as markdown-it read it (container prefixes removed). */
  content: string;
  /** Heading level. */
  level?: number;
  /** Table cell column. */
  col?: number;
  /** Rendered differently from its source (callout titles): edit as source instead. */
  sourceOnly?: boolean;
}

export interface RenderResult {
  html: string;
  frontMatter: FrontMatter | null;
  /** Editable inline runs, indexed by the elements' `data-inline` attribute. */
  inlines: InlineSource[];
}

interface Env {
  lineOffset?: number;
  inlines?: InlineSource[];
  [key: string]: unknown;
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const CALLOUT_KINDS = new Set([
  'note',
  'tip',
  'important',
  'warning',
  'caution',
  'info',
  'success',
  'question',
  'danger',
  'example',
  'quote',
  'abstract',
  'todo',
  'bug',
  'failure',
]);

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;

/** CommonJS plugins may arrive wrapped in `{ default }` depending on the bundler. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const plugin = <T>(mod: T): T => ((mod as any)?.default ?? mod) as T;

function createRenderer(): MarkdownIt {
  const md = markdownIt({
    html: true,
    linkify: true,
    typographer: false,
    breaks: false,
  });
  md.use(plugin(footnote));
  md.use(plugin(taskLists), { enabled: true, label: false });
  // An empty task ("- [ ]", e.g. from a template) is still a checkbox.
  md.core.ruler.before('github-task-lists', 'empty-tasks', (state) => {
    for (const t of state.tokens) {
      if (t.type !== 'inline' || !/^\[[ xX]\]$/.test(t.content)) continue;
      t.content += ' ';
      const first = t.children?.[0];
      if (first?.type === 'text') first.content += ' ';
    }
  });
  md.use(plugin(katex), {
    throwOnError: false,
    trust: false,
    strict: 'ignore',
    maxSize: 50,
    maxExpand: 500,
  } as never);

  // Annotate block tokens with their source lines so the preview can scroll-sync, jump to
  // headings, toggle task checkboxes and edit blocks in place. The line offset (front
  // matter) is added at render time.
  md.core.ruler.push('source_lines', (state) => {
    const offset = (state.env as Env).lineOffset ?? 0;
    for (const token of state.tokens) {
      if (!token.map || token.nesting < 0 || token.type === 'inline' || token.hidden) continue;
      token.attrSet('data-line', String(token.map[0] + offset));
      token.attrSet('data-line-end', String(token.map[1] + offset));
    }
  });

  // Remember each inline run's source before plugins rewrite it (task markers, callouts).
  md.core.ruler.after('block', 'inline_sources', (state) => {
    const offset = (state.env as Env).lineOffset ?? 0;
    const tokens = state.tokens;
    let col = 0;
    let rowMap: [number, number] | null = null;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      if (t.type === 'tr_open') {
        col = 0;
        rowMap = t.map;
      }
      // Table cells carry no line map of their own; their row's applies.
      const map = t.map ?? (tokens[i - 1]?.type.match(/^t[hd]_open$/) ? rowMap : null);
      if (t.type !== 'inline' || !map) continue;
      const parent = tokens[i - 1];
      if (!parent) continue;
      let kind: InlineSource['kind'] | null = null;
      let level: number | undefined;
      let cell: number | undefined;
      if (parent.type === 'heading_open') {
        kind = 'heading';
        level = Number(parent.tag.slice(1));
      } else if (parent.type === 'paragraph_open') {
        kind = parent.hidden ? 'item' : 'paragraph';
      } else if (parent.type === 'th_open' || parent.type === 'td_open') {
        kind = 'cell';
        cell = col++;
      }
      if (!kind) continue;
      t.meta = {
        ...(t.meta as object),
        source: {
          kind,
          line: map[0] + offset,
          end: map[1] + offset,
          content: t.content,
          level,
          col: cell,
        } satisfies InlineSource,
      };
    }
  });

  // Unique heading ids + an anchor link for sharing a section.
  md.core.ruler.push('heading_ids', (state) => {
    const slug = uniqueSlugger();
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      if (t.type !== 'heading_open') continue;
      const inline = tokens[i + 1];
      const text =
        inline?.children?.reduce(
          (acc: string, c: Token) =>
            acc + (c.type === 'text' || c.type === 'code_inline' ? c.content : ''),
          '',
        ) ?? '';
      const id = slug(text);
      // data-heading rather than id: ids can clobber DOM globals (e.g. "title"), so the sanitizer strips them.
      t.attrSet('data-heading', id);
      if (inline?.children) {
        const anchor = new state.Token('html_inline', '', 0);
        anchor.content = ` <a class="heading-anchor" href="#${escapeHtml(id)}" aria-label="Link to this section">#</a>`;
        inline.children.push(anchor);
      }
    }
  });

  // Callouts: a blockquote starting with [!NOTE], [!TIP], [!WARNING]… (GitHub and Obsidian syntax).
  md.core.ruler.push('callouts', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i]!.type !== 'blockquote_open') continue;
      const inline = tokens[i + 2];
      if (tokens[i + 1]?.type !== 'paragraph_open' || inline?.type !== 'inline') continue;
      const m = /^\[!([a-z]+)\][+-]?[ \t]*([^\n]*)/i.exec(inline.content);
      if (!m || !inline.children?.length) continue;
      const kind = m[1]!.toLowerCase();
      const title = m[2]!.trim() || kind[0]!.toUpperCase() + kind.slice(1);
      tokens[i]!.attrJoin('class', `callout callout-${CALLOUT_KINDS.has(kind) ? kind : 'note'}`);
      const source = (inline.meta as { source?: InlineSource } | null)?.source;
      if (source) source.sourceOnly = true;
      // The whole first line is the marker and title; the body starts after its line break.
      const children = inline.children!;
      const br = children.findIndex((c) => c.type === 'softbreak' || c.type === 'hardbreak');
      children.splice(0, br === -1 ? children.length : br + 1);
      const head = new state.Token('html_inline', '', 0);
      head.content = `<span class="callout-title">${escapeHtml(title)}</span>`;
      inline.children!.unshift(head);
    }
  });

  // [[Target]], [[Target#Section]] and [[Target|Label]] become links the preview resolves by name.
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
        ['class', 'wiki-link'],
        ['data-wiki', target],
      ];
      if (fragment) open.attrPush(['data-fragment', fragment]);
      state.push('text', '', 0).content = label;
      state.push('link_close', 'a', -1);
    }
    state.pos += m[0].length;
    return true;
  });

  // ![[image.png]] embeds an image found by name; ![[Note]] links to the note.
  md.inline.ruler.before('image', 'wikiembed', (state, silent) => {
    const src = state.src;
    const start = state.pos;
    if (src.charCodeAt(start) !== 0x21 || !src.startsWith('[[', start + 1)) return false;
    const m = /^!\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/.exec(src.slice(start));
    if (!m) return false;
    const target = m[1]!.trim();
    if (!IMAGE_EXT.test(target)) {
      // Not an image: drop the "!" and let the wiki link rule render a link to the note.
      state.pos += 1;
      return true;
    }
    if (!silent) {
      const alt = m[2]?.trim() && !/^\d+(x\d+)?$/.test(m[2].trim()) ? m[2].trim() : target;
      const token = state.push('html_inline', '', 0);
      token.content = `<img src="${escapeHtml(encodeURI(target))}" alt="${escapeHtml(alt)}" data-wiki="${escapeHtml(target)}">`;
    }
    state.pos += m[0].length;
    return true;
  });

  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx]!;
    const lang = String(token.info).trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    const line = token.attrGet('data-line');
    const end = token.attrGet('data-line-end');
    const lineAttr = line
      ? ` data-line="${escapeHtml(String(line))}" data-line-end="${escapeHtml(String(end))}"`
      : '';
    if (lang === 'mermaid') {
      // The diagram source lives in the code element; it's rendered lazily after sanitizing.
      return `<div class="mermaid-block"${lineAttr}><pre><code>${escapeHtml(token.content)}</code></pre></div>`;
    }
    let body: string;
    if (lang && hljs.getLanguage(lang)) {
      try {
        body = hljs.highlight(token.content, { language: lang, ignoreIllegals: true }).value;
      } catch {
        body = escapeHtml(token.content);
      }
    } else {
      body = escapeHtml(token.content);
    }
    const label = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '';
    return `<div class="code-block"${lineAttr}>${label}<pre><code class="hljs${lang ? ` language-${escapeHtml(lang)}` : ''}">${body}</code></pre></div>`;
  };

  // Tables scroll horizontally on narrow screens instead of overflowing the page.
  md.renderer.rules.table_open = (tokens, idx, options, _env, self) =>
    `<div class="table-wrap">${self.renderToken(tokens, idx, options)}`;
  md.renderer.rules.table_close = (tokens, idx, options, _env, self) =>
    `${self.renderToken(tokens, idx, options)}</div>`;

  // Tag each editable element with its inline run. In tight lists the paragraph is
  // hidden, so its text is wrapped in a span to give it an element of its own.
  md.core.ruler.push('rich_targets', (state) => {
    const env = state.env as Env;
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      const source = (t.meta as { source?: InlineSource } | null)?.source;
      if (t.type !== 'inline' || !source || !env.inlines) continue;
      const open = tokens[i - 1]!;
      const close = tokens[i + 1];
      if (open.hidden && close) {
        open.hidden = close.hidden = false;
        open.tag = close.tag = 'span';
        open.block = close.block = false;
        open.attrJoin('class', 'li-text');
      }
      open.attrSet('data-inline', String(env.inlines.length));
      env.inlines.push(source);
    }
  });

  return md;
}

let renderer: MarkdownIt | null = null;

/** Renders untrusted Markdown to sanitized HTML. */
export function renderMarkdown(src: string): RenderResult {
  renderer ??= createRenderer();
  const { body, data, lineOffset } = stripFrontMatter(src);
  const env: Env = { lineOffset, inlines: [] };
  let html: string;
  try {
    html = renderer.render(body, env as Record<string, unknown>);
  } catch (err) {
    console.error('Markdown render failed', err);
    html = `<pre>${escapeHtml(body)}</pre>`;
    env.inlines = [];
  }
  return { html: sanitizeHtml(html), frontMatter: data, inlines: env.inlines! };
}

/** Renders inline Markdown (one paragraph's content) to sanitized HTML, for comparisons. */
export function renderInlineMarkdown(src: string): string {
  renderer ??= createRenderer();
  return sanitizeHtml(renderer.renderInline(src, {}));
}

/** Parses Markdown into markdown-it tokens (used by format converters). */
export function parseMarkdownTokens(src: string): Token[] {
  renderer ??= createRenderer();
  return renderer.parse(src, { lineOffset: 0 });
}

/** Renders a plain-text file as a highlighted code block. */
export function renderCode(src: string, lang: string): string {
  let body = escapeHtml(src);
  if (lang && hljs.getLanguage(lang)) {
    try {
      body = hljs.highlight(src, { language: lang, ignoreIllegals: true }).value;
    } catch {
      /* fall back to escaped text */
    }
  }
  return sanitizeHtml(`<pre class="code-file"><code class="hljs">${body}</code></pre>`);
}
