/**
 * Writes a `DocAst` as a PDF file, with no dependencies beyond `fflate`.
 *
 * The text uses the PDF standard fonts (Helvetica and Courier), which every viewer has, so
 * files stay small and text stays selectable and searchable. Their encoding covers Western
 * European languages; anything else is reported, never dropped silently. Headings become
 * bookmarks, web links stay clickable, tables repeat their header row across pages, and
 * images are embedded as they are (JPEG and PNG without re-encoding the pixels).
 */
import { zlibSync } from 'fflate';
import {
  ConversionReport,
  describeAst,
  inlineText,
  type Block,
  type DocAst,
  type Inline,
  type ListItem,
  type Marks,
  type TableCell,
} from './doc-ast';
import { embedImage, type ImageResult } from './pdf-image';

export type ImageResolver = (src: string) => Uint8Array | undefined;

export interface PdfOptions {
  images?: ImageResolver;
  /** Defaults to A4. */
  pageSize?: 'a4' | 'letter';
  /** The creation date; tests pin it so output is repeatable. */
  now?: Date;
}

// ================================================================== fonts

/** Advance widths (1/1000 em) for WinAnsi codes 32–255, from the Adobe core font metrics. */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
  761, 556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 222, 222,
  333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556,
  260, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 556, 537, 278, 333,
  333, 365, 556, 834, 834, 834, 611, 667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667,
  278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667,
  611, 556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556, 556,
  556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
];

const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
  611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
  278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
  761, 556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 278, 278,
  500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556,
  280, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 611, 556, 278, 333,
  333, 365, 556, 834, 834, 834, 611, 722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667,
  278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667,
  611, 556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611, 611,
  611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556,
];

/** The eight fonts used: Helvetica and Courier, each in regular, bold, italic, bold italic. */
const FONT_NAMES = [
  'Helvetica',
  'Helvetica-Bold',
  'Helvetica-Oblique',
  'Helvetica-BoldOblique',
  'Courier',
  'Courier-Bold',
  'Courier-Oblique',
  'Courier-BoldOblique',
];

const fontIndex = (mono: boolean, bold: boolean, italic: boolean) =>
  (mono ? 4 : 0) + (bold ? 1 : 0) + (italic ? 2 : 0);

/** Width of one WinAnsi byte in a font, in 1/1000 em. */
function glyphWidth(font: number, code: number): number {
  if (font >= 4) return 600;
  const table = font & 1 ? HELVETICA_BOLD : HELVETICA;
  return table[code - 32] ?? 556;
}

// Windows-1252 differs from Latin-1 only in 0x80–0x9F.
const CP1252: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

/** Characters with a plain equivalent in the standard fonts. */
const LOOKALIKES: Record<number, string> = {
  0x2010: '-',
  0x2011: '-',
  0x2012: '-',
  0x2212: '-',
  0x2009: ' ',
  0x2002: ' ',
  0x2003: ' ',
  0x202f: ' ',
  0x2032: "'",
  0x2033: '"',
  0x2192: '->',
  0x2190: '<-',
  0x21d2: '=>',
  0x2264: '<=',
  0x2265: '>=',
  0x2260: '!=',
  0x2248: '~',
  0x2713: 'v',
  0x2714: 'v',
};

/** Characters that take no space and are simply left out. */
const INVISIBLE = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0xad, 0xfe0f]);

/**
 * Text as WinAnsi bytes (a string of char codes 0–255). `lost` collects what the fonts can't
 * show, which becomes "?" and is reported.
 */
function encode(text: string, lost?: Map<string, number>): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x09) out += '    ';
    else if (cp === 0x0a || cp === 0x0d) out += ' ';
    else if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff)) out += ch;
    else if (CP1252[cp] !== undefined) out += String.fromCharCode(CP1252[cp]!);
    else if (LOOKALIKES[cp] !== undefined) out += LOOKALIKES[cp];
    else if (INVISIBLE.has(cp) || cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) continue;
    else {
      out += '?';
      lost?.set(ch, (lost.get(ch) ?? 0) + 1);
    }
  }
  return out;
}

const measure = (bytes: string, font: number, size: number) => {
  let w = 0;
  for (let i = 0; i < bytes.length; i++) w += glyphWidth(font, bytes.charCodeAt(i));
  return (w * size) / 1000;
};

/** A PDF literal string for WinAnsi bytes. */
function literal(bytes: string): string {
  let s = '(';
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes.charCodeAt(i);
    if (c === 0x28 || c === 0x29 || c === 0x5c) s += `\\${bytes[i]}`;
    else if (c < 0x20 || c > 0x7e) s += `\\${c.toString(8).padStart(3, '0')}`;
    else s += bytes[i];
  }
  return `${s})`;
}

