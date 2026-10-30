/**
 * Cell colors for a sheet: a fill (`bg`) and a text color (`fg`), kept apart from the
 * cell values so every format can carry them (XLSX styles, or document metadata for
 * CSV, UNL and Markdown tables).
 *
 * Colors live in three layers, like a spreadsheet's: a single cell, a whole row and a
 * whole column. A cell shows its own color, else its row's, else its column's. Painting
 * is "last one wins": painting a row clears that row's cell colors, painting a column
 * keeps the colors of rows painted before it only where the column is painted later.
 * A color of `''` means "no color" on purpose, so clearing a row also clears the cells
 * where a painted column crosses it.
 */

export interface CellStyle {
  /** `#rrggbb`, or `''` for deliberately none. */
  bg?: string;
  fg?: string;
}

export interface SheetFormat {
  /** Keyed `"row,col"`, zero-based. */
  cells?: Record<string, CellStyle>;
  /** Keyed by zero-based row. */
  rows?: Record<string, CellStyle>;
  /** Keyed by zero-based column. */
  cols?: Record<string, CellStyle>;
}

export type StyleProp = 'bg' | 'fg';

export type Target =
  | { kind: 'cells'; r1: number; c1: number; r2: number; c2: number }
  | { kind: 'rows'; r1: number; r2: number }
  | { kind: 'cols'; c1: number; c2: number };

/** Most cells one paint may touch. Whole rows and columns are layers and cost nothing. */
export const MAX_PAINTED_CELLS = 200_000;

/** `#rgb` / `#rrggbb` in any case, as lower-case `#rrggbb`; null for anything else. */
export function normalizeColor(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  const h = m[1]!.toLowerCase();
  return `#${h.length === 3 ? [...h].map((x) => x + x).join('') : h}`;
}

