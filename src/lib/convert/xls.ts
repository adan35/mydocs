/**
 * Legacy Excel (.xls, BIFF8: Excel 97 to 2003) → workbook model.
 *
 * An .xls file is an OLE compound file holding a "Workbook" stream of BIFF records.
 * Kept: sheet names and order, numbers, text, booleans, errors, number formats
 * (dates, percentages), column widths, fill and text colors, and formulas (decoded
 * from Excel's token form back to text; a formula that uses something MyDocs can't
 * decode is kept as its saved value). Reported, not silently dropped: charts, images,
 * merged cells, other styling, macros. Excel 5/95 files and password-protected files
 * are refused with a clear message instead of guessing.
 *
 * Reading only. Writing BIFF8 is not attempted: edits are saved as .xlsx.
 */
import { ConversionReport } from './doc-ast';
import { sanitizeFormat, type SheetFormat } from './sheet-format';
import { BUILTIN_FORMATS } from './xlsx';
import { colName, isDateFormat, type Cell, type Sheet, type Workbook } from './workbook';

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
export const isOleFile = (d: Uint8Array) => d.length > 512 && OLE_MAGIC.every((b, i) => d[i] === b);

const u16 = (d: Uint8Array, o: number) => d[o]! | (d[o + 1]! << 8);
const u32 = (d: Uint8Array, o: number) =>
  (d[o]! | (d[o + 1]! << 8) | (d[o + 2]! << 16) | (d[o + 3]! << 24)) >>> 0;
const f64 = (d: Uint8Array, o: number) =>
  new DataView(d.buffer, d.byteOffset + o, 8).getFloat64(0, true);

// ================================================================== OLE container

const END = 0xfffffffa; // sector ids at or above this are markers, not sectors

/** The bytes of the named stream of an OLE compound file. */
function oleStream(d: Uint8Array, names: string[]): Uint8Array | null {
  const bad = () => new Error('This .xls file is damaged (its container could not be read).');
  const shift = u16(d, 0x1e);
  const miniShift = u16(d, 0x20);
  if (shift < 7 || shift > 16 || miniShift > shift) throw bad();
  const secSize = 1 << shift;
  const miniSize = 1 << miniShift;
  const sectorAt = (s: number) => {
    const o = (s + 1) * secSize;
    if (o >= d.length) throw bad();
    return d.subarray(o, Math.min(o + secSize, d.length));
  };

  // FAT: the sectors that say which sector follows which.
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) {
    const s = u32(d, 0x4c + i * 4);
    if (s < END) fatSectors.push(s);
  }
  let dif = u32(d, 0x44);
  for (let n = u32(d, 0x48); n > 0 && dif < END; n--) {
    const sec = sectorAt(dif);
    for (let i = 0; i < secSize / 4 - 1; i++) {
      const s = u32(sec, i * 4);
      if (s < END) fatSectors.push(s);
    }
    dif = u32(sec, secSize - 4);
  }
  const perSector = secSize / 4;
  const fat = new Uint32Array(fatSectors.length * perSector);
  fatSectors.forEach((s, k) => {
    const sec = sectorAt(s);
    for (let i = 0; i < perSector && i * 4 + 3 < sec.length; i++)
      fat[k * perSector + i] = u32(sec, i * 4);
  });

  const chain = (start: number, table: Uint32Array): number[] => {
    const out: number[] = [];
    for (let s = start; s < END && out.length <= table.length; s = table[s] ?? END) out.push(s);
    return out;
  };
  const read = (start: number, size: number): Uint8Array => {
    const out = new Uint8Array(size);
    let at = 0;
    for (const s of chain(start, fat)) {
      if (at >= size) break;
      const sec = sectorAt(s);
      out.set(sec.subarray(0, Math.min(sec.length, size - at)), at);
      at += secSize;
    }
    return out;
  };

  // Directory: 128-byte entries.
  const dirSectors = chain(u32(d, 0x30), fat);
  const dir = new Uint8Array(dirSectors.length * secSize);
  dirSectors.forEach((s, k) => dir.set(sectorAt(s), k * secSize));
  type Entry = { name: string; type: number; start: number; size: number };
  const entries: Entry[] = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const len = Math.max(0, Math.min(u16(dir, o + 64), 64) - 2);
    let name = '';
    for (let i = 0; i < len; i += 2) name += String.fromCharCode(u16(dir, o + i));
    entries.push({ name, type: dir[o + 66]!, start: u32(dir, o + 116), size: u32(dir, o + 120) });
  }
  const root = entries.find((e) => e.type === 5);
  const hit = names.map((n) => entries.find((e) => e.type === 2 && e.name === n)).find(Boolean);
  if (!hit) return null;

  const cutoff = u32(d, 0x38);
  if (hit.size >= cutoff || !root) return read(hit.start, hit.size);
  // Small streams live in the mini stream, in 64-byte sectors.
  const mini = read(root.start, root.size);
  const miniFatBytes = read(u32(d, 0x3c), u32(d, 0x40) * secSize);
  const miniFat = new Uint32Array(miniFatBytes.length / 4);
  for (let i = 0; i < miniFat.length; i++) miniFat[i] = u32(miniFatBytes, i * 4);
  const out = new Uint8Array(hit.size);
  let at = 0;
  for (const s of chain(hit.start, miniFat)) {
    if (at >= hit.size) break;
    out.set(mini.subarray(s * miniSize, s * miniSize + Math.min(miniSize, hit.size - at)), at);
    at += miniSize;
  }
  return out;
}