/** Unicode text for document properties and bookmarks: UTF-16BE with a byte order mark. */
function unicodeString(text: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${hex.toUpperCase()}>`;
}

const num = (n: number) => (Math.round(n * 100) / 100).toString();
const binary = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

// ================================================================== file structure

type Chunk = string | Uint8Array;

/** Collects numbered objects and writes them with a cross-reference table. */
class PdfFile {
  private objects: (Chunk[] | undefined)[] = [];

  reserve(): number {
    this.objects.push(undefined);
    return this.objects.length;
  }

  set(id: number, ...body: Chunk[]) {
    this.objects[id - 1] = body;
  }

  add(...body: Chunk[]): number {
    const id = this.reserve();
    this.set(id, ...body);
    return id;
  }

  /** A stream object; the data is compressed unless it already is. */
  stream(dict: string, data: Uint8Array, compressed = false): number {
    const body = compressed ? data : zlibSync(data, { level: 6 });
    return this.add(
      `<< ${dict} /Filter /FlateDecode /Length ${body.length} >>\nstream\n`,
      body,
      '\nendstream',
    );
  }

  /** A stream whose filter is part of `dict` already (images). */
  rawStream(dict: string, body: Uint8Array): number {
    return this.add(`<< ${dict} /Length ${body.length} >>\nstream\n`, body, '\nendstream');
  }

  write(root: number, info: number): Uint8Array {
    const parts: Uint8Array[] = [];
    const offsets: number[] = [];
    let at = 0;
    const push = (c: Chunk) => {
      const bytes = typeof c === 'string' ? binary(c) : c;
      parts.push(bytes);
      at += bytes.length;
    };
    push('%PDF-1.5\n%âãÏÓ\n');
    this.objects.forEach((body, i) => {
      offsets.push(at);
      push(`${i + 1} 0 obj\n`);
      for (const c of body ?? ['null']) push(c);
      push('\nendobj\n');
    });
    const xref = at;
    let table = `xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) table += `${String(o).padStart(10, '0')} 00000 n \n`;
    table += `trailer\n<< /Size ${this.objects.length + 1} /Root ${root} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    push(table);
    const out = new Uint8Array(at);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

// ================================================================== layout

type RGB = [number, number, number];
const INK: RGB = [0.1, 0.1, 0.1];
const MUTED: RGB = [0.36, 0.36, 0.34];
const LINK: RGB = [0, 0.4, 0.8];
const RULE: RGB = [0.82, 0.81, 0.79];
const CODE_BG: RGB = [0.955, 0.953, 0.945];
const HEAD_BG: RGB = [0.96, 0.955, 0.945];

const SIZES = { a4: [595.28, 841.89], letter: [612, 792] } as const;
const MARGIN = 56;
const MARGIN_BOTTOM = 64;
const BODY = 10.5;
const LINE = 1.5;
const HEADING_SIZE = [0, 24, 19, 15, 12.5, 11, 10.5] as const;
const CODE_SIZE = 8.5;
const CODE_LINE = 1.45;

interface Style {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  size: number;
  color: RGB;
  underline?: boolean;
  strike?: boolean;
  link?: string;
  rise?: number;
}

interface Frag {
  bytes: string;
  font: number;
  size: number;
  width: number;
  color: RGB;
  underline: boolean;
  strike: boolean;
  link?: string;
  code: boolean;
  rise: number;
  x: number;
}

interface PlacedImage {
  src: string;
  alt: string;
}

interface Line {
  frags: Frag[];
  width: number;
  height: number;
  image?: PlacedImage;
}

interface Link {
  rect: [number, number, number, number];
  uri: string;
}

class Page {
  /** Backgrounds, drawn first. */
  bg: string[] = [];
  ops: string[] = [];
  links: Link[] = [];
  images = new Set<string>();
}

/** A stretch of the page behind content: a quote's bar or a code block's panel. */
interface Region {
  kind: 'bar' | 'panel';
  x: number;
  width: number;
  spans: Map<Page, [number, number]>;
}

type Piece =
  | { type: 'text'; text: string; style: Style }
  | { type: 'break' }
  | { type: 'image'; src: string; alt: string };

type Token =
  | { type: 'space'; frag: Frag }
  | { type: 'word'; frags: Frag[]; width: number }
  | { type: 'break' }
  | { type: 'image'; image: PlacedImage };

const isWebLink = (href: string) => /^(https?:|mailto:)/i.test(href);

class Layout {
  readonly pages: Page[] = [];
  page!: Page;
  y = 0;
  readonly w: number;
  readonly h: number;
  readonly lost = new Map<string, number>();
  readonly outline: { level: number; title: string; page: Page; y: number }[] = [];
  readonly imageIds = new Map<string, { name: string; result: ImageResult }>();
  private regions: Region[] = [];
  /** Drawn on the next line placed: a list marker. */
  private marker: ((page: Page, top: number, lh: number) => void) | null = null;
  private plainLinks = 0;

  constructor(
    readonly file: PdfFile,
    readonly report: ConversionReport,
    readonly images: ImageResolver | undefined,
    size: 'a4' | 'letter',
  ) {
    [this.w, this.h] = SIZES[size];
    this.newPage();
  }

  get bottom() {
    return this.h - MARGIN_BOTTOM;
  }
  get atTop() {
    return this.y <= MARGIN + 0.01;
  }
  get contentWidth() {
    return this.w - 2 * MARGIN;
  }

  newPage() {
    this.page = new Page();
    this.pages.push(this.page);
    this.y = MARGIN;
  }

  ensure(height: number) {
    if (this.y + height > this.bottom && !this.atTop) this.newPage();
  }

  gap(n: number) {
    if (this.atTop) return;
    this.y += n;
    for (const r of this.regions) {
      const span = r.spans.get(this.page);
      if (span) span[1] = Math.max(span[1], Math.min(this.y, this.bottom));
    }
  }

  /** Reserves a line, starting a new page when it doesn't fit, and returns its top. */
  placeLine(lh: number): number {
    if (this.y + lh > this.bottom && !this.atTop) this.newPage();
    const top = this.y;
    for (const r of this.regions) {
      const span = r.spans.get(this.page);
      if (span) span[1] = top + lh;
      else r.spans.set(this.page, [top, top + lh]);
    }
    if (this.marker) {
      const draw = this.marker;
      this.marker = null;
      draw(this.page, top, lh);
    }
    this.y += lh;
    return top;
  }

  withRegion<T>(region: Omit<Region, 'spans'>, fn: () => T): T {
    const r: Region = { ...region, spans: new Map() };
    this.regions.push(r);
    try {
      return fn();
    } finally {
      this.regions.pop();
      for (const [page, [from, to]] of r.spans) {
        if (r.kind === 'bar')
          page.bg.push(
            `0.8 0.78 0.74 rg ${num(r.x)} ${num(this.h - to)} 2.5 ${num(to - from)} re f`,
          );
        else {
          const [cr, cg, cb] = CODE_BG;
          page.bg.push(
            `${num(cr)} ${num(cg)} ${num(cb)} rg 0.88 0.87 0.85 RG 0.5 w ${num(r.x)} ${num(this.h - to - 6)} ${num(r.width)} ${num(to - from + 12)} re B`,
          );
        }
      }
    }
  }

  withMarker(draw: (page: Page, top: number, lh: number) => void) {
    this.marker = draw;
  }

  // ---------------------------------------------------------------- text

  private frag(text: string, s: Style): Frag {
    const font = fontIndex(!!s.code, !!s.bold, !!s.italic);
    const bytes = encode(text, this.lost);
    return {
      bytes,
      font,
      size: s.size,
      width: measure(bytes, font, s.size),
      color: s.color,
      underline: !!s.underline,
      strike: !!s.strike,
      link: s.link,
      code: !!s.code,
      rise: s.rise ?? 0,
      x: 0,
    };
  }

  private pieces(inlines: Inline[], base: Style, allowImages: boolean, out: Piece[]) {
    for (const n of inlines) {
      if (n.type === 'text') {
        const m: Marks = n.marks ?? {};
        const style: Style = {
          ...base,
          bold: base.bold || m.bold,
          italic: base.italic || m.italic,
          code: base.code || m.code,
          underline: base.underline || m.underline,
          strike: base.strike || m.strike,
          size: m.sup || m.sub ? base.size * 0.7 : base.size,
          rise: m.sup ? base.size * 0.35 : m.sub ? -base.size * 0.12 : base.rise,
        };
        out.push({ type: 'text', text: n.text, style });
      } else if (n.type === 'break') out.push({ type: 'break' });
      else if (n.type === 'math') {
        this.report.note('Equations are written as TeX text.', 'info');
        out.push({ type: 'text', text: n.tex, style: { ...base, code: true } });
      } else if (n.type === 'link') {
        if (isWebLink(n.href)) {
          this.report.keep('links');
          this.pieces(
            n.children,
            { ...base, color: LINK, underline: true, link: n.href },
            allowImages,
            out,
          );
        } else {
          this.plainLinks++;
          this.pieces(n.children, base, allowImages, out);
        }
      } else if (n.type === 'image') {
        if (allowImages) out.push({ type: 'image', src: n.src, alt: n.alt });
        else {
          this.report.note('Images inside tables are replaced by their description.');
          out.push({
            type: 'text',
            text: `[${n.alt || 'image'}]`,
            style: { ...base, italic: true },
          });
        }
      }
    }
  }

  private tokens(pieces: Piece[]): Token[] {
    const tokens: Token[] = [];
    let word: Frag[] = [];
    const flush = () => {
      if (word.length) {
        tokens.push({ type: 'word', frags: word, width: word.reduce((n, f) => n + f.width, 0) });
        word = [];
      }
    };
    for (const p of pieces) {
      if (p.type === 'break') {
        flush();
        tokens.push({ type: 'break' });
      } else if (p.type === 'image') {
        flush();
        tokens.push({ type: 'image', image: { src: p.src, alt: p.alt } });
      } else {
        for (const part of p.text.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) {
            flush();
            tokens.push({ type: 'space', frag: this.frag(' ', p.style) });
          } else word.push(this.frag(part, p.style));
        }
      }
    }
    flush();
    return tokens;
  }

  /** Breaks inline content into lines no wider than `width`. */
  layout(inlines: Inline[], base: Style, width: number, allowImages = true, lineFactor = LINE) {
    const pieces: Piece[] = [];
    this.pieces(inlines, base, allowImages, pieces);
    const lines: Line[] = [];
    let cur: Line = { frags: [], width: 0, height: base.size * lineFactor };
    const finish = (keepEmpty = false) => {
      while (cur.frags.length && cur.frags[cur.frags.length - 1]!.bytes === ' ') {
        cur.width -= cur.frags.pop()!.width;
      }
      if (cur.frags.length || keepEmpty) lines.push(cur);
      cur = { frags: [], width: 0, height: base.size * lineFactor };
    };
    const add = (f: Frag) => {
      f.x = cur.width;
      cur.frags.push(f);
      cur.width += f.width;
      cur.height = Math.max(cur.height, f.size * lineFactor);
    };
    for (const t of this.tokens(pieces)) {
      if (t.type === 'space') {
        if (cur.frags.length) add({ ...t.frag });
      } else if (t.type === 'break') finish(true);
      else if (t.type === 'image') {
        finish();
        lines.push({ frags: [], width, height: 0, image: t.image });
      } else {
        if (cur.width + t.width > width + 0.01 && cur.frags.length) finish();
        if (t.width <= width + 0.01) for (const f of t.frags) add({ ...f });
        else
          // A word wider than the line (a long URL, say) is split where it has to be.
          for (const f of t.frags) this.splitFrag(f, width, () => cur, add, finish);
      }
    }
    finish();
    return lines;
  }

  private splitFrag(
    f: Frag,
    width: number,
    current: () => Line,
    add: (f: Frag) => void,
    finish: () => void,
  ) {
    let rest = f.bytes;
    while (rest) {
      let n = 0;
      let w = 0;
      while (n < rest.length) {
        const cw = measure(rest[n]!, f.font, f.size);
        const cur = current();
        if (cur.width + w + cw > width + 0.01 && (n > 0 || cur.frags.length)) break;
        w += cw;
        n++;
      }
      if (n === 0) {
        finish();
        continue;
      }
      add({ ...f, bytes: rest.slice(0, n), width: w });
      rest = rest.slice(n);
      if (rest) finish();
    }
  }

  /** Draws one laid-out line with its top at `top`, within [x, x + width]. */
  draw(page: Page, line: Line, x: number, top: number, width: number, align: Align = 'left') {
    const shift =
      align === 'center' ? (width - line.width) / 2 : align === 'right' ? width - line.width : 0;
    // Neighbouring pieces with the same look are written as one string, so a reader copying
    // or searching the text sees whole phrases with their spaces.
    const runs: Frag[] = [];
    for (const f of line.frags) {
      const last = runs[runs.length - 1];
      if (
        last &&
        last.font === f.font &&
        last.size === f.size &&
        last.color === f.color &&
        last.rise === f.rise &&
        last.link === f.link &&
        last.underline === f.underline &&
        last.strike === f.strike &&
        last.code === f.code
      )
        runs[runs.length - 1] = {
          ...last,
          bytes: last.bytes + f.bytes,
          width: last.width + f.width,
        };
      else runs.push({ ...f });
    }
    for (const f of runs) {
      const left = x + shift + f.x;
      const baseline = this.h - (top + (line.height - f.size) / 2 + f.size * 0.8) + f.rise;
      if (f.code) {
        const [r, g, b] = CODE_BG;
        page.bg.push(
          `${num(r)} ${num(g)} ${num(b)} rg ${num(left - 1)} ${num(baseline - f.size * 0.25)} ${num(f.width + 2)} ${num(f.size * 1.1)} re f`,
        );
      }
      const [r, g, b] = f.color;
      if (f.bytes.trim())
        page.ops.push(
          `BT /F${f.font} ${num(f.size)} Tf ${num(r)} ${num(g)} ${num(b)} rg ${num(left)} ${num(baseline)} Td ${literal(f.bytes)} Tj ET`,
        );
      if (f.underline || f.strike) {
        const lineY = f.underline ? baseline - f.size * 0.12 : baseline + f.size * 0.3;
        const end = f.width - (f.bytes.endsWith(' ') ? measure(' ', f.font, f.size) : 0);
        page.ops.push(
          `${num(r)} ${num(g)} ${num(b)} RG ${num(Math.max(0.4, f.size * 0.05))} w ${num(left)} ${num(lineY)} m ${num(left + end)} ${num(lineY)} l S`,
        );
      }
      if (f.link)
        page.links.push({
          rect: [left, baseline - f.size * 0.25, left + f.width, baseline + f.size * 0.85],
          uri: f.link,
        });
    }
  }

  // ---------------------------------------------------------------- images

  private image(src: string) {
    let entry = this.imageIds.get(src);
    if (!entry) {
      const data = this.images?.(src);
      let result: ImageResult;
      if (!data) {
        result = { unsupported: /^(https?:|data:)/i.test(src) ? 'web' : 'missing' };
      } else result = embedImage(this.file, data);
      entry = { name: `Im${this.imageIds.size + 1}`, result };
      this.imageIds.set(src, entry);
    }
    return entry;
  }

  private placeImage(image: PlacedImage, x: number, width: number) {
    const { name, result } = this.image(image.src);
    if ('unsupported' in result) {
      this.report.note(
        result.unsupported === 'web'
          ? 'Images from the web are not downloaded; they were replaced by their description.'
          : result.unsupported === 'missing'
            ? 'Images that are not in this workspace were replaced by their description.'
            : `Images in ${result.unsupported} can't be embedded in a PDF; they were replaced by their description.`,
      );
      const lines = this.layout(
        [{ type: 'text', text: `[${image.alt || 'image'}]`, marks: { italic: true } }],
        { size: BODY, color: MUTED },
        width,
      );
      this.paragraphLines(lines, x, width);
      return;
    }
    let w = result.width * 0.75;
    let h = result.height * 0.75;
    const maxH = (this.bottom - MARGIN) * 0.85;
    const scale = Math.min(1, width / w, maxH / h);
    w *= scale;
    h *= scale;
    this.ensure(h);
    const top = this.placeLine(h);
    this.page.images.add(name);
    this.page.ops.push(
      `q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.h - top - h)} cm /${name} Do Q`,
    );
    this.report.keep('images');
  }

  // ---------------------------------------------------------------- blocks

  private paragraphLines(lines: Line[], x: number, width: number, align: Align = 'left') {
    lines.forEach((line, i) => {
      if (line.image) return this.placeImage(line.image, x, width);
      // Keep the first two lines of a paragraph together.
      if (i === 0 && lines.length > 1) this.ensure(line.height + (lines[1]?.height ?? 0));
      const top = this.placeLine(line.height);
      this.draw(this.page, line, x, top, width, align);
    });
  }

  blocks(blocks: Block[], x: number, width: number) {
    for (const b of blocks) this.block(b, x, width);
  }

  block(b: Block, x: number, width: number) {
    switch (b.type) {
      case 'heading': {
        const size = HEADING_SIZE[b.level];
        const lines = this.layout(b.inlines, { size, color: INK, bold: true }, width, true, 1.3);
        this.gap(size * 0.8);
        this.ensure((lines[0]?.height ?? size) * 2 + size);
        this.outline.push({
          level: b.level,
          title: inlineText(b.inlines).replace(/\s+/g, ' ').trim(),
          page: this.page,
          y: this.y,
        });
        this.paragraphLines(lines, x, width);
        this.gap(size * 0.3);
        break;
      }
      case 'paragraph': {
        this.paragraphLines(this.layout(b.inlines, { size: BODY, color: INK }, width), x, width);
        this.gap(BODY * 0.6);
        break;
      }
      case 'list':
        this.list(b, x, width);
        this.gap(BODY * 0.3);
        break;
      case 'quote':
        this.gap(BODY * 0.2);
        this.withRegion({ kind: 'bar', x, width: 2.5 }, () => {
          const inner = 14;
          this.quoteBlocks(b.blocks, x + inner, width - inner);
        });
        this.gap(BODY * 0.3);
        break;
      case 'code':
        if (/^(mermaid|dot|plantuml)$/i.test(b.lang))
          this.report.note('Diagrams are written as their source, not drawn.', 'info');
        this.codeBlock(b.text, x, width);
        break;
      case 'math':
        this.report.note('Equations are written as TeX text.', 'info');
        this.codeBlock(b.tex, x, width);
        break;
      case 'raw':
        this.report.note(
          b.format === 'html'
            ? 'Raw HTML is written as text, not rendered.'
            : 'Content with no PDF equivalent is written as text.',
        );
        this.codeBlock(b.text, x, width);
        break;
      case 'rule': {
        this.gap(BODY * 0.6);
        const top = this.placeLine(2);
        const [r, g, bl] = RULE;
        this.page.ops.push(
          `${num(r)} ${num(g)} ${num(bl)} RG 0.8 w ${num(x)} ${num(this.h - top - 1)} m ${num(x + width)} ${num(this.h - top - 1)} l S`,
        );
        this.gap(BODY * 0.8);
        break;
      }
      case 'table':
        this.table(b, x, width);
        this.gap(BODY * 0.8);
        break;
    }
  }

  private quoteBlocks(blocks: Block[], x: number, width: number) {
    // Quoted text is set a little lighter.
    for (const b of blocks) {
      if (b.type === 'paragraph') {
        this.paragraphLines(
          this.layout(b.inlines, { size: BODY, color: MUTED, italic: false }, width),
          x,
          width,
        );
        this.gap(BODY * 0.6);
      } else this.block(b, x, width);
    }
  }

  private list(b: Extract<Block, { type: 'list' }>, x: number, width: number, depth = 0) {
    const start = b.start ?? 1;
    const labels = b.items.map((_, i) =>
      b.ordered ? `${start + i}.` : depth % 2 === 0 ? '•' : '–',
    );
    const markerW = Math.max(14, ...labels.map((l) => measure(encode(l), 0, BODY)));
    const indent = markerW + 8;
    b.items.forEach((item, i) => {
      this.listItem(item, labels[i]!, x, width, indent, markerW, depth);
      if (i < b.items.length - 1) this.gap(BODY * 0.25);
    });
  }

  private listItem(
    item: ListItem,
    label: string,
    x: number,
    width: number,
    indent: number,
    markerW: number,
    depth: number,
  ) {
    const task = item.checked !== undefined;
    this.withMarker((page, top, lh) => {
      const baseline = this.h - (top + (lh - BODY) / 2 + BODY * 0.8);
      if (task) {
        const s = BODY * 0.72;
        const bx = x + 1;
        const by = baseline - 0.5;
        page.ops.push(`0.45 0.44 0.42 RG 0.8 w ${num(bx)} ${num(by)} ${num(s)} ${num(s)} re S`);
        if (item.checked)
          page.ops.push(
            `0.2 0.6 0.25 RG 1.4 w ${num(bx + s * 0.18)} ${num(by + s * 0.5)} m ${num(bx + s * 0.42)} ${num(by + s * 0.22)} l ${num(bx + s * 0.85)} ${num(by + s * 0.8)} l S`,
          );
      } else {
        const bytes = encode(label);
        const w = measure(bytes, 0, BODY);
        page.ops.push(
          `BT /F0 ${num(BODY)} Tf 0.1 0.1 0.1 rg ${num(x + markerW - w)} ${num(baseline)} Td ${literal(bytes)} Tj ET`,
        );
      }
    });
    const inner = x + indent;
    const innerW = width - indent;
    for (const child of item.blocks) {
      if (child.type === 'list') this.list(child, inner, innerW, depth + 1);
      else if (child.type === 'paragraph') {
        this.paragraphLines(
          this.layout(child.inlines, { size: BODY, color: item.checked ? MUTED : INK }, innerW),
          inner,
          innerW,
        );
        if (item.blocks.length > 1) this.gap(BODY * 0.25);
      } else this.block(child, inner, innerW);
    }
    // An item with no text still gets its marker.
    if (!item.blocks.length) this.placeLine(BODY * LINE);
  }

  private codeBlock(text: string, x: number, width: number) {
    const pad = 8;
    const charW = (CODE_SIZE * 600) / 1000;
    const perLine = Math.max(8, Math.floor((width - 2 * pad) / charW));
    const lines: string[] = [];
    for (const raw of text.replace(/\n+$/, '').split('\n')) {
      const bytes = encode(raw, this.lost);
      if (!bytes) lines.push('');
      for (let i = 0; i < bytes.length; i += perLine) lines.push(bytes.slice(i, i + perLine));
    }
    this.gap(6);
    const lh = CODE_SIZE * CODE_LINE;
    this.withRegion({ kind: 'panel', x, width }, () => {
      this.ensure(lh * Math.min(lines.length, 3));
      for (const bytes of lines) {
        const top = this.placeLine(lh);
        if (bytes.trim())
          this.page.ops.push(
            `BT /F4 ${num(CODE_SIZE)} Tf 0.1 0.1 0.1 rg ${num(x + pad)} ${num(this.h - (top + (lh - CODE_SIZE) / 2 + CODE_SIZE * 0.8))} Td ${literal(bytes)} Tj ET`,
          );
      }
    });
    this.gap(12);
  }

  private table(b: Extract<Block, { type: 'table' }>, x: number, width: number) {
    const cols = Math.max(b.header.length, ...b.rows.map((r) => r.length));
    if (!cols) return;
    const size = 9.5;
    const padX = 5;
    const padY = 3.5;
    const lineH = size * 1.4;
    const rows = [b.header, ...b.rows].map((r) =>
      Array.from({ length: cols }, (_, c): TableCell => r[c] ?? { inlines: [] }),
    );
    const styleOf = (r: number): Style => ({ size, color: INK, bold: r === 0 });
    // Natural and shortest widths per column decide how the width is shared.
    const maxW = new Array<number>(cols).fill(0);
    const minW = new Array<number>(cols).fill(0);
    rows.forEach((row, r) =>
      row.forEach((cell, c) => {
        const toks = this.tokens(
          (() => {
            const p: Piece[] = [];
            this.pieces(cell.inlines, styleOf(r), false, p);
            return p;
          })(),
        );
        let line = 0;
        for (const t of toks) {
          const w = t.type === 'word' ? t.width : t.type === 'space' ? t.frag.width : 0;
          line += w;
          if (t.type === 'word') minW[c] = Math.max(minW[c]!, t.width);
        }
        maxW[c] = Math.max(maxW[c]!, line);
      }),
    );
    const want = maxW.map((w) => w + 2 * padX + 1);
    const least = minW.map((w) => Math.min(w + 2 * padX + 1, width / cols));
    let widths: number[];
    const total = want.reduce((a, c) => a + c, 0);
    if (total <= width) widths = want.map((w) => (w / total) * width);
    else {
      const leastTotal = least.reduce((a, c) => a + c, 0);
      const spare = Math.max(0, width - leastTotal);
      const extra = want.map((w, i) => Math.max(0, w - least[i]!));
      const extraTotal = extra.reduce((a, c) => a + c, 0) || 1;
      widths = least.map((w, i) => w + (extra[i]! / extraTotal) * spare);
      const sum = widths.reduce((a, c) => a + c, 0);
      widths = widths.map((w) => (w / sum) * width);
    }
    const colX = widths.map((_, i) => x + widths.slice(0, i).reduce((a, c) => a + c, 0));

    const laid = rows.map((row, r) =>
      row.map((cell, c) =>
        this.layout(cell.inlines, styleOf(r), widths[c]! - 2 * padX, false, 1.4),
      ),
    );
    const drawRow = (r: number, from: number, count: number) => {
      const top = this.y;
      const height = count * lineH + 2 * padY;
      const page = this.page;
      if (r === 0) {
        const [hr, hg, hb] = HEAD_BG;
        page.bg.push(
          `${num(hr)} ${num(hg)} ${num(hb)} rg ${num(x)} ${num(this.h - top - height)} ${num(width)} ${num(height)} re f`,
        );
      }
      laid[r]!.forEach((lines, c) => {
        const align = b.align[c] ?? 'left';
        lines.slice(from, from + count).forEach((line, i) => {
          this.draw(
            page,
            { ...line, height: lineH },
            colX[c]! + padX,
            top + padY + i * lineH,
            widths[c]! - 2 * padX,
            align,
          );
        });
        const [rr, rg, rb] = RULE;
        page.ops.push(
          `${num(rr)} ${num(rg)} ${num(rb)} RG 0.6 w ${num(colX[c]!)} ${num(this.h - top - height)} ${num(widths[c]!)} ${num(height)} re S`,
        );
      });
      this.y += height;
    };
    const rowLines = laid.map((cells) => Math.max(1, ...cells.map((l) => l.length)));
    rows.forEach((_, r) => {
      let from = 0;
      const total = rowLines[r]!;
      const wholeHeight = total * lineH + 2 * padY;
      const pageHeight = this.bottom - MARGIN;
      while (from < total) {
        const room = this.bottom - this.y - 2 * padY;
        const fit = Math.floor(room / lineH);
        const keepTogether = from === 0 && wholeHeight <= pageHeight;
        // The header row stays with at least one body row.
        const need = r === 0 ? wholeHeight + (rowLines[1] ?? 0) * lineH + 2 * padY : wholeHeight;
        if ((keepTogether && this.y + need > this.bottom) || fit < 1) {
          if (this.atTop) break;
          this.newPage();
          if (r > 0) drawRow(0, 0, rowLines[0]!);
          continue;
        }
        const n = Math.min(fit, total - from);
        drawRow(r, from, n);
        from += n;
      }
    });
    this.report.keep('table rows', b.rows.length);
  }

  finishNotes() {
    if (this.plainLinks)
      this.report.notes.push({
        severity: 'warning',
        message:
          'Links to other documents, files and headings are written as plain text; only web and email links stay clickable.',
        count: this.plainLinks,
      });
    if (this.lost.size) {
      const total = [...this.lost.values()].reduce((a, c) => a + c, 0);
      const examples = [...this.lost.keys()].slice(0, 6).join(' ');
      this.report.notes.push({
        severity: 'warning',
        message: `${total} character${total === 1 ? '' : 's'} (${examples}) can't be written in a PDF's built-in fonts and show as “?”. Western European text is fine; use Print to PDF to keep other scripts and emoji.`,
        count: 1,
      });
    }
  }
}

