import type { EditorView } from '@codemirror/view';
import {
  snippet,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { extractHeadings } from '@/domain/outline';
import { isoDate } from '@/domain/templates';
import { syntaxTree } from '@codemirror/language';
import { fuzzyScore } from '../components/fuzzy';
import { insertTable } from './commands';

interface SlashItem {
  label: string;
  detail: string;
  keywords?: string;
  /** Block items start on their own line. */
  block?: boolean;
  /** A CodeMirror snippet (`${}` marks fields, `#{}` an empty one), or a function returning one. */
  template: string | ((view: EditorView) => string);
  /** Runs instead of inserting a template (opens the table editor). */
  action?: (view: EditorView) => void;
  /** Opens another completion after inserting (wiki link targets). */
  chain?: boolean;
}

const time = () => new Date().toTimeString().slice(0, 5);

/** Escapes text for use inside a snippet template. */
const literal = (s: string) => s.replace(/[$#{}\\]/g, (c) => `\\${c}`);

function tableOfContents(view: EditorView): string {
  const headings = extractHeadings(view.state.doc.toString());
  if (!headings.length) return '<!-- Add headings (# Title) and run /toc again -->';
  const min = Math.min(...headings.map((h) => h.level));
  return headings
    .map((h) => `${'  '.repeat(h.level - min)}- [${literal(h.text)}](#${literal(h.slug)})`)
    .join('\n');
}

export const SLASH_ITEMS: SlashItem[] = [
  {
    label: 'Heading 1',
    detail: '# Big section heading',
    keywords: 'h1 title',
    block: true,
    template: '# ${Heading}',
  },
  {
    label: 'Heading 2',
    detail: '## Medium heading',
    keywords: 'h2 subtitle',
    block: true,
    template: '## ${Heading}',
  },
  {
    label: 'Heading 3',
    detail: '### Small heading',
    keywords: 'h3',
    block: true,
    template: '### ${Heading}',
  },
  {
    label: 'Bulleted list',
    detail: '- Item',
    keywords: 'ul unordered bullet',
    block: true,
    template: '- ${}',
  },
  {
    label: 'Numbered list',
    detail: '1. Item',
    keywords: 'ol ordered',
    block: true,
    template: '1. ${}',
  },
  {
    label: 'Checklist',
    detail: '- [ ] Task',
    keywords: 'todo task checkbox',
    block: true,
    template: '- [ ] ${}',
  },
  {
    label: 'Quote',
    detail: '> Quoted text',
    keywords: 'blockquote citation',
    block: true,
    template: '> ${}',
  },
  {
    label: 'Callout',
    detail: '> [!NOTE] Highlighted note',
    keywords: 'admonition note tip warning info',
    block: true,
    template: '> [!NOTE] ${Title}\n> ${}',
  },
  {
    label: 'Warning callout',
    detail: '> [!WARNING]',
    keywords: 'admonition caution',
    block: true,
    template: '> [!WARNING] ${Title}\n> ${}',
  },
  {
    label: 'Divider',
    detail: '--- Horizontal rule',
    keywords: 'hr separator line',
    block: true,
    template: '---\n${}',
  },
  {
    label: 'Code block',
    detail: '```lang … ```',
    keywords: 'fence snippet pre',
    block: true,
    template: '```${language}\n${}\n```',
  },
  {
    label: 'Table',
    detail: 'Visual table editor',
    keywords: 'grid columns rows',
    block: true,
    template: '',
    action: insertTable,
  },
  {
    label: 'Image',
    detail: '![alt](url)',
    keywords: 'picture photo img',
    template: '![${alt text}](${url})',
  },
  {
    label: 'Link',
    detail: '[text](url)',
    keywords: 'url href',
    template: '[${text}](${https://})',
  },
  {
    label: 'Link to document',
    detail: '[[Document]]',
    keywords: 'wiki internal note page',
    template: '[[',
    chain: true,
  },
  {
    label: 'Table of contents',
    detail: 'Links to every heading',
    keywords: 'toc outline contents',
    block: true,
    template: tableOfContents,
  },
  { label: 'Date', detail: "Today's date", keywords: 'today now', template: () => isoDate() },
  { label: 'Time', detail: 'Current time', keywords: 'now clock', template: () => time() },
  {
    label: 'Math block',
    detail: '$$ equation $$',
    keywords: 'latex katex formula equation',
    block: true,
    template: '$$\n${}\n$$',
  },
  {
    label: 'Diagram',
    detail: 'Mermaid flowchart',
    keywords: 'mermaid chart flow graph',
    block: true,
    template: '```mermaid\nflowchart LR\n  A[${Start}] --> B[End]\n```',
  },
  { label: 'Footnote', detail: '[^1] note', keywords: 'reference citation', template: '[^${1}]' },
  {
    label: 'Details',
    detail: 'Collapsible section',
    keywords: 'toggle collapse spoiler summary',
    block: true,
    template: '<details>\n<summary>${Summary}</summary>\n\n${}\n\n</details>',
  },
];

function apply(item: SlashItem) {
  return (view: EditorView, completion: Completion, from: number, to: number) => {
    const slash = from - 1;
    const line = view.state.doc.lineAt(slash);
    const before = view.state.sliceDoc(line.from, slash);
    let template = typeof item.template === 'function' ? item.template(view) : item.template;
    if (typeof item.template === 'function') template = `${template}\${}`;
    // Block items need their own line.
    if (item.block && before.trim()) template = `\n${template}`;
    if (item.action) {
      const insert = item.block && before.trim() ? '\n' : '';
      view.dispatch({
        changes: { from: slash, to, insert },
        selection: { anchor: slash + insert.length },
        userEvent: 'input.complete',
      });
      item.action(view);
      return;
    }
    if (item.chain) {
      view.dispatch({
        changes: { from: slash, to, insert: template },
        selection: { anchor: slash + template.length },
        userEvent: 'input.complete',
      });
      startCompletion(view);
      return;
    }
    snippet(template)(view, completion, slash, to);
  };
}

/**
 * "/" at the start of a line or after a space opens a block menu. Typing filters it
 * fuzzily by name and keywords ("/hea" → Heading), and it's fully keyboard driven.
 */
export function slashCompletion(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/(?:^|\s)\/[\w ]{0,24}$/);
  if (!m) return null;
  const slash = m.from + m.text.indexOf('/');
  const query = ctx.state.sliceDoc(slash + 1, ctx.pos);
  // A space right after "/" means the user is just writing a slash.
  if (query.startsWith(' ') || inCode(ctx, slash)) return null;
  const scored = SLASH_ITEMS.map((item, i) => {
    const byLabel = fuzzyScore(query, item.label);
    const byKeyword = !byLabel && query && item.keywords ? fuzzyScore(query, item.keywords) : null;
    const score = byLabel ? byLabel.score : byKeyword ? byKeyword.score - 400 : null;
    return { item, i, score };
  }).filter((x) => x.score !== null);
  if (!scored.length) return null;
  if (query) scored.sort((a, b) => b.score! - a.score! || a.i - b.i);
  return {
    from: slash + 1,
    // Already ranked here; CodeMirror keeps this order.
    filter: false,
    options: scored.map(({ item }, rank) => ({
      label: item.label,
      detail: item.detail,
      type: 'slash',
      boost: 99 - rank,
      apply: apply(item),
    })),
  };
}

function inCode(ctx: CompletionContext, pos: number): boolean {
  const start = syntaxTree(ctx.state).resolveInner(pos, -1);
  for (let node: typeof start | null = start; node; node = node.parent) {
    if (/^(FencedCode|CodeBlock|InlineCode|CodeText|HTMLBlock|CommentBlock)$/.test(node.name))
      return true;
  }
  return false;
}