// ================================================================== strings

function latin1(d: Uint8Array, o: number, n: number): string {
  let s = '';
  for (let i = 0; i < n; i += 8192)
    s += String.fromCharCode(...d.subarray(o + i, o + Math.min(n, i + 8192)));
  return s;
}
const utf16 = new TextDecoder('utf-16le');
const chars = (d: Uint8Array, o: number, n: number, hi: boolean) =>
  hi ? utf16.decode(d.subarray(o, o + n * 2)) : latin1(d, o, n);

/** An XLUnicodeString (16-bit length) or ShortXLUnicodeString (8-bit) in one record. */
function ustr(d: Uint8Array, o: number, short = false): { s: string; end: number } {
  const n = short ? d[o]! : u16(d, o);
  o += short ? 1 : 2;
  const flags = d[o++]!;
  const runs = flags & 8 ? u16(d, o) : 0;
  if (flags & 8) o += 2;
  const ext = flags & 4 ? u32(d, o) : 0;
  if (flags & 4) o += 4;
  const hi = !!(flags & 1);
  const s = chars(d, o, n, hi);
  return { s, end: o + n * (hi ? 2 : 1) + runs * 4 + ext };
}

/** Reads strings from a record and its CONTINUE records, where a string may be split. */
class Chunks {
  private i = 0;
  private p = 0;
  constructor(private parts: Uint8Array[]) {}
  private get cur() {
    return this.parts[this.i]!;
  }
  private next(): boolean {
    if (this.i + 1 >= this.parts.length) return false;
    this.i++;
    this.p = 0;
    return true;
  }
  get done() {
    return this.i >= this.parts.length - 1 && this.p >= this.cur.length;
  }
  u8(): number {
    if (this.p >= this.cur.length && !this.next()) throw new Error('short record');
    return this.cur[this.p++]!;
  }
  u16(): number {
    return this.u8() | (this.u8() << 8);
  }
  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }
  skip(n: number) {
    while (n > 0) {
      if (this.p >= this.cur.length && !this.next()) return;
      const k = Math.min(n, this.cur.length - this.p);
      this.p += k;
      n -= k;
    }
  }
  string(): string {
    const n = this.u16();
    const flags = this.u8();
    const runs = flags & 8 ? this.u16() : 0;
    const ext = flags & 4 ? this.u32() : 0;
    let hi = !!(flags & 1);
    let left = n;
    let out = '';
    while (left > 0) {
      if (this.p >= this.cur.length) {
        // A string continued in the next record starts with its own "wide" flag.
        if (!this.next()) break;
        hi = !!(this.cur[this.p++]! & 1);
      }
      const unit = hi ? 2 : 1;
      const k = Math.min(left, Math.floor((this.cur.length - this.p) / unit));
      if (k <= 0) break;
      out += chars(this.cur, this.p, k, hi);
      this.p += k * unit;
      left -= k;
    }
    this.skip(runs * 4 + ext);
    return out;
  }
}

// ================================================================== formulas

