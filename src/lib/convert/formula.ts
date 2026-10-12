/**
 * A spreadsheet formula engine for the common subset: arithmetic, comparison and text
 * operators, cell and range references (also across sheets), and the everyday
 * functions. A formula using anything outside the subset is not guessed at: its cell
 * keeps the value saved in the file and is marked as not recalculated.
 */
import {
  colIndex,
  colName,
  isError,
  type Cell,
  type CellValue,
  type Sheet,
  type Workbook,
  type ErrorValue,
} from './workbook';

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'err'; v: string }
  | { t: 'ref'; sheet?: string; a: string; b?: string }
  | { t: 'fn'; v: string }
  | { t: 'op'; v: string }
  | { t: '(' }
  | { t: ')' }
  | { t: ',' };

export class FormulaError extends Error {
  override name = 'FormulaError';
}

const REF = String.raw`\$?[A-Za-z]{1,3}\$?\d+`;
const SHEET = String.raw`(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!`;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const re = {
    num: /^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/,
    ref: new RegExp(`^(?:${SHEET})?(${REF})(?::(${REF}))?`),
    col: new RegExp(`^(?:${SHEET})?(\\$?[A-Za-z]{1,3}):(\\$?[A-Za-z]{1,3})(?![\\w(])`),
    name: /^[A-Za-z_][\w.]*/,
  };
  while (i < src.length) {
    const ch = src[i]!;
    const rest = src.slice(i);
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let s = '';
      for (;;) {
        if (j >= src.length) throw new FormulaError('Unterminated text');
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            s += '"';
            j += 2;
            continue;
          }
          break;
        }
        s += src[j++];
      }
      out.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    if (ch === '#') {
      const m = /^#(DIV\/0!|N\/A|NAME\?|NULL!|NUM!|REF!|VALUE!)/.exec(rest);
      if (!m) throw new FormulaError('Unknown error value');
      out.push({ t: 'err', v: m[0] });
      i += m[0].length;
      continue;
    }
    const col = re.col.exec(rest);
    if (col) {
      const sheet = col[1]?.replace(/''/g, "'") ?? col[2];
      out.push({ t: 'ref', sheet, a: `${col[3]}1`, b: `${col[4]}1048576` });
      i += col[0].length;
      continue;
    }
    const ref = re.ref.exec(rest);
    if (ref && !/^[(\w]/.test(rest.slice(ref[0].length))) {
      const sheet = ref[1]?.replace(/''/g, "'") ?? ref[2];
      out.push({ t: 'ref', sheet, a: ref[3]!, b: ref[4] });
      i += ref[0].length;
      continue;
    }
    const num = re.num.exec(rest);
    if (num) {
      out.push({ t: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const name = re.name.exec(rest);
    if (name) {
      const n = name[0].toUpperCase();
      i += name[0].length;
      if (src[i] === '(') out.push({ t: 'fn', v: n.replace(/^_XLFN\./, '') });
      else if (n === 'TRUE' || n === 'FALSE') out.push({ t: 'bool', v: n === 'TRUE' });
      else throw new FormulaError(`Unknown name ${name[0]}`);
      continue;
    }
    const op = /^(<=|>=|<>|[-+*/^&=<>%])/.exec(rest);
    if (op) {
      out.push({ t: 'op', v: op[0] });
      i += op[0].length;
      continue;
    }
    if (ch === '(' || ch === ')' || ch === ',' || ch === ';') {
      out.push(ch === ';' ? { t: ',' } : ({ t: ch } as Tok));
      i++;
      continue;
    }
    throw new FormulaError(`Unexpected "${ch}"`);
  }
  return out;
}

export type Node =
  | { k: 'lit'; v: CellValue }
  | { k: 'ref'; sheet?: string; a: string; b?: string }
  | { k: 'un'; op: string; x: Node }
  | { k: 'bin'; op: string; l: Node; r: Node }
  | { k: 'call'; fn: string; args: Node[] };

const PREC: Record<string, number> = {
  '=': 1,
  '<>': 1,
  '<': 1,
  '>': 1,
  '<=': 1,
  '>=': 1,
  '&': 2,
  '+': 3,
  '-': 3,
  '*': 4,
  '/': 4,
  '^': 5,
};

export function parseFormula(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const expr = (min: number): Node => {
    let left = unary();
    for (;;) {
      const t = peek();
      if (!t || t.t !== 'op' || PREC[t.v] === undefined || PREC[t.v]! < min) break;
      p++;
      const prec = PREC[t.v]!;
      const right = expr(t.v === '^' ? prec : prec + 1);
      left = { k: 'bin', op: t.v, l: left, r: right };
    }
    return left;
  };
  const unary = (): Node => {
    const t = peek();
    if (t?.t === 'op' && (t.v === '-' || t.v === '+')) {
      p++;
      return { k: 'un', op: t.v, x: unary() };
    }
    let n = primary();
    while (peek()?.t === 'op' && (peek() as { v: string }).v === '%') {
      p++;
      n = { k: 'un', op: '%', x: n };
    }
    return n;
  };
  const primary = (): Node => {
    const t = toks[p++];
    if (!t) throw new FormulaError('Formula ends early');
    switch (t.t) {
      case 'num':
      case 'str':
      case 'bool':
        return { k: 'lit', v: t.v };
      case 'err':
        return { k: 'lit', v: { error: t.v } };
      case 'ref':
        return { k: 'ref', sheet: t.sheet, a: t.a, b: t.b };
      case '(': {
        const e = expr(0);
        if (toks[p++]?.t !== ')') throw new FormulaError('Missing )');
        return e;
      }
      case 'fn': {
        if (toks[p++]?.t !== '(') throw new FormulaError('Missing (');
        const args: Node[] = [];
        if (peek()?.t === ')') {
          p++;
          return { k: 'call', fn: t.v, args };
        }
        for (;;) {
          if (peek()?.t === ',' || peek()?.t === ')') args.push({ k: 'lit', v: null });
          else args.push(expr(0));
          const sep = toks[p++];
          if (sep?.t === ')') break;
          if (sep?.t !== ',') throw new FormulaError('Expected , or )');
        }
        return { k: 'call', fn: t.v, args };
      }
      default:
        throw new FormulaError('Unexpected token');
    }
  };
  const n = expr(0);
  if (p !== toks.length) throw new FormulaError('Unexpected text after the formula');
  return n;
}

// ------------------------------------------------------------------ evaluation

const err = (e: string): ErrorValue => ({ error: e });
const E = {
  div0: err('#DIV/0!'),
  value: err('#VALUE!'),
  ref: err('#REF!'),
  name: err('#NAME?'),
  na: err('#N/A'),
  num: err('#NUM!'),
  circ: err('#CIRC!'),
};

/** Thrown when a formula uses something this engine doesn't implement. */
class Unsupported extends Error {}

type Value = CellValue | Value[][];

function toNum(v: Value): number | ErrorValue {
  if (Array.isArray(v)) return toNum(v[0]?.[0] ?? null);
  if (v === null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (isError(v)) return v;
  const n = Number(v.trim().replace(/,/g, ''));
  return v.trim() !== '' && Number.isFinite(n) ? n : E.value;
}

function toStr(v: Value): string | ErrorValue {
  if (Array.isArray(v)) return toStr(v[0]?.[0] ?? null);
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (isError(v)) return v;
  return typeof v === 'number' ? String(Number(v.toPrecision(15))) : v;
}

function toBool(v: Value): boolean | ErrorValue {
  if (Array.isArray(v)) return toBool(v[0]?.[0] ?? null);
  if (typeof v === 'boolean') return v;
  if (v === null) return false;
  if (typeof v === 'number') return v !== 0;
  if (isError(v)) return v;
  if (/^true$/i.test(v)) return true;
  if (/^false$/i.test(v)) return false;
  return E.value;
}

const flat = (args: Value[]): CellValue[] =>
  args.flatMap((a) => (Array.isArray(a) ? (a.flat(2) as CellValue[]) : [a]));

/** Numbers among the arguments; text and booleans inside ranges are skipped, like spreadsheets do. */
function numbers(args: Value[]): number[] | ErrorValue {
  const out: number[] = [];
  for (const a of args) {
    if (Array.isArray(a)) {
      for (const v of a.flat(2) as CellValue[]) {
        if (isError(v)) return v;
        if (typeof v === 'number') out.push(v);
      }
    } else {
      const n = toNum(a);
      if (isError(n)) return n;
      out.push(n);
    }
  }
  return out;
}

function criteria(c: Value): (v: CellValue) => boolean {
  const s = toStr(c);
  if (isError(s)) return () => false;
  const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(s)!;
  const op = m[1] ?? '=';
  const rhs = m[2]!;
  const rn = rhs.trim() !== '' && Number.isFinite(Number(rhs)) ? Number(rhs) : null;
  const wild = rhs.includes('*') || rhs.includes('?');
  const rx = wild
    ? new RegExp(
        `^${rhs
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.')}$`,
        'i',
      )
    : null;
  return (v) => {
    if (rn !== null && typeof v === 'number') {
      switch (op) {
        case '=':
          return v === rn;
        case '<>':
          return v !== rn;
        case '<':
          return v < rn;
        case '>':
          return v > rn;
        case '<=':
          return v <= rn;
        case '>=':
          return v >= rn;
      }
    }
    const vs = v === null ? '' : typeof v === 'object' ? v.error : String(v);
    const eq = rx ? rx.test(vs) : vs.toLowerCase() === rhs.toLowerCase();
    if (op === '=') return eq;
    if (op === '<>') return !eq;
    if (rn !== null) return false;
    const cmp = vs.localeCompare(rhs, undefined, { sensitivity: 'base' });
    return op === '<' ? cmp < 0 : op === '>' ? cmp > 0 : op === '<=' ? cmp <= 0 : cmp >= 0;
  };
}

function round(n: number, d: number, mode: 'round' | 'up' | 'down' = 'round'): number {
  const f = 10 ** d;
  const x = n * f;
  const r =
    mode === 'round'
      ? Math.sign(x) * Math.round(Math.abs(x) + 1e-9)
      : mode === 'up'
        ? Math.sign(x) * Math.ceil(Math.abs(x) - 1e-9)
        : Math.trunc(x);
  return r / f;
}

type Fn = (args: Value[], raw: Node[], ev: (n: Node) => Value) => Value;

const FUNCS: Record<string, Fn> = {
  SUM: (a) => {
    const n = numbers(a);
    return isError(n) ? n : n.reduce((x, y) => x + y, 0);
  },
  AVERAGE: (a) => {
    const n = numbers(a);
    return isError(n) ? n : n.length ? n.reduce((x, y) => x + y, 0) / n.length : E.div0;
  },
  MIN: (a) => {
    const n = numbers(a);
    return isError(n) ? n : n.length ? Math.min(...n) : 0;
  },
  MAX: (a) => {
    const n = numbers(a);
    return isError(n) ? n : n.length ? Math.max(...n) : 0;
  },
  COUNT: (a) => flat(a).filter((v) => typeof v === 'number').length,
  COUNTA: (a) => flat(a).filter((v) => v !== null && v !== '').length,
  COUNTBLANK: (a) => flat(a).filter((v) => v === null || v === '').length,
  PRODUCT: (a) => {
    const n = numbers(a);
    return isError(n) ? n : n.reduce((x, y) => x * y, 1);
  },
  ROUND: ([x, d]) => {
    const n = toNum(x!);
    const k = toNum(d ?? 0);
    return isError(n) ? n : isError(k) ? k : round(n, k);
  },
  ROUNDUP: ([x, d]) => {
    const n = toNum(x!);
    const k = toNum(d ?? 0);
    return isError(n) ? n : isError(k) ? k : round(n, k, 'up');
  },
  ROUNDDOWN: ([x, d]) => {
    const n = toNum(x!);
    const k = toNum(d ?? 0);
    return isError(n) ? n : isError(k) ? k : round(n, k, 'down');
  },
  INT: ([x]) => {
    const n = toNum(x!);
    return isError(n) ? n : Math.floor(n);
  },
  ABS: ([x]) => {
    const n = toNum(x!);
    return isError(n) ? n : Math.abs(n);
  },
  SQRT: ([x]) => {
    const n = toNum(x!);
    return isError(n) ? n : n < 0 ? E.num : Math.sqrt(n);
  },
  POWER: ([x, y]) => {
    const a = toNum(x!);
    const b = toNum(y!);
    return isError(a) ? a : isError(b) ? b : a ** b;
  },
  MOD: ([x, y]) => {
    const a = toNum(x!);
    const b = toNum(y!);
    return isError(a) ? a : isError(b) ? b : b === 0 ? E.div0 : a - b * Math.floor(a / b);
  },
  PI: () => Math.PI,
  TRUE: () => true,
  FALSE: () => false,
  IF: (_a, raw, ev) => {
    const c = toBool(ev(raw[0]!));
    if (isError(c)) return c;
    return c ? (raw[1] ? ev(raw[1]) : true) : raw[2] ? ev(raw[2]) : false;
  },
  IFERROR: (_a, raw, ev) => {
    const v = ev(raw[0]!);
    const s = Array.isArray(v) ? v[0]?.[0] : v;
    return isError(s ?? null) ? ev(raw[1]!) : v;
  },
  AND: (a) => {
    for (const v of flat(a)) {
      const b = toBool(v);
      if (isError(b)) return b;
      if (!b) return false;
    }
    return true;
  },
  OR: (a) => {
    for (const v of flat(a)) {
      const b = toBool(v);
      if (isError(b)) return b;
      if (b) return true;
    }
    return false;
  },
  NOT: ([x]) => {
    const b = toBool(x!);
    return isError(b) ? b : !b;
  },
  CONCAT: (a) => {
    let s = '';
    for (const v of flat(a)) {
      const t = toStr(v);
      if (isError(t)) return t;
      s += t;
    }
    return s;
  },
  CONCATENATE: (a) => FUNCS.CONCAT!(a, [], () => null),
  TEXTJOIN: ([d, skip, ...rest]) => {
    const sep = toStr(d!);
    const sk = toBool(skip!);
    if (isError(sep)) return sep;
    if (isError(sk)) return sk;
    const parts: string[] = [];
    for (const v of flat(rest)) {
      const t = toStr(v);
      if (isError(t)) return t;
      if (!sk || t !== '') parts.push(t);
    }
    return parts.join(sep);
  },
  LEN: ([x]) => {
    const s = toStr(x!);
    return isError(s) ? s : s.length;
  },
  UPPER: ([x]) => {
    const s = toStr(x!);
    return isError(s) ? s : s.toUpperCase();
  },
  LOWER: ([x]) => {
    const s = toStr(x!);
    return isError(s) ? s : s.toLowerCase();
  },
  TRIM: ([x]) => {
    const s = toStr(x!);
    return isError(s) ? s : s.trim().replace(/ +/g, ' ');
  },
  LEFT: ([x, n]) => {
    const s = toStr(x!);
    const k = toNum(n ?? 1);
    return isError(s) ? s : isError(k) ? k : s.slice(0, k);
  },
  RIGHT: ([x, n]) => {
    const s = toStr(x!);
    const k = toNum(n ?? 1);
    return isError(s) ? s : isError(k) ? k : k ? s.slice(-k) : '';
  },
  MID: ([x, st, n]) => {
    const s = toStr(x!);
    const a = toNum(st!);
    const k = toNum(n!);
    return isError(s) ? s : isError(a) ? a : isError(k) ? k : s.slice(a - 1, a - 1 + k);
  },
  SUMIF: ([range, crit, sumRange]) => {
    const test = criteria(crit!);
    const r = (Array.isArray(range) ? range : [[range!]]) as CellValue[][];
    const s = (
      Array.isArray(sumRange) ? sumRange : sumRange === undefined ? r : [[sumRange]]
    ) as CellValue[][];
    let total = 0;
    r.forEach((row, i) =>
      row.forEach((v, j) => {
        const x = s[i]?.[j];
        if (test(v) && typeof x === 'number') total += x;
      }),
    );
    return total;
  },
  COUNTIF: ([range, crit]) => {
    const test = criteria(crit!);
    return flat([range!]).filter(test).length;
  },
  AVERAGEIF: ([range, crit, avgRange]) => {
    const test = criteria(crit!);
    const r = (Array.isArray(range) ? range : [[range!]]) as CellValue[][];
    const s = (
      Array.isArray(avgRange) ? avgRange : avgRange === undefined ? r : [[avgRange]]
    ) as CellValue[][];
    const vals: number[] = [];
    r.forEach((row, i) =>
      row.forEach((v, j) => {
        const x = s[i]?.[j];
        if (test(v) && typeof x === 'number') vals.push(x);
      }),
    );
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : E.div0;
  },
};

export const SUPPORTED_FUNCTIONS = Object.keys(FUNCS).sort();

export interface EvalResult {
  value: CellValue;
  /** The formula used something outside the supported subset. */
  unsupported?: boolean;
}

/**
 * Evaluates every formula in the workbook in place. Cells whose formulas can't be
 * evaluated keep their cached value and get `stale: true`.
 */
export function recalculate(wb: Workbook): { stale: number } {
  const byName = new Map(wb.sheets.map((s) => [s.name.toLowerCase(), s]));
  const state = new Map<Cell, 'busy' | 'done'>();
  const parsed = new Map<string, Node | Error>();
  let stale = 0;

  const cellValue = (sheet: Sheet, r: number, c: number): CellValue => {
    const cell = sheet.rows[r]?.[c];
    if (!cell) return null;
    if (cell.f !== undefined) compute(sheet, cell);
    return cell.v;
  };

  const resolve = (sheet: Sheet, n: Extract<Node, { k: 'ref' }>): Value => {
    const target = n.sheet ? byName.get(n.sheet.toLowerCase()) : sheet;
    if (!target) return E.ref;
    const pa = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(n.a);
    const pb = n.b ? /^\$?([A-Za-z]+)\$?(\d+)$/.exec(n.b) : pa;
    if (!pa || !pb) return E.ref;
    let r1 = Number(pa[2]) - 1;
    let r2 = Number(pb[2]) - 1;
    let c1 = colIndex(pa[1]!);
    let c2 = colIndex(pb[1]!);
    if (r1 > r2) [r1, r2] = [r2, r1];
    if (c1 > c2) [c1, c2] = [c2, c1];
    if (!n.b) return cellValue(target, r1, c1);
    r2 = Math.min(r2, target.rows.length - 1);
    const out: CellValue[][] = [];
    for (let r = r1; r <= r2; r++) {
      const row: CellValue[] = [];
      for (let c = c1; c <= c2; c++) row.push(cellValue(target, r, c));
      out.push(row);
    }
    return out;
  };

  const evalNode = (sheet: Sheet, n: Node): Value => {
    switch (n.k) {
      case 'lit':
        return n.v;
      case 'ref':
        return resolve(sheet, n);
      case 'un': {
        const x = toNum(evalNode(sheet, n.x));
        if (isError(x)) return x;
        return n.op === '-' ? -x : n.op === '%' ? x / 100 : x;
      }
      case 'bin': {
        const l = evalNode(sheet, n.l);
        const r = evalNode(sheet, n.r);
        if (n.op === '&') {
          const a = toStr(l);
          const b = toStr(r);
          return isError(a) ? a : isError(b) ? b : a + b;
        }
        if (['=', '<>', '<', '>', '<=', '>='].includes(n.op)) {
          const a = Array.isArray(l) ? (l[0]?.[0] ?? null) : l;
          const b = Array.isArray(r) ? (r[0]?.[0] ?? null) : r;
          if (isError(a)) return a;
          if (isError(b)) return b;
          let cmp: number;
          if (typeof a === 'number' && typeof b === 'number') cmp = a - b;
          else if (typeof a === 'string' && typeof b === 'string')
            cmp = a.localeCompare(b, undefined, { sensitivity: 'base' });
          else if (a === null || b === null)
            cmp =
              (a ?? (typeof b === 'string' ? '' : 0)) === (b ?? (typeof a === 'string' ? '' : 0))
                ? 0
                : String(a ?? '').localeCompare(String(b ?? ''));
          else
            cmp =
              (typeof a === 'number' ? 0 : typeof a === 'string' ? 1 : 2) -
              (typeof b === 'number' ? 0 : typeof b === 'string' ? 1 : 2);
          switch (n.op) {
            case '=':
              return cmp === 0;
            case '<>':
              return cmp !== 0;
            case '<':
              return cmp < 0;
            case '>':
              return cmp > 0;
            case '<=':
              return cmp <= 0;
            default:
              return cmp >= 0;
          }
        }
        const a = toNum(l);
        const b = toNum(r);
        if (isError(a)) return a;
        if (isError(b)) return b;
        switch (n.op) {
          case '+':
            return a + b;
          case '-':
            return a - b;
          case '*':
            return a * b;
          case '/':
            return b === 0 ? E.div0 : a / b;
          case '^':
            return a ** b;
        }
        throw new Unsupported(n.op);
      }
      case 'call': {
        const fn = FUNCS[n.fn];
        if (!fn) throw new Unsupported(n.fn);
        const lazy = n.fn === 'IF' || n.fn === 'IFERROR';
        const args = lazy ? [] : n.args.map((a) => evalNode(sheet, a));
        return fn(args, n.args, (x) => evalNode(sheet, x));
      }
    }
  };

  const compute = (sheet: Sheet, cell: Cell) => {
    const st = state.get(cell);
    if (st === 'done') return;
    if (st === 'busy') {
      cell.v = E.circ;
      return;
    }
    state.set(cell, 'busy');
    let node = parsed.get(cell.f!);
    if (!node) {
      try {
        node = parseFormula(cell.f!);
      } catch (e) {
        node = e as Error;
      }
      parsed.set(cell.f!, node);
    }
    try {
      if (node instanceof Error) throw new Unsupported(node.message);
      const raw = evalNode(sheet, node);
      let v: CellValue = Array.isArray(raw) ? ((raw[0]?.[0] ?? null) as CellValue) : raw;
      if (typeof v === 'number' && !Number.isFinite(v)) v = E.num;
      // A cycle found deeper down shows here too.
      cell.v = v === null ? 0 : v;
      delete cell.stale;
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      cell.stale = true;
      stale++;
    }
    state.set(cell, 'done');
  };

  for (const sheet of wb.sheets)
    for (const row of sheet.rows)
      for (const cell of row ?? []) if (cell?.f !== undefined) compute(sheet, cell);
  return { stale };
}

/** Whether every function in the formula is supported here (for warnings in the UI). */
export function formulaSupported(f: string): boolean {
  try {
    const walk = (n: Node): boolean =>
      n.k === 'call'
        ? !!FUNCS[n.fn] && n.args.every(walk)
        : n.k === 'bin'
          ? walk(n.l) && walk(n.r)
          : n.k === 'un'
            ? walk(n.x)
            : true;
    return walk(parseFormula(f));
  } catch {
    return false;
  }
}

/**
 * Rewrites every cell reference in a formula. `fn` gets the 0-based row and column and
 * whether each is absolute, and returns the new position or null for #REF!. Text in
 * quotes and quoted sheet names are left alone.
 */
export function mapRefs(
  f: string,
  fn: (r: number, c: number, absR: boolean, absC: boolean) => { r: number; c: number } | null,
): string {
  let out = '';
  let i = 0;
  const re = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\w(!])/;
  while (i < f.length) {
    const ch = f[i]!;
    if (ch === '"') {
      const end = f.indexOf('"', i + 1);
      const j = end === -1 ? f.length : end + 1;
      out += f.slice(i, j);
      i = j;
      continue;
    }
    if (ch === "'") {
      const end = f.indexOf("'!", i + 1);
      const j = end === -1 ? f.length : end + 2;
      out += f.slice(i, j);
      i = j;
      continue;
    }
    const prev = out[out.length - 1] ?? '';
    const m = /[A-Za-z_$]/.test(ch) && !/[\w.]/.test(prev) ? re.exec(f.slice(i)) : null;
    if (m) {
      const [, ac, col, ar, row] = m;
      const next = fn(Number(row) - 1, colIndex(col!), !!ar, !!ac);
      out +=
        !next || next.c < 0 || next.r < 0 ? '#REF!' : `${ac}${colName(next.c)}${ar}${next.r + 1}`;
      i += m[0].length;
      continue;
    }
    // Function or sheet names: copy the whole word so "LOG10" isn't read as a reference.
    const word = /^[A-Za-z_][\w.]*/.exec(f.slice(i));
    if (word && !re.test(f.slice(i))) {
      out += word[0];
      i += word[0].length;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Moves relative references by (dr, dc): used for shared formulas in XLSX and when
 * filling. Absolute parts ($A$1) stay; references pushed off the sheet become #REF!.
 */
export function shiftFormula(f: string, dr: number, dc: number): string {
  if (!dr && !dc) return f;
  return mapRefs(f, (r, c, absR, absC) => ({ r: absR ? r : r + dr, c: absC ? c : c + dc }));
}

/**
 * Keeps references pointing at the same cells after rows or columns are inserted
 * (delta > 0) or deleted (delta < 0) at `at`. References to deleted cells become #REF!.
 */
export function moveRefs(f: string, axis: 'row' | 'col', at: number, delta: number): string {
  return mapRefs(f, (r, c) => {
    const v = axis === 'row' ? r : c;
    if (v < at) return { r, c };
    if (delta < 0 && v < at - delta) return null;
    return axis === 'row' ? { r: r + delta, c } : { r, c: c + delta };
  });
}