type Align = 'left' | 'center' | 'right';

// ================================================================== document

/** Outline entries as a tree, in the order PDF viewers show bookmarks. */
interface OutlineNode {
  title: string;
  page: Page;
  y: number;
  children: OutlineNode[];
}

function outlineTree(
  entries: { level: number; title: string; page: Page; y: number }[],
): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: { level: number; node: OutlineNode }[] = [];
  for (const e of entries) {
    if (!e.title) continue;
    const node: OutlineNode = { title: e.title, page: e.page, y: e.y, children: [] };
    while (stack.length && stack[stack.length - 1]!.level >= e.level) stack.pop();
    (stack.length ? stack[stack.length - 1]!.node.children : roots).push(node);
    stack.push({ level: e.level, node });
  }
  return roots;
}

const pdfDate = (d: Date) =>
  `D:${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}${String(d.getUTCSeconds()).padStart(2, '0')}Z`;

export function astToPdf(
  ast: DocAst,
  opts: PdfOptions = {},
): { data: Uint8Array; report: ConversionReport } {
  const report = new ConversionReport();
  describeAst(ast, report);
  report.kept.delete('images'); // counted as they are placed
  report.kept.delete('links'); // counted when they stay clickable
  const file = new PdfFile();
  const catalog = file.reserve();
  const pagesRoot = file.reserve();
  const layout = new Layout(file, report, opts.images, opts.pageSize ?? 'a4');
  layout.blocks(ast.blocks, MARGIN, layout.contentWidth);
  layout.finishNotes();

  const { pages, w, h } = layout;
  const fonts = file.add(
    `<< ${FONT_NAMES.map((n, i) => `/F${i} << /Type /Font /Subtype /Type1 /BaseFont /${n} /Encoding /WinAnsiEncoding >>`).join(' ')} >>`,
  );
  const pageIds = pages.map(() => file.reserve());
  const total = pages.length;

  pages.forEach((page, i) => {
    // Page numbers go in the bottom margin.
    const label = encode(`${i + 1} / ${total}`);
    const lw = measure(label, 0, 8);
    page.ops.push(
      `BT /F0 8 Tf 0.55 0.55 0.53 rg ${num((w - lw) / 2)} 30 Td ${literal(label)} Tj ET`,
    );
    const content = file.stream('', binary([...page.bg, ...page.ops].join('\n')));
    const annots = page.links.map((l) =>
      file.add(
        `<< /Type /Annot /Subtype /Link /Rect [${l.rect.map(num).join(' ')}] /Border [0 0 0] /A << /S /URI /URI ${literal(encodeURI(l.uri).replace(/[^\x21-\x7e]/g, ''))} >> >>`,
      ),
    );
    const xobjects = [...page.images].map((name) => {
      const entry = [...layout.imageIds.values()].find((e) => e.name === name)!;
      return `/${name} ${(entry.result as { id: number }).id} 0 R`;
    });
    file.set(
      pageIds[i]!,
      `<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${num(w)} ${num(h)}] /Resources << /Font ${fonts} 0 R${xobjects.length ? ` /XObject << ${xobjects.join(' ')} >>` : ''} >> /Contents ${content} 0 R${annots.length ? ` /Annots [${annots.map((a) => `${a} 0 R`).join(' ')}]` : ''} >>`,
    );
  });
  file.set(
    pagesRoot,
    `<< /Type /Pages /Count ${total} /Kids [${pageIds.map((p) => `${p} 0 R`).join(' ')}] >>`,
  );

  // Bookmarks from the headings.
  const tree = outlineTree(layout.outline);
  let outlines: number | undefined;
  if (tree.length) {
    const build = (nodes: OutlineNode[], parent: number): number[] => {
      const ids = nodes.map(() => file.reserve());
      nodes.forEach((n, i) => {
        const kids = n.children.length ? build(n.children, ids[i]!) : [];
        const dest = `[${pageIds[pages.indexOf(n.page)]} 0 R /XYZ 0 ${num(h - n.y + 6)} null]`;
        file.set(
          ids[i]!,
          `<< /Title ${unicodeString(n.title)} /Parent ${parent} 0 R /Dest ${dest}` +
            (i > 0 ? ` /Prev ${ids[i - 1]} 0 R` : '') +
            (i < ids.length - 1 ? ` /Next ${ids[i + 1]} 0 R` : '') +
            (kids.length
              ? ` /First ${kids[0]} 0 R /Last ${kids[kids.length - 1]} 0 R /Count ${kids.length}`
              : '') +
            ' >>',
        );
      });
      return ids;
    };
    outlines = file.reserve();
    const top = build(tree, outlines);
    file.set(
      outlines,
      `<< /Type /Outlines /First ${top[0]} 0 R /Last ${top[top.length - 1]} 0 R /Count ${top.length} >>`,
    );
  }
  file.set(
    catalog,
    `<< /Type /Catalog /Pages ${pagesRoot} 0 R${outlines ? ` /Outlines ${outlines} 0 R` : ''} /ViewerPreferences << /DisplayDocTitle true >> >>`,
  );

  const m = ast.meta;
  const info = file.add(
    `<< /Producer ${unicodeString('MyDocs')} /Creator ${unicodeString('MyDocs')} /CreationDate (${pdfDate(opts.now ?? new Date())})` +
      (m.title ? ` /Title ${unicodeString(m.title)}` : '') +
      (m.author ? ` /Author ${unicodeString(m.author)}` : '') +
      (m.subject ? ` /Subject ${unicodeString(m.subject)}` : '') +
      (m.keywords?.length ? ` /Keywords ${unicodeString(m.keywords.join(', '))}` : '') +
      ' >>',
  );
  report.keep('pages', total);
  return { data: file.write(catalog, info), report };
}