/** Function names by BIFF function index (the ones MyDocs can write back as text). */
const FUNCS: Record<number, string> = {
  0: 'COUNT',
  1: 'IF',
  2: 'ISNA',
  3: 'ISERROR',
  4: 'SUM',
  5: 'AVERAGE',
  6: 'MIN',
  7: 'MAX',
  8: 'ROW',
  9: 'COLUMN',
  10: 'NA',
  11: 'NPV',
  12: 'STDEV',
  13: 'DOLLAR',
  14: 'FIXED',
  15: 'SIN',
  16: 'COS',
  17: 'TAN',
  18: 'ATAN',
  19: 'PI',
  20: 'SQRT',
  21: 'EXP',
  22: 'LN',
  23: 'LOG10',
  24: 'ABS',
  25: 'INT',
  26: 'SIGN',
  27: 'ROUND',
  28: 'LOOKUP',
  29: 'INDEX',
  30: 'REPT',
  31: 'MID',
  32: 'LEN',
  33: 'VALUE',
  34: 'TRUE',
  35: 'FALSE',
  36: 'AND',
  37: 'OR',
  38: 'NOT',
  39: 'MOD',
  46: 'VAR',
  48: 'TEXT',
  56: 'PV',
  57: 'FV',
  58: 'NPER',
  59: 'PMT',
  60: 'RATE',
  62: 'IRR',
  63: 'RAND',
  64: 'MATCH',
  65: 'DATE',
  66: 'TIME',
  67: 'DAY',
  68: 'MONTH',
  69: 'YEAR',
  70: 'WEEKDAY',
  71: 'HOUR',
  72: 'MINUTE',
  73: 'SECOND',
  74: 'NOW',
  76: 'ROWS',
  77: 'COLUMNS',
  78: 'OFFSET',
  82: 'SEARCH',
  83: 'TRANSPOSE',
  97: 'ATAN2',
  98: 'ASIN',
  99: 'ACOS',
  100: 'CHOOSE',
  101: 'HLOOKUP',
  102: 'VLOOKUP',
  109: 'LOG',
  111: 'CHAR',
  112: 'LOWER',
  113: 'UPPER',
  114: 'PROPER',
  115: 'LEFT',
  116: 'RIGHT',
  117: 'EXACT',
  118: 'TRIM',
  119: 'REPLACE',
  120: 'SUBSTITUTE',
  121: 'CODE',
  124: 'FIND',
  126: 'ISERR',
  127: 'ISTEXT',
  128: 'ISNUMBER',
  129: 'ISBLANK',
  130: 'T',
  131: 'N',
  140: 'DATEVALUE',
  141: 'TIMEVALUE',
  148: 'INDIRECT',
  162: 'CLEAN',
  169: 'COUNTA',
  183: 'PRODUCT',
  184: 'FACT',
  190: 'ISNONTEXT',
  193: 'STDEVP',
  194: 'VARP',
  197: 'TRUNC',
  198: 'ISLOGICAL',
  212: 'ROUNDUP',
  213: 'ROUNDDOWN',
  216: 'RANK',
  219: 'ADDRESS',
  220: 'DAYS360',
  221: 'TODAY',
  227: 'MEDIAN',
  228: 'SUMPRODUCT',
  285: 'FLOOR',
  288: 'CEILING',
  325: 'LARGE',
  326: 'SMALL',
  327: 'QUARTILE',
  328: 'PERCENTILE',
  336: 'CONCATENATE',
  337: 'POWER',
  344: 'SUBTOTAL',
  345: 'SUMIF',
  346: 'COUNTIF',
  347: 'COUNTBLANK',
  359: 'HYPERLINK',
};
/** Functions with a fixed number of arguments are stored without a count (ptgFunc). */
const FIXED_ARGS: Record<number, number> = {
  2: 1,
  3: 1,
  10: 0,
  15: 1,
  16: 1,
  17: 1,
  18: 1,
  19: 0,
  20: 1,
  21: 1,
  22: 1,
  23: 1,
  24: 1,
  25: 1,
  26: 1,
  27: 2,
  30: 2,
  31: 3,
  32: 1,
  33: 1,
  34: 0,
  35: 0,
  38: 1,
  39: 2,
  48: 2,
  63: 0,
  65: 3,
  66: 3,
  67: 1,
  68: 1,
  69: 1,
  71: 1,
  72: 1,
  73: 1,
  74: 0,
  76: 1,
  77: 1,
  83: 1,
  97: 2,
  98: 1,
  99: 1,
  111: 1,
  112: 1,
  113: 1,
  114: 1,
  117: 2,
  118: 1,
  119: 4,
  121: 1,
  126: 1,
  127: 1,
  128: 1,
  129: 1,
  130: 1,
  131: 1,
  140: 1,
  141: 1,
  162: 1,
  184: 1,
  190: 1,
  198: 1,
  212: 2,
  213: 2,
  221: 0,
  285: 2,
  288: 2,
  337: 2,
  346: 2,
  347: 1,
};
const ERRORS: Record<number, string> = {
  0x00: '#NULL!',
  0x07: '#DIV/0!',
  0x0f: '#VALUE!',
  0x17: '#REF!',
  0x1d: '#NAME?',
  0x24: '#NUM!',
  0x2a: '#N/A',
};
const BINARY: Record<number, string> = {
  3: '+',
  4: '-',
  5: '*',
  6: '/',
  7: '^',
  8: '&',
  9: '<',
  10: '<=',
  11: '=',
  12: '>=',
  13: '>',
  14: '<>',
};

