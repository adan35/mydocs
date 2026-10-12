/**
 * Serializes rich-edited preview content back to inline Markdown.
 *
 * Only a small, explicit set of elements is understood: text, bold, italic,
 * strikethrough, inline code, links, wiki links, images, math, line breaks and a few
 * harmless inline HTML tags. Anything else makes `canSerialize` false, and the block
 * is edited as source instead, so unsupported syntax is never silently dropped.
 */

const SIMPLE_HTML = new Set(['KBD', 'MARK', 'SUB', 'SUP', 'U', 'INS', 'SMALL', 'ABBR']);

export interface SerializeOptions {
  /** Headings and table cells hold one line; newlines become spaces. */
  singleLine?: boolean;
  /** Table cells: pipes must be escaped. */
  cell?: boolean;
}

export class UnsupportedContent extends Error {
  override name = 'UnsupportedContent';
}

/** Escapes characters that would otherwise start Markdown syntax. */
export function escapeText(text: string, opts: SerializeOptions = {}, atStart = false): string {
  let out = text.replace(/[\\`*[\]]/g, '\\$&');
  // These only start syntax in some positions; escaping them elsewhere is noise.
  out = out.replace(/<(?=[A-Za-z/!?])/g, '\\<');
  if ((text.match(/\$/g) ?? []).length > 1) out = out.replace(/\$/g, '\\$');
  out = out.replace(/~~/g, '\\~\\~');
  // Underscores only matter at word boundaries ("snake_case" is fine).
  out = out.replace(/(^|[^\p{L}\p{N}])_|_(?=$|[^\p{L}\p{N}])/gu, (m) => m.replace('_', '\\_'));
  if (opts.cell) out = out.replace(/\|/g, '\\|');
  if (atStart) {
    // Line-start syntax: headings, quotes, list markers, thematic breaks.
    out = out.replace(/^(\s*)(#{1,6}(?=\s|$)|>|[-+](?=\s)|\d+(?=[.)]\s)|=+\s*$)/, (_m, sp, mk) =>
      /^\d/.test(mk) ? `${sp}${mk}\\` : `${sp}\\${mk}`,
    );
  }
  return out;
}

function codeSpan(text: string): string {
  const runs = text.match(/`+/g) ?? [];
  const n = Math.max(0, ...runs.map((r) => r.length)) + 1;
  const fence = '`'.repeat(n);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

function linkDestination(href: string): string {
  return /[\s()<>]/.test(href) ? `<${href.replace(/[<>]/g, encodeURIComponent)}>` : href;
}

function titlePart(el: Element): string {
  const t = el.getAttribute('title');
  return t && !el.classList.contains('link-broken') ? ` "${t.replace(/"/g, '\\"')}"` : '';
}

/** Serializes the children of `root` to inline Markdown. Throws `UnsupportedContent`. */
export function serializeInline(root: Node, opts: SerializeOptions = {}): string {
  let out = '';
  const atLineStart = () => out === '' || out.endsWith('\n');
  const visit = (node: Node, marks: { code?: boolean }) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue ?? '';
      if (marks.code) {
        out += text;
        return;
      }
      // Escape line by line so line-start syntax is caught after each break.
      const parts = text.split('\n');
      parts.forEach((part, i) => {
        if (i > 0) out += '\n';
        out += escapeText(part, opts, atLineStart());
      });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName;
    if (el.classList.contains('heading-anchor') || el.dataset.richSkip !== undefined) return;
    if (tag === 'INPUT') return; // the task checkbox; its marker stays in the source
    const inner = () => {
      const saved = out;
      out = '';
      for (const c of el.childNodes) visit(c, marks);
      const r = out;
      out = saved;
      return r;
    };
    const wrap = (mark: string) => {
      const body = inner();
      if (!body.trim()) {
        out += body;
        return;
      }
      // Markers can't sit next to whitespace: keep it outside.
      const lead = body.match(/^\s*/)![0];
      const trail = body.match(/\s*$/)![0];
      out += `${lead}${mark}${body.trim()}${mark}${trail}`;
    };
    switch (tag) {
      case 'STRONG':
      case 'B':
        return wrap('**');
      case 'EM':
      case 'I':
        return wrap('*');
      case 'S':
      case 'DEL':
      case 'STRIKE':
        return wrap('~~');
      case 'CODE':
        out += codeSpan(el.textContent ?? '');
        return;
      case 'BR':
        out += opts.singleLine ? ' ' : '\\\n';
        return;
      case 'A': {
        if (el.dataset.wiki !== undefined) {
          const target = el.dataset.wiki;
          const fragment = el.dataset.fragment;
          const label = el.textContent ?? '';
          const auto = fragment ? `${target} › ${fragment}` : target;
          out += `[[${target}${fragment ? `#${fragment}` : ''}${label && label !== auto ? `|${label}` : ''}]]`;
          return;
        }
        const href = el.getAttribute('href') ?? '';
        const text = el.textContent ?? '';
        // Autolinks (bare URLs) stay bare.
        if (text === href || `mailto:${text}` === href) {
          out += text;
          return;
        }
        out += `[${inner()}](${linkDestination(href)}${titlePart(el)})`;
        return;
      }
      case 'IMG': {
        const img = el as HTMLImageElement;
        if (img.dataset.wiki !== undefined) {
          out += `![[${img.dataset.wiki}]]`;
          return;
        }
        const src = img.dataset.src ?? img.getAttribute('src') ?? '';
        const alt = img.classList.contains('img-missing') ? (img.dataset.alt ?? '') : img.alt;
        out += `![${escapeText(alt)}](${linkDestination(src)}${titlePart(el)})`;
        return;
      }
      case 'SPAN':
      case 'FONT':
      case 'DIV':
      case 'P': {
        if (el.classList.contains('katex') || el.classList.contains('katex-display')) {
          const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
          if (tex === undefined || tex === null) throw new UnsupportedContent('math');
          const display = el.classList.contains('katex-display') || !!el.closest('.katex-display');
          out += display ? `$$${tex}$$` : `$${tex}$`;
          return;
        }
        if (el.classList.contains('katex-display')) return;
        // Browsers wrap new lines in <div> or <p> while editing.
        if ((tag === 'DIV' || tag === 'P') && out && !out.endsWith('\n'))
          out += opts.singleLine ? ' ' : '\n';
        for (const c of el.childNodes) visit(c, marks);
        return;
      }
      default:
        if (SIMPLE_HTML.has(tag)) {
          const t = tag.toLowerCase();
          out += `<${t}>${inner()}</${t}>`;
          return;
        }
        throw new UnsupportedContent(tag.toLowerCase());
    }
  };
  for (const c of root.childNodes) visit(c, {});
  if (opts.singleLine) out = out.replace(/\s*\n\s*/g, ' ');
  // Trailing hard breaks and spaces are invisible and unstable; drop them.
  return out.replace(/(\\\n|\s)+$/, '').replace(/^\s+/, '');
}

/** Whether `root` can be serialized at all. */
export function canSerialize(root: Node, opts: SerializeOptions = {}): boolean {
  try {
    serializeInline(root, opts);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ caret helpers

/** The caret position inside `root` as a character offset into its text. */
export function caretOffset(root: HTMLElement): number | null {
  const sel = getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.endContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.endContainer, range.endOffset);
  return pre.toString().length;
}

/** Puts the caret at a character offset inside `root` (the end when past it). */
export function setCaretOffset(root: HTMLElement, offset: number) {
  const sel = getSelection();
  if (!sel) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let left = offset;
  let node = walker.nextNode() as Text | null;
  let last: Text | null = null;
  while (node) {
    const len = node.nodeValue?.length ?? 0;
    if (left <= len) {
      sel.collapse(node, left);
      return;
    }
    left -= len;
    last = node;
    node = walker.nextNode() as Text | null;
  }
  if (last) sel.collapse(last, last.nodeValue?.length ?? 0);
  else sel.collapse(root, root.childNodes.length);
}
