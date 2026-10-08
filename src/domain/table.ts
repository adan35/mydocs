/** GFM pipe tables: parsing, editing and serializing back to valid Markdown. */

export type Align = 'left' | 'center' | 'right' | null;

export interface Table {
  header: string[];
  align: Align[];
  rows: string[][];
}

const DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** Splits a table row on unescaped pipes outside inline code. */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '\\|';
      i++;
    } else if (ch === '`') {
      inCode = !inCode;
      cur += ch;
    } else if (ch === '|' && !inCode) {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

const isRow = (line: string | undefined) => !!line && line.includes('|') && line.trim() !== '';

/**
 * Finds the table containing the 0-based `line`, returning its first and last line.
 * A table is a header row, a delimiter row, then body rows.
 */
export function findTable(lines: string[], line: number): { start: number; end: number } | null {
  if (!isRow(lines[line])) return null;
  let start = line;
  while (start > 0 && isRow(lines[start - 1])) start--;
  let end = line;
  while (end < lines.length - 1 && isRow(lines[end + 1])) end++;
  // The header is the row right before the first delimiter row in the block.
  for (let i = start; i < end; i++) {
    if (DELIMITER.test(lines[i + 1]!) && !DELIMITER.test(lines[i]!)) {
      if (line < i) return null;
      return { start: i, end };
    }
  }
  return null;
}

export function parseTable(lines: string[]): Table | null {
  if (lines.length < 2 || !DELIMITER.test(lines[1]!)) return null;
  const header = splitRow(lines[0]!);
  const align = splitRow(lines[1]!).map<Align>((c) => {
    const l = c.startsWith(':');
    const r = c.endsWith(':');
    return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
  });
  const width = header.length;
  const fit = (cells: string[]) =>
    Array.from({ length: width }, (_, i) => cells[i] ?? '').slice(0, width);
  return {
    header,
    align: fit(align as string[]) as Align[],
    rows: lines.slice(2).map((l) => fit(splitRow(l))),
  };
}

/** Cells can't contain line breaks or bare pipes. */
export function cleanCell(text: string): string {
  return text
    .replace(/\r?\n/g, ' ')
    .replace(/(?<!\\)\|/g, '\\|')
    .trim();
}

const displayWidth = (s: string) => [...s].length;

/** Serializes with padded columns so the source stays readable. */
export function serializeTable(t: Table): string {
  const width = t.header.length;
  const all = [t.header, ...t.rows].map((r) =>
    Array.from({ length: width }, (_, i) => cleanCell(r[i] ?? '')),
  );
  const colWidth = Array.from({ length: width }, (_, i) =>
    Math.max(3, ...all.map((r) => displayWidth(r[i]!))),
  );
  const pad = (s: string, i: number) => {
    const extra = colWidth[i]! - displayWidth(s);
    const a = t.align[i];
    if (a === 'right') return ' '.repeat(extra) + s;
    if (a === 'center')
      return ' '.repeat(Math.floor(extra / 2)) + s + ' '.repeat(Math.ceil(extra / 2));
    return s + ' '.repeat(extra);
  };
  const line = (cells: string[]) => `| ${cells.map(pad).join(' | ')} |`;
  const delim = colWidth.map((w, i) => {
    const a = t.align[i];
    const dashes = '-'.repeat(Math.max(3, w - (a === 'center' ? 2 : a ? 1 : 0)));
    if (a === 'center') return `:${dashes}:`;
    if (a === 'right') return `${dashes}:`;
    if (a === 'left') return `:${dashes}`;
    return dashes;
  });
  return [line(all[0]!), `| ${delim.join(' | ')} |`, ...all.slice(1).map(line)].join('\n');
}

export function emptyTable(cols = 3, rows = 2): Table {
  return {
    header: Array.from({ length: cols }, (_, i) => `Column ${i + 1}`),
    align: Array.from({ length: cols }, () => null),
    rows: Array.from({ length: rows }, () => Array.from({ length: cols }, () => '')),
  };
}

const move = <T>(arr: T[], from: number, to: number): T[] => {
  const next = [...arr];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x!);
  return next;
};

/** Immutable table edits used by the visual editor. */
export const tableOps = {
  insertRow(t: Table, at: number): Table {
    const rows = [...t.rows];
    rows.splice(
      at,
      0,
      t.header.map(() => ''),
    );
    return { ...t, rows };
  },
  deleteRow(t: Table, at: number): Table {
    return { ...t, rows: t.rows.filter((_, i) => i !== at) };
  },
  moveRow(t: Table, from: number, to: number): Table {
    if (to < 0 || to >= t.rows.length) return t;
    return { ...t, rows: move(t.rows, from, to) };
  },
  insertColumn(t: Table, at: number): Table {
    const ins = <T>(arr: T[], v: T) => [...arr.slice(0, at), v, ...arr.slice(at)];
    return {
      header: ins(t.header, `Column ${t.header.length + 1}`),
      align: ins(t.align, null),
      rows: t.rows.map((r) => ins(r, '')),
    };
  },
  deleteColumn(t: Table, at: number): Table {
    if (t.header.length <= 1) return t;
    const del = <T>(arr: T[]) => arr.filter((_, i) => i !== at);
    return { header: del(t.header), align: del(t.align), rows: t.rows.map(del) };
  },
  moveColumn(t: Table, from: number, to: number): Table {
    if (to < 0 || to >= t.header.length) return t;
    return {
      header: move(t.header, from, to),
      align: move(t.align, from, to),
      rows: t.rows.map((r) => move(r, from, to)),
    };
  },
  setAlign(t: Table, col: number, align: Align): Table {
    return { ...t, align: t.align.map((a, i) => (i === col ? align : a)) };
  },
  setCell(t: Table, row: number, col: number, value: string): Table {
    if (row < 0) return { ...t, header: t.header.map((h, i) => (i === col ? value : h)) };
    return {
      ...t,
      rows: t.rows.map((r, ri) => (ri === row ? r.map((c, ci) => (ci === col ? value : c)) : r)),
    };
  },
};