interface FormulaContext {
  /** Sheet name for an index into EXTERNSHEET, or undefined when it is not in this workbook. */
  sheetFor(ixti: number): string | undefined;
}

const quoteSheet = (n: string) => (/^[A-Za-z_][\w.]*$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`);

/**
 * Turns a token array (RPN) into formula text. Throws on anything it doesn't know, and
 * the caller then keeps the cell's saved value instead of a formula that might be wrong.
 */
function decodeFormula(
  d: Uint8Array,
  start: number,
  size: number,
  row: number,
  col: number,
  ctx: FormulaContext,
): string {
  const stack: string[] = [];
  const pop = () => {
    const v = stack.pop();
    if (v === undefined) throw new Error('bad formula');
    return v;
  };
  const cellText = (rowField: number, colField: number, relative: boolean) => {
    const colRel = !!(colField & 0x4000);
    const rowRel = !!(colField & 0x8000);
    let c = colField & 0x3fff;
    let r = rowField;
    if (relative) {
      // Shared formulas store offsets from the cell, not positions.
      if (rowRel) r = (row + ((r << 16) >> 16) + 65536) % 65536;
      if (colRel) c = (col + ((c << 24) >> 24) + 256) % 256;
    }
    return `${colRel ? '' : '$'}${colName(c)}${rowRel ? '' : '$'}${r + 1}`;
  };
  const end = start + size;
  let p = start;
  while (p < end) {
    const raw = d[p++]!;
    const id = raw >= 0x20 ? (raw & 0x1f) | 0x20 : raw;
    if (id >= 3 && id <= 14) {
      const r = pop();
      stack.push(`${pop()}${BINARY[id]}${r}`);
      continue;
    }
    switch (id) {
      case 0x12:
        stack.push(`+${pop()}`);
        break;
      case 0x13:
        stack.push(`-${pop()}`);
        break;
      case 0x14:
        stack.push(`${pop()}%`);
        break;
      case 0x15:
        stack.push(`(${pop()})`);
        break;
      case 0x16: // missing argument: IF(A1,,2)
        stack.push('');
        break;
      case 0x11: {
        const r = pop();
        stack.push(`${pop()}:${r}`);
        break;
      }
      case 0x17: {
        const { s, end: e } = ustr(d, p, true);
        stack.push(`"${s.replace(/"/g, '""')}"`);
        p = e;
        break;
      }
      case 0x19: {
        // Attribute tokens: jumps and spacing, plus SUM(x) as a one-argument shortcut.
        const kind = d[p]!;
        if (kind & 0x04) p += 4 + (u16(d, p + 1) + 1) * 2 - 2;
        else p += 3;
        if (kind & 0x10) stack.push(`SUM(${pop()})`);
        break;
      }
      case 0x1c:
        stack.push(ERRORS[d[p++]!] ?? '#VALUE!');
        break;
      case 0x1d:
        stack.push(d[p++] ? 'TRUE' : 'FALSE');
        break;
      case 0x1e:
        stack.push(String(u16(d, p)));
        p += 2;
        break;
      case 0x1f:
        stack.push(String(f64(d, p)));
        p += 8;
        break;
      case 0x21:
      case 0x22: {
        const index = u16(d, id === 0x21 ? p : p + 1);
        const name = FUNCS[index];
        if (!name) throw new Error(`unknown function ${index}`);
        let n: number;
        if (id === 0x21) {
          n = FIXED_ARGS[index] ?? -1;
          if (n < 0) throw new Error(`unknown arity ${index}`);
          p += 2;
        } else {
          n = d[p]! & 0x7f;
          p += 3;
        }
        if (n > stack.length) throw new Error('bad formula');
        stack.push(`${name}(${n ? stack.splice(stack.length - n).join(',') : ''})`);
        break;
      }
      case 0x24:
      case 0x2c:
        stack.push(cellText(u16(d, p), u16(d, p + 2), id === 0x2c));
        p += 4;
        break;
      case 0x25:
      case 0x2d:
        stack.push(
          `${cellText(u16(d, p), u16(d, p + 4), id === 0x2d)}:${cellText(u16(d, p + 2), u16(d, p + 6), id === 0x2d)}`,
        );
        p += 8;
        break;
      case 0x3a:
      case 0x3b: {
        const sheet = ctx.sheetFor(u16(d, p));
        if (sheet === undefined) throw new Error('external reference');
        const q = p + 2;
        const ref =
          id === 0x3a
            ? cellText(u16(d, q), u16(d, q + 2), false)
            : `${cellText(u16(d, q), u16(d, q + 4), false)}:${cellText(u16(d, q + 2), u16(d, q + 6), false)}`;
        stack.push(`${quoteSheet(sheet)}!${ref}`);
        p = q + (id === 0x3a ? 4 : 8);
        break;
      }
      case 0x2a:
        stack.push('#REF!');
        p += 4;
        break;
      case 0x2b:
        stack.push('#REF!');
        p += 8;
        break;
      default:
        // Names, arrays, unions, intersections, external names: not decoded.
        throw new Error(`unsupported token 0x${raw.toString(16)}`);
    }
  }
  if (stack.length !== 1) throw new Error('bad formula');
  return stack[0]!;
}