/** Text color that stays readable on a fill: near-black on light fills, white on dark ones. */
export function contrastText(bg: string): string {
  const n = normalizeColor(bg);
  if (!n) return '#1f1f1f';
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(n.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum > 0.4 ? '#1f1f1f' : '#ffffff';
}

const key = (r: number, c: number) => `${r},${c}`;
const parseKey = (k: string): [number, number] => {
  const i = k.indexOf(',');
  return [Number(k.slice(0, i)), Number(k.slice(i + 1))];
};

/** The colors a cell shows: its own, else its row's, else its column's. Empty strings mean none. */
export function resolveStyle(fmt: SheetFormat | undefined, r: number, c: number): CellStyle {
  if (!fmt) return {};
  const cell = fmt.cells?.[key(r, c)];
  const row = fmt.rows?.[r];
  const col = fmt.cols?.[c];
  const pick = (p: StyleProp) => cell?.[p] ?? row?.[p] ?? col?.[p] ?? '';
  const bg = pick('bg');
  const fg = pick('fg');
  return { ...(bg ? { bg } : null), ...(fg ? { fg } : null) };
}

const clone = (fmt: SheetFormat | undefined): Required<SheetFormat> => ({
  cells: { ...Object.fromEntries(Object.entries(fmt?.cells ?? {}).map(([k, v]) => [k, { ...v }])) },
  rows: { ...Object.fromEntries(Object.entries(fmt?.rows ?? {}).map(([k, v]) => [k, { ...v }])) },
  cols: { ...Object.fromEntries(Object.entries(fmt?.cols ?? {}).map(([k, v]) => [k, { ...v }])) },
});

export function isEmptyFormat(fmt: SheetFormat | undefined): boolean {
  return (
    !fmt ||
    (!Object.keys(fmt.cells ?? {}).length &&
      !Object.keys(fmt.rows ?? {}).length &&
      !Object.keys(fmt.cols ?? {}).length)
  );
}

/** How many cells a target covers when painted cell by cell. */
export function targetSize(t: Target): number {
  return t.kind === 'cells' ? (t.r2 - t.r1 + 1) * (t.c2 - t.c1 + 1) : 0;
}

/**
 * Paints (or, with `color` null, clears) one property over a target. Returns a new format,
 * or undefined when nothing is colored any more.
 */
export function applyColor(
  fmt: SheetFormat | undefined,
  target: Target,
  prop: StyleProp,
  color: string | null,
): SheetFormat | undefined {
  const value = color === null ? '' : (normalizeColor(color) ?? '');
  const out = clone(fmt);
  const set = (layer: Record<string, CellStyle>, k: string) => {
    (layer[k] ??= {})[prop] = value;
  };
  const dropCells = (test: (r: number, c: number) => boolean) => {
    for (const k of Object.keys(out.cells)) {
      const [r, c] = parseKey(k);
      if (test(r, c)) delete out.cells[k]![prop];
    }
  };
  if (target.kind === 'rows') {
    dropCells((r) => r >= target.r1 && r <= target.r2);
    for (let r = target.r1; r <= target.r2; r++) set(out.rows, String(r));
  } else if (target.kind === 'cols') {
    dropCells((_, c) => c >= target.c1 && c <= target.c2);
    // A row painted earlier would otherwise still win where it crosses this column.
    const crossing = Object.keys(out.rows).filter((r) => out.rows[r]![prop] !== undefined);
    for (let c = target.c1; c <= target.c2; c++) {
      set(out.cols, String(c));
      for (const r of crossing) set(out.cells, key(Number(r), c));
    }
  } else {
    if (targetSize(target) > MAX_PAINTED_CELLS) throw new RangeError('Too many cells to paint.');
    for (let r = target.r1; r <= target.r2; r++)
      for (let c = target.c1; c <= target.c2; c++) set(out.cells, key(r, c));
  }
  return tidy(out);
}

/** Drops entries that change nothing: empty styles, and "none" where nothing shows through. */
function tidy(f: Required<SheetFormat>): SheetFormat | undefined {
  const props: StyleProp[] = ['bg', 'fg'];
  const anyCol = (p: StyleProp) => Object.values(f.cols).some((s) => !!s[p]);
  for (const s of Object.values(f.cols)) for (const p of props) if (s[p] === '') delete s[p];
  for (const s of Object.values(f.rows))
    for (const p of props) if (s[p] === '' && !anyCol(p)) delete s[p];
  for (const [k, s] of Object.entries(f.cells)) {
    const [r, c] = parseKey(k);
    for (const p of props) {
      if (s[p] === undefined) continue;
      const below = f.rows[r]?.[p] ?? f.cols[c]?.[p] ?? '';
      if (s[p] === below) delete s[p];
    }
  }
  for (const layer of [f.cells, f.rows, f.cols])
    for (const [k, s] of Object.entries(layer))
      if (s.bg === undefined && s.fg === undefined) delete layer[k];
  const out: SheetFormat = {};
  if (Object.keys(f.cells).length) out.cells = f.cells;
  if (Object.keys(f.rows).length) out.rows = f.rows;
  if (Object.keys(f.cols).length) out.cols = f.cols;
  return isEmptyFormat(out) ? undefined : out;
}

/** Repairs a format read from a file or metadata: bad colors and keys are dropped. */
export function sanitizeFormat(raw: unknown): SheetFormat | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const f = raw as Record<string, unknown>;
  const out = clone(undefined);
  const read = (src: unknown, dst: Record<string, CellStyle>, ok: (k: string) => boolean) => {
    if (!src || typeof src !== 'object') return;
    for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
      if (!ok(k) || !v || typeof v !== 'object') continue;
      const s: CellStyle = {};
      for (const p of ['bg', 'fg'] as const) {
        const val = (v as Record<string, unknown>)[p];
        if (val === '') s[p] = '';
        else if (normalizeColor(val)) s[p] = normalizeColor(val)!;
      }
      if (s.bg !== undefined || s.fg !== undefined) dst[k] = s;
    }
  };
  read(f.cells, out.cells, (k) => /^\d+,\d+$/.test(k));
  read(f.rows, out.rows, (k) => /^\d+$/.test(k));
  read(f.cols, out.cols, (k) => /^\d+$/.test(k));
  return tidy(out);
}

// ------------------------------------------------------------------ structural edits

/** Moves every colored row (or column) index through `to`; null drops it. */
function remap(
  fmt: SheetFormat | undefined,
  axis: 'row' | 'col',
  to: (i: number) => number | null,
): SheetFormat | undefined {
  if (!fmt) return undefined;
  const out: SheetFormat = {};
  const layer = axis === 'row' ? 'rows' : 'cols';
  if (fmt[layer]) {
    const next: Record<string, CellStyle> = {};
    for (const [k, v] of Object.entries(fmt[layer]!)) {
      const i = to(Number(k));
      if (i !== null) next[String(i)] = v;
    }
    out[layer] = next;
  }
  const other = axis === 'row' ? 'cols' : 'rows';
  if (fmt[other]) out[other] = fmt[other];
  if (fmt.cells) {
    const next: Record<string, CellStyle> = {};
    for (const [k, v] of Object.entries(fmt.cells)) {
      const [r, c] = parseKey(k);
      const i = to(axis === 'row' ? r : c);
      if (i !== null) next[axis === 'row' ? key(i, c) : key(r, i)] = v;
    }
    out.cells = next;
  }
  return isEmptyFormat(out) ? undefined : out;
}

export const insertRowsFormat = (f: SheetFormat | undefined, at: number, count: number) =>
  remap(f, 'row', (i) => (i >= at ? i + count : i));
