/**
 * The intermediate model shared by text formats (Markdown, DOCX, HTML, plain text).
 *
 * Every adapter reads into this model or writes from it, so a feature supported by two
 * formats converts between them without a pairwise converter. Anything an adapter can't
 * represent is reported through `ConversionReport`, never dropped silently.
 */

export interface Marks {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  underline?: boolean;
  sup?: boolean;
  sub?: boolean;
}

export type Inline =
  | { type: 'text'; text: string; marks?: Marks }
  | { type: 'link'; href: string; title?: string; children: Inline[] }
  | { type: 'image'; src: string; alt: string; title?: string }
  | { type: 'break' }
  | { type: 'math'; tex: string };

export interface ListItem {
  /** `true`/`false` for task items, undefined for plain items. */
  checked?: boolean;
  blocks: Block[];
}

export type Align = 'left' | 'center' | 'right' | null;

export interface TableCell {
  inlines: Inline[];
}

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; inlines: Inline[] }
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'list'; ordered: boolean; start?: number; items: ListItem[] }
  | { type: 'quote'; blocks: Block[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'table'; align: Align[]; header: TableCell[]; rows: TableCell[][] }
  | { type: 'rule' }
  | { type: 'math'; tex: string }
  /** Content kept verbatim because no target can express it (raw HTML, front matter...). */
  | { type: 'raw'; format: 'html' | 'markdown'; text: string };

export interface DocMeta {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  created?: string;
  modified?: string;
  /** Anything else from front matter, kept as written. */
  extra?: Record<string, unknown>;
}

export interface DocAst {
  meta: DocMeta;
  blocks: Block[];
}

/** One thing a conversion could not carry over exactly. */
export interface ConversionNote {
  severity: 'info' | 'warning';
  message: string;
  count?: number;
}

/** What a conversion did, shown to the person before and after converting. */
export class ConversionReport {
  readonly notes: ConversionNote[] = [];
  readonly kept = new Map<string, number>();
  private byMessage = new Map<string, ConversionNote>();

  /** Counts something that was carried over ("3 tables"). */
  keep(what: string, n = 1) {
    this.kept.set(what, (this.kept.get(what) ?? 0) + n);
  }

  /** Records a loss or approximation; repeated messages are counted, not repeated. */
  note(message: string, severity: ConversionNote['severity'] = 'warning') {
    const existing = this.byMessage.get(message);
    if (existing) {
      existing.count = (existing.count ?? 1) + 1;
      return;
    }
    const n: ConversionNote = { severity, message };
    this.byMessage.set(message, n);
    this.notes.push(n);
  }

  get lossless(): boolean {
    return !this.notes.some((n) => n.severity === 'warning');
  }

  toJSON(): { notes: ConversionNote[]; kept: Record<string, number> } {
    return { notes: this.notes.map((n) => ({ ...n })), kept: Object.fromEntries(this.kept) };
  }

  static from(data: { notes: ConversionNote[]; kept: Record<string, number> }): ConversionReport {
    const r = new ConversionReport();
    for (const n of data.notes)
      for (let k = 0; k < (n.count ?? 1); k++) r.note(n.message, n.severity);
    for (const [k, v] of Object.entries(data.kept)) r.keep(k, v);
    return r;
  }
}

export type ReportData = ReturnType<ConversionReport['toJSON']>;

// ------------------------------------------------------------------ helpers

export function inlineText(inlines: Inline[]): string {
  let s = '';
  for (const i of inlines) {
    if (i.type === 'text') s += i.text;
    else if (i.type === 'link') s += inlineText(i.children);
    else if (i.type === 'image') s += i.alt;
    else if (i.type === 'break') s += '\n';
    else if (i.type === 'math') s += i.tex;
  }
  return s;
}

/** Merges adjacent text runs with identical marks. */
export function normalizeInlines(inlines: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const i of inlines) {
    const prev = out[out.length - 1];
    if (i.type === 'text' && !i.text) continue;
    if (i.type === 'text' && prev?.type === 'text' && sameMarks(prev.marks, i.marks)) {
      out[out.length - 1] = { ...prev, text: prev.text + i.text };
    } else out.push(i);
  }
  return out;
}

export function sameMarks(a: Marks | undefined, b: Marks | undefined): boolean {
  const keys: (keyof Marks)[] = ['bold', 'italic', 'strike', 'code', 'underline', 'sup', 'sub'];
  return keys.every((k) => !!a?.[k] === !!b?.[k]);
}

/** Visits every block, depth first. */
export function walkBlocks(blocks: Block[], fn: (b: Block) => void) {
  for (const b of blocks) {
    fn(b);
    if (b.type === 'quote') walkBlocks(b.blocks, fn);
    if (b.type === 'list') for (const it of b.items) walkBlocks(it.blocks, fn);
  }
}

/** Counts structure for conversion summaries. */
export function describeAst(ast: DocAst, report: ConversionReport) {
  walkBlocks(ast.blocks, (b) => {
    if (b.type === 'heading') report.keep('headings');
    else if (b.type === 'table') report.keep('tables');
    else if (b.type === 'list') report.keep('lists');
    else if (b.type === 'code') report.keep('code blocks');
    else if (b.type === 'quote') report.keep('quotes');
  });
  const countInline = (inl: Inline[]) => {
    for (const i of inl) {
      if (i.type === 'link') {
        report.keep('links');
        countInline(i.children);
      } else if (i.type === 'image') report.keep('images');
    }
  };
  walkBlocks(ast.blocks, (b) => {
    if (b.type === 'heading' || b.type === 'paragraph') countInline(b.inlines);
    if (b.type === 'table')
      for (const r of [b.header, ...b.rows]) for (const c of r) countInline(c.inlines);
  });
}