// ================================================================== colors

/** Excel's default palette, indexes 8 to 63. A PALETTE record can replace entries. */
const PALETTE = [
  '000000',
  'ffffff',
  'ff0000',
  '00ff00',
  '0000ff',
  'ffff00',
  'ff00ff',
  '00ffff',
  '800000',
  '008000',
  '000080',
  '808000',
  '800080',
  '008080',
  'c0c0c0',
  '808080',
  '9999ff',
  '993366',
  'ffffcc',
  'ccffff',
  '660066',
  'ff8080',
  '0066cc',
  'ccccff',
  '000080',
  'ff00ff',
  'ffff00',
  '00ffff',
  '800080',
  '800000',
  '008080',
  '0000ff',
  '00ccff',
  'ccffff',
  'ccffcc',
  'ffff99',
  '99ccff',
  'ff99cc',
  'cc99ff',
  'ffcc99',
  '3366ff',
  '33cccc',
  '99cc00',
  'ffcc00',
  'ff9900',
  'ff6600',
  '666699',
  '969696',
  '003366',
  '339966',
  '003300',
  '333300',
  '993300',
  '993366',
  '333399',
  '333333',
].map((h) => `#${h}`);

// ================================================================== reading

interface Xf {
  fmtId: number;
  font: number;
  /** Fill pattern (1 = solid) and its foreground color index. */
  fill: number;
  fore: number;
}
interface XfStyle {
  fmt?: string;
  date: boolean;
  bg?: string;
  fg?: string;
}

const R = {
  EOF: 0x0a,
  CONTINUE: 0x3c,
  BOF: 0x809,
  SST: 0xfc,
  LABELSST: 0xfd,
  LABEL: 0x204,
  NUMBER: 0x203,
  RK: 0x27e,
  MULRK: 0xbd,
  BOOLERR: 0x205,
  BLANK: 0x201,
  MULBLANK: 0xbe,
  FORMULA: 0x06,
  STRING: 0x207,
  SHRFMLA: 0x4bc,
  BOUNDSHEET: 0x85,
  FORMAT: 0x41e,
  XF: 0xe0,
  FONT: 0x31,
  PALETTE: 0x92,
  DATEMODE: 0x22,
  FILEPASS: 0x2f,
  EXTERNSHEET: 0x17,
  SUPBOOK: 0x1ae,
  COLINFO: 0x7d,
  MERGED: 0xe5,
  CODEPAGE: 0x42,
};