export const deleteRowsFormat = (f: SheetFormat | undefined, at: number, count: number) =>
  remap(f, 'row', (i) => (i < at ? i : i >= at + count ? i - count : null));
export const insertColsFormat = (f: SheetFormat | undefined, at: number, count: number) =>
  remap(f, 'col', (i) => (i >= at ? i + count : i));
export const deleteColsFormat = (f: SheetFormat | undefined, at: number, count: number) =>
  remap(f, 'col', (i) => (i < at ? i : i >= at + count ? i - count : null));

/** Rows were reordered (a sort): `order[newIndex]` is the row's old index. Colors follow their rows. */
export function permuteRowsFormat(
  f: SheetFormat | undefined,
  order: readonly number[],
): SheetFormat | undefined {
  const moved = new Map<number, number>();
  order.forEach((old, now) => moved.set(old, now));
  return remap(f, 'row', (i) => moved.get(i) ?? i);
}

// ------------------------------------------------------------------ targets

/** What a selection paints: the cells themselves, or the whole rows or columns they span. */
export function targetFor(
  range: [number, number, number, number],
  scope: 'cells' | 'rows' | 'cols',
): Target {
  const [r1, c1, r2, c2] = range;
  if (scope === 'rows') return { kind: 'rows', r1, r2 };
  if (scope === 'cols') return { kind: 'cols', c1, c2 };
  return { kind: 'cells', r1, c1, r2, c2 };
}

// ------------------------------------------------------------------ palette

export const GRAYS = [
  '#000000',
  '#434343',
  '#666666',
  '#999999',
  '#b7b7b7',
  '#cccccc',
  '#d9d9d9',
  '#efefef',
  '#f3f3f3',
  '#ffffff',
];
export const HUES = [
  'red berry',
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'cornflower blue',
  'blue',
  'purple',
  'magenta',
];
/** Rows of the palette below the grays: each tone of the ten hues, light to dark. */
export const TONES: { name: string; colors: string[] }[] = [
  {
    name: 'vivid',
    colors: [
      '#980000',
      '#ff0000',
      '#ff9900',
      '#ffff00',
      '#00ff00',
      '#00ffff',
      '#4a86e8',
      '#0000ff',
      '#9900ff',
      '#ff00ff',
    ],
  },
  {
    name: 'light 3',
    colors: [
      '#e6b8af',
      '#f4cccc',
      '#fce5cd',
      '#fff2cc',
      '#d9ead3',
      '#d0e0e3',
      '#c9daf8',
      '#cfe2f3',
      '#d9d2e9',
      '#ead1dc',
    ],
  },
  {
    name: 'light 2',
    colors: [
      '#dd7e6b',
      '#ea9999',
      '#f9cb9c',
      '#ffe599',
      '#b6d7a8',
      '#a2c4c9',
      '#a4c2f4',
      '#9fc5e8',
      '#b4a7d6',
      '#d5a6bd',
    ],
  },
  {
    name: 'light 1',
    colors: [
      '#cc4125',
      '#e06666',
      '#f6b26b',
      '#ffd966',
      '#93c47d',
      '#76a5af',
      '#6d9eeb',
      '#6fa8dc',
      '#8e7cc3',
      '#c27ba0',
    ],
  },
  {
    name: 'dark 1',
    colors: [
      '#a61c00',
      '#cc0000',
      '#e69138',
      '#f1c232',
      '#6aa84f',
      '#45818e',
      '#3c78d8',
      '#3d85c6',
      '#674ea7',
      '#a64d79',
    ],
  },
  {
    name: 'dark 2',
    colors: [
      '#85200c',
      '#990000',
      '#b45f06',
      '#bf9000',
      '#38761d',
      '#134f5c',
      '#1155cc',
      '#0b5394',
      '#351c75',
      '#741b47',
    ],
  },
  {
    name: 'dark 3',
    colors: [
      '#5b0f00',
      '#660000',
      '#783f04',
      '#7f6000',
      '#274e13',
      '#0c343d',
      '#1c4587',
      '#073763',
      '#20124d',
      '#4c1130',
    ],
  },
];

/** Readable name of a palette color, for screen readers and tooltips. */
export function colorName(hex: string): string {
  const g = GRAYS.indexOf(hex);
  if (g >= 0)
    return [
      'black',
      'dark gray 4',
      'dark gray 3',
      'dark gray 2',
      'dark gray 1',
      'gray',
      'light gray 1',
      'light gray 2',
      'light gray 3',
      'white',
    ][g]!;
  for (const t of TONES) {
    const i = t.colors.indexOf(hex);
    if (i >= 0) return t.name === 'vivid' ? HUES[i]! : `${t.name} ${HUES[i]}`;
  }
  return hex;
}
