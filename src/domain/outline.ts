import { blankInlineCode, proseLines } from './markdown-scan';

export interface Heading {
  level: number;
  text: string;
  /** 0-based source line. */
  line: number;
  /** Anchor slug, unique within the document. */
  slug: string;
}

/** GitHub-style slug, shared with the renderer so outline clicks find their anchors. */
export function slugify(text: string): string {
  return (
    text
      .trim()
      .toLocaleLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s+/g, '-') || 'section'
  );
}

export function uniqueSlugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text) => {
    const base = slugify(text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
}

/** Strips inline Markdown so headings read cleanly in the outline. */
export function plainInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a: string, b?: string) => b ?? a)
    .replace(/[*_~`]+/g, '')
    .replace(/\s+#+\s*$/, '')
    .trim();
}

export function extractHeadings(src: string): Heading[] {
  const slug = uniqueSlugger();
  const out: Heading[] = [];
  const lines = src.split('\n');
  for (const line of proseLines(src)) {
    const atx = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line.text);
    let level = 0;
    let raw = '';
    if (atx) {
      level = atx[1]!.length;
      raw = atx[2]!;
    } else {
      // Setext headings: a text line followed by === or ---.
      const next = lines[line.index + 1];
      if (next !== undefined && line.text.trim() && !/^\s*([-*+]|\d+\.)\s/.test(line.text)) {
        if (/^ {0,3}=+\s*$/.test(next)) level = 1;
        else if (/^ {0,3}-+\s*$/.test(next) && !/^\s*$/.test(line.text)) level = 2;
        raw = line.text.trim();
      }
    }
    if (!level) continue;
    const text = plainInline(blankInlineCode(raw) === raw ? raw : raw.replace(/`/g, ''));
    if (!text) continue;
    out.push({ level, text, line: line.index, slug: slug(text) });
  }
  return out;
}

/** An entry in a document's outline: a heading, page, sheet, table, column or symbol. */
export interface OutlineItem {
  key: string;
  /** Nesting depth, 1 = top level. */
  level: number;
  text: string;
  /** Short note shown at the end of the row ("120 words", "p. 4", "40 rows"). */
  detail?: string;
  /** Badge before the text ("H2", "fn"). */
  badge?: string;
}

const SYMBOL_PATTERNS: [RegExp, string][] = [
  // JavaScript / TypeScript
  [/^(\s*)(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([\w$]+)/, 'class'],
  [/^(\s*)(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)/, 'fn'],
  [/^(\s*)(?:export\s+)?(?:declare\s+)?interface\s+([\w$]+)/, 'type'],
  [/^(\s*)(?:export\s+)?(?:declare\s+)?type\s+([\w$]+)\s*(?:<[^=]*>)?\s*=/, 'type'],
  [/^(\s*)(?:export\s+)?(?:const\s+)?enum\s+([\w$]+)/, 'enum'],
  [
    /^(\s*)(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/,
    'fn',
  ],
  // Python
  [/^(\s*)(?:async\s+)?def\s+(\w+)/, 'fn'],
  [/^(\s*)class\s+(\w+)/, 'class'],
  // Go, Rust, Swift, Kotlin
  [/^(\s*)func\s+(?:\([^)]*\)\s*)?(\w+)/, 'fn'],
  [/^(\s*)(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/, 'fn'],
  [/^(\s*)(?:pub\s+)?(?:struct|trait|impl)\s+(?:<[^>]*>\s*)?([\w:]+)/, 'type'],
  [/^(\s*)(?:public\s+|private\s+|internal\s+)?fun\s+(\w+)/, 'fn'],
  // SQL
  [/^(\s*)create\s+(?:or\s+replace\s+)?(?:table|view|procedure|function)\s+([\w.]+)/i, 'sql'],
];

const CODE_EXTENSIONS = new Set([
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'py',
  'go',
  'rs',
  'swift',
  'kt',
  'kts',
  'java',
  'cs',
  'sql',
  'rb',
  'php',
]);

export function isCodeExtension(ext: string): boolean {
  return CODE_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * Functions, classes and types of a source file, by pattern (no parser): enough to find
 * your way around a file. Indented definitions (methods) sit one level deeper.
 */
export function extractSymbols(src: string): (OutlineItem & { line: number })[] {
  const out: (OutlineItem & { line: number })[] = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length && out.length < 2000; i++) {
    const line = lines[i]!;
    if (line.length > 400 || /^\s*(\/\/|#|\*|--)/.test(line)) continue;
    for (const [re, badge] of SYMBOL_PATTERNS) {
      const m = re.exec(line);
      if (!m) continue;
      const indent = m[1]!.replace(/\t/g, '    ').length;
      out.push({ key: `${i}`, line: i, level: indent ? 2 : 1, text: m[2]!, badge });
      break;
    }
  }
  return out;
}