export function xlsToWorkbook(data: Uint8Array): { workbook: Workbook; report: ConversionReport } {
  const report = new ConversionReport();
  if (!isOleFile(data)) throw new Error('This is not an Excel 97-2003 (.xls) file.');
  if (oleStream(data, ['EncryptedPackage']))
    throw new Error('This workbook is password-protected. Remove the password in Excel first.');
  const stream = oleStream(data, ['Workbook', 'Book']);
  if (!stream) throw new Error('This file has no Excel workbook inside it.');
  const d: Uint8Array = stream;
  if (u16(d, 0) !== R.BOF) throw new Error('This is not an Excel workbook stream.');
  const version = u16(d, 4);
  if (version !== 0x600)
    throw new Error(
      'This workbook was saved by Excel 5/95 or older, which MyDocs cannot read. Open it in Excel and save it as .xlsx.',
    );

  // ---------------------------------------------------------------- workbook globals
  const palette = [...PALETTE];
  const fonts: (string | undefined)[] = [];
  const xfs: Xf[] = [];
  const customFormats = new Map<number, string>();
  const boundSheets: { name: string; offset: number; kind: number; hidden: number }[] = [];
  const xtis: { book: number; first: number; last: number }[] = [];
  const internalBooks = new Set<number>();
  let bookCount = 0;
  let date1904 = false;
  let strings: string[] = [];

  let p = 0;
  for (let depth = 0; p + 4 <= d.length;) {
    const id = u16(d, p);
    const len = u16(d, p + 2);
    const o = p + 4;
    p = o + len;
    if (id === R.BOF) depth++;
    else if (id === R.EOF) {
      if (--depth <= 0) break;
    } else if (depth !== 1) continue;
    else if (id === R.FILEPASS)
      throw new Error('This workbook is password-protected. Remove the password in Excel first.');
    else if (id === R.DATEMODE) date1904 = d[o] === 1;
    else if (id === R.BOUNDSHEET)
      boundSheets.push({
        offset: u32(d, o),
        hidden: d[o + 4]!,
        kind: d[o + 5]!,
        name: ustr(d, o + 6, true).s,
      });
    else if (id === R.SST) {
      const parts = [d.subarray(o, o + len)];
      while (p + 4 <= d.length && u16(d, p) === R.CONTINUE) {
        const l = u16(d, p + 2);
        parts.push(d.subarray(p + 4, p + 4 + l));
        p += 4 + l;
      }
      const c = new Chunks(parts);
      c.u32();
      const unique = c.u32();
      strings = new Array<string>(Math.min(unique, 4_000_000));
      try {
        for (let i = 0; i < strings.length; i++) strings[i] = c.string();
      } catch {
        // A truncated table: the strings read so far are kept.
      }
    } else if (id === R.FORMAT) customFormats.set(u16(d, o), ustr(d, o + 2).s);
    else if (id === R.FONT) {
      const icv = u16(d, o + 4);
      fonts.push(icv >= 8 && icv < 64 ? palette[icv - 8] : undefined);
      if (fonts.length === 4) fonts.push(undefined); // font index 4 does not exist
    } else if (id === R.XF) {
      const fillBits = u32(d, o + 14);
      xfs.push({
        font: u16(d, o),
        fmtId: u16(d, o + 2),
        fill: fillBits >>> 26,
        fore: u16(d, o + 18) & 0x7f,
      });
    } else if (id === R.PALETTE) {
      const n = u16(d, o);
      for (let i = 0; i < n && i + 8 < 64; i++) {
        const q = o + 2 + i * 4;
        palette[i] = `#${[0, 1, 2].map((k) => d[q + k]!.toString(16).padStart(2, '0')).join('')}`;
      }
    } else if (id === R.SUPBOOK) {
      // 0x0401 in the second field marks the workbook's own sheets.
      if (len === 4 && u16(d, o + 2) === 0x0401) internalBooks.add(bookCount);
      bookCount++;
    } else if (id === R.EXTERNSHEET) {
      const n = u16(d, o);
      for (let i = 0; i < n; i++)
        xtis.push({
          book: u16(d, o + 2 + i * 6),
          first: u16(d, o + 4 + i * 6),
          last: u16(d, o + 6 + i * 6),
        });
    }
  }
  if (!boundSheets.length) throw new Error('This workbook has no sheets.');

  const colorOf = (idx: number) => (idx >= 8 && idx < 64 ? palette[idx - 8] : undefined);
  let localeDates = false;
  let unknownFormat = false;
  const styles: XfStyle[] = xfs.map((xf) => {
    let code: string | undefined = customFormats.get(xf.fmtId) ?? BUILTIN_FORMATS[xf.fmtId];
    if (!code && xf.fmtId) {
      if ((xf.fmtId >= 27 && xf.fmtId <= 36) || (xf.fmtId >= 50 && xf.fmtId <= 58)) {
        code = 'yyyy-mm-dd'; // locale-dependent date formats
        localeDates = true;
      } else unknownFormat = true;
    }
    if (code === 'General') code = undefined;
    const fg = fonts[xf.font];
    return {
      fmt: code,
      date: !!code && isDateFormat(code),
      bg: xf.fill === 1 ? colorOf(xf.fore) : undefined,
      // Black is the default text color; keeping it would make text unreadable on dark themes.
      fg: fg === '#000000' ? undefined : fg,
    };
  });
  if (localeDates) report.note('Locale-specific date formats are shown as yyyy-mm-dd.', 'info');
  if (unknownFormat)
    report.note('Some locale-specific number formats were shown as plain numbers.', 'info');
  if (date1904)
    report.note('This workbook uses the 1904 date system; dates are shown in the 1900 system.');

  const sheetNames = boundSheets.map((s) => s.name);
  const ctx: FormulaContext = {
    sheetFor(ixti) {
      const x = xtis[ixti];
      if (!x || !internalBooks.has(x.book) || x.first !== x.last) return undefined;
      return sheetNames[x.first];
    },
  };

  // ---------------------------------------------------------------- sheets
  let valueOnly = 0;
  const sheets: Sheet[] = [];
  for (const bs of boundSheets) {
    if (bs.kind !== 0) {
      report.note('Chart sheets and macro sheets were not imported.');
      continue;
    }
    if (bs.hidden) report.note('Hidden sheets are shown.', 'info');
    sheets.push(readSheet(bs.name, bs.offset));
  }
  if (!sheets.length) sheets.push({ name: 'Sheet1', rows: [] });
  if (valueOnly)
    report.note(
      `${valueOnly.toLocaleString()} formula${valueOnly === 1 ? ' was' : 's were'} imported as ${valueOnly === 1 ? 'its' : 'their'} saved value (names, arrays and some functions can't be read from .xls).`,
      'info',
    );
  report.note(
    'Fill and text colors are kept. Other styling (fonts, bold, borders), charts and images are not shown and are dropped when the workbook is saved as .xlsx.',
    'info',
  );
  return { workbook: { sheets }, report };

  function readSheet(name: string, offset: number): Sheet {
    const sheet: Sheet = { name, rows: [] };
    const rows = sheet.rows;
    const colors: Required<SheetFormat> = { cells: {}, rows: {}, cols: {} };
    const widths: number[] = [];
    const shared = new Map<string, Uint8Array>();
    const pending: { cell: Cell; r: number; c: number; key: string }[] = [];
    let wantString: Cell | null = null;
    let merged = false;

    const put = (r: number, c: number, xf: number, cell: Cell | undefined) => {
      const st = styles[xf];
      if (st?.bg || st?.fg) colors.cells[`${r},${c}`] = { bg: st.bg ?? '', fg: st.fg ?? '' };
      if (!cell) return;
      while (rows.length <= r) rows.push([]);
      rows[r]![c] = cell;
    };
    const numeric = (v: number, xf: number): Cell => {
      const st = styles[xf];
      const cell: Cell = { v: st?.date && date1904 ? v + 1462 : v };
      if (st?.fmt) cell.fmt = st.fmt;
      return cell;
    };
    const rk = (o: number) => {
      const raw = u32(d, o);
      let v: number;
      if (raw & 2) v = (raw | 0) >> 2;
      else {
        const b = new DataView(new ArrayBuffer(8));
        b.setUint32(4, raw & 0xfffffffc, true);
        v = b.getFloat64(0, true);
      }
      return raw & 1 ? v / 100 : v;
    };

    let p = offset;
    for (let depth = 0; p + 4 <= d.length;) {
      const id = u16(d, p);
      let len = u16(d, p + 2);
      const o = p + 4;
      p = o + len;
      if (id === R.BOF) {
        depth++;
        continue;
      }
      if (id === R.EOF) {
        if (--depth <= 0) break;
        continue;
      }
      if (depth !== 1) continue; // an embedded chart or macro substream

      switch (id) {
        case R.LABELSST: {
          const s = strings[u32(d, o + 6)];
          if (s !== undefined && s !== '') put(u16(d, o), u16(d, o + 2), u16(d, o + 4), { v: s });
          else put(u16(d, o), u16(d, o + 2), u16(d, o + 4), undefined);
          break;
        }
        case R.LABEL: {
          const s = ustr(d, o + 6).s;
          put(u16(d, o), u16(d, o + 2), u16(d, o + 4), s === '' ? undefined : { v: s });
          break;
        }
        case R.NUMBER:
          put(u16(d, o), u16(d, o + 2), u16(d, o + 4), numeric(f64(d, o + 6), u16(d, o + 4)));
          break;
        case R.RK:
          put(u16(d, o), u16(d, o + 2), u16(d, o + 4), numeric(rk(o + 6), u16(d, o + 4)));
          break;
        case R.MULRK: {
          const r = u16(d, o);
          const first = u16(d, o + 2);
          const n = (len - 6) / 6;
          for (let i = 0; i < n; i++) {
            const xf = u16(d, o + 4 + i * 6);
            put(r, first + i, xf, numeric(rk(o + 6 + i * 6), xf));
          }
          break;
        }
        case R.BOOLERR: {
          const xf = u16(d, o + 4);
          const val = d[o + 6]!;
          put(
            u16(d, o),
            u16(d, o + 2),
            xf,
            d[o + 7] ? { v: { error: ERRORS[val] ?? '#VALUE!' } } : { v: !!val },
          );
          break;
        }
        case R.BLANK:
          put(u16(d, o), u16(d, o + 2), u16(d, o + 4), undefined);
          break;
        case R.MULBLANK: {
          const r = u16(d, o);
          const first = u16(d, o + 2);
          const n = (len - 6) / 2;
          for (let i = 0; i < n; i++) put(r, first + i, u16(d, o + 4 + i * 2), undefined);
          break;
        }
        case R.FORMULA: {
          const r = u16(d, o);
          const c = u16(d, o + 2);
          const xf = u16(d, o + 4);
          let cell: Cell;
          wantString = null;
          if (u16(d, o + 12) === 0xffff) {
            const kind = d[o + 6]!;
            if (kind === 1) cell = { v: !!d[o + 8] };
            else if (kind === 2) cell = { v: { error: ERRORS[d[o + 8]!] ?? '#VALUE!' } };
            else {
              cell = { v: '' }; // text result follows in a STRING record, or an empty string
              if (kind === 0) wantString = cell;
            }
          } else cell = numeric(f64(d, o + 6), xf);
          put(r, c, xf, cell);
          const cce = u16(d, o + 20);
          const rgce = o + 22;
          if (d[rgce] === 0x01 && cce === 5)
            pending.push({ cell, r, c, key: `${u16(d, rgce + 1)},${u16(d, rgce + 3)}` });
          else
            try {
              cell.f = decodeFormula(d, rgce, cce, r, c, ctx);
            } catch {
              valueOnly++;
            }
          break;
        }
        case R.SHRFMLA:
          shared.set(`${u16(d, o)},${d[o + 4]}`, d.subarray(o + 10, o + 10 + u16(d, o + 8)));
          break;
        case R.STRING: {
          if (!wantString) break;
          const parts = [d.subarray(o, o + len)];
          while (p + 4 <= d.length && u16(d, p) === R.CONTINUE) {
            len = u16(d, p + 2);
            parts.push(d.subarray(p + 4, p + 4 + len));
            p += 4 + len;
          }
          try {
            wantString.v = new Chunks(parts).string();
          } catch {
            wantString.v = ustr(d, o).s;
          }
          wantString = null;
          break;
        }
        case R.COLINFO: {
          const first = u16(d, o);
          const last = Math.min(u16(d, o + 2), first + 255);
          const w = u16(d, o + 4) / 256;
          if (w > 0 && !(u16(d, o + 8) & 1)) for (let k = first; k <= last; k++) widths[k] = w;
          break;
        }
        case R.MERGED:
          merged = true;
          break;
      }
    }

    // Shared formulas: one stored formula, shifted for each cell that uses it.
    for (const { cell, r, c, key } of pending) {
      const rgce = shared.get(key);
      try {
        if (!rgce) throw new Error('no shared formula');
        cell.f = decodeFormula(rgce, 0, rgce.length, r, c, ctx);
      } catch {
        valueOnly++;
      }
    }
    if (merged) report.note('Merged cells were unmerged; the value stays in the first cell.');
    if (widths.length) sheet.widths = widths;
    const format = sanitizeFormat(colors);
    if (format) sheet.format = format;
    return sheet;
  }
}
