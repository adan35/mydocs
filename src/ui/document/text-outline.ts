import {
  extractHeadings,
  extractSymbols,
  isCodeExtension,
  type OutlineItem,
} from '@/domain/outline';
import { extensionOf } from '@/domain/names';
import { countWords } from '@/domain/tasks';

export interface TextOutline {
  items: OutlineItem[];
  /** Source line of each item. */
  lines: number[];
  noun: string;
  summary?: string;
  empty: string;
}

/** 1,234 → "1.2k". */
export function compactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(n / 1000)}k`;
}

/**
 * The outline of a text document: headings with their level and the size of their
 * section (Markdown, plain text), or functions and classes (source code).
 */
export function textOutline(text: string, name: string): TextOutline {
  const ext = extensionOf(name);
  if (isCodeExtension(ext)) {
    const symbols = extractSymbols(text);
    return {
      items: symbols,
      lines: symbols.map((s) => s.line),
      noun: 'symbols',
      empty: 'No functions, classes or types found in this file.',
    };
  }
  const headings = extractHeadings(text);
  // Words before each line, so every section's size is one subtraction.
  const lines = text.split('\n');
  const before = new Array<number>(lines.length + 1);
  before[0] = 0;
  for (let i = 0; i < lines.length; i++) before[i + 1] = before[i]! + countWords(lines[i]!);
  const items: OutlineItem[] = headings.map((h, i) => {
    // A section runs to the next heading of the same or a higher level.
    let end = lines.length;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j]!.level <= h.level) {
        end = headings[j]!.line;
        break;
      }
    }
    const words = before[end]! - before[Math.min(h.line + 1, end)]!;
    return {
      key: h.slug,
      level: h.level,
      text: h.text,
      badge: `H${h.level}`,
      detail: words ? `${compactNumber(words)} w` : undefined,
    };
  });
  const total = before[lines.length]!;
  return {
    items,
    lines: headings.map((h) => h.line),
    noun: 'headings',
    summary: `${total.toLocaleString()} word${total === 1 ? '' : 's'}`,
    empty:
      ext === 'md' || ext === 'markdown' || ext === 'mdx' || ext === 'txt' || !ext
        ? 'No headings yet. Headings you add (# Title, ## Section) appear here for quick navigation.'
        : 'This file has no headings to outline.',
  };
}
