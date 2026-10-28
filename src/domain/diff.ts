export type DiffLine = { type: 'same' | 'add' | 'del'; text: string };

/**
 * Line diff via LCS. Bounded to keep the UI responsive: very large inputs fall
 * back to a coarse "replaced" diff instead of freezing the tab.
 */
export function diffLines(a: string, b: string, maxCells = 4_000_000): DiffLine[] {
  const A = a.split('\n');
  const B = b.split('\n');
  // Trim common prefix/suffix first; most edits are local.
  let start = 0;
  while (start < A.length && start < B.length && A[start] === B[start]) start++;
  let endA = A.length;
  let endB = B.length;
  while (endA > start && endB > start && A[endA - 1] === B[endB - 1]) {
    endA--;
    endB--;
  }
  const head: DiffLine[] = A.slice(0, start).map((text) => ({ type: 'same', text }));
  const tail: DiffLine[] = A.slice(endA).map((text) => ({ type: 'same', text }));
  const a2 = A.slice(start, endA);
  const b2 = B.slice(start, endB);
  if (a2.length * b2.length > maxCells) {
    return [
      ...head,
      ...a2.map((text) => ({ type: 'del' as const, text })),
      ...b2.map((text) => ({ type: 'add' as const, text })),
      ...tail,
    ];
  }
  const n = a2.length;
  const m = b2.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        a2[i] === b2[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const mid: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a2[i] === b2[j]) {
      mid.push({ type: 'same', text: a2[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      mid.push({ type: 'del', text: a2[i++]! });
    } else {
      mid.push({ type: 'add', text: b2[j++]! });
    }
  }
  while (i < n) mid.push({ type: 'del', text: a2[i++]! });
  while (j < m) mid.push({ type: 'add', text: b2[j++]! });
  return [...head, ...mid, ...tail];
}

export interface ChangeSummary {
  added: number;
  removed: number;
  /** One line describing the change, like a commit message. */
  message: string;
}

const clip = (s: string, n = 48) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const plain = (s: string) =>
  s
    .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ x]\]\s+)?|\d+[.)]\s+|>\s*)/i, '')
    .replace(/[*_`~]|\[\[|\]\]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim();

/** Line counts and a commit-style message for the change from `before` to `after`. */
export function summarizeChange(before: string, after: string): ChangeSummary {
  if (!before.trim()) return { added: after.split('\n').length, removed: 0, message: 'Created' };
  const diff = diffLines(before, after);
  let added = 0;
  let removed = 0;
  let heading = '';
  let section = '';
  let first: DiffLine | undefined;
  for (const d of diff) {
    const h = /^#{1,6}\s+(.+)/.exec(d.text);
    if (d.type === 'same') {
      if (h) heading = h[1]!;
      continue;
    }
    if (d.type === 'add') added++;
    else removed++;
    // The message names the first changed line with text in it.
    if (!first || (!first.text.trim() && d.text.trim())) {
      first = d;
      section = h ? '' : heading;
    }
  }
  if (!first) return { added, removed, message: 'No text changes' };
  const verb = removed && added ? 'Edited' : added ? 'Added' : 'Removed';
  const line = plain(first.text);
  const message = section
    ? `${verb} in “${clip(plain(section))}”`
    : line
      ? `${verb} “${clip(line)}”`
      : `${verb} blank lines`;
  return { added, removed, message };
}

export type Row = DiffLine | { type: 'gap'; count: number };

/** Long unchanged runs fold into one gap row, keeping `context` lines around each change. */
export function hunks(diff: DiffLine[], context = 3): Row[] {
  const keep = diff.map(() => false);
  diff.forEach((d, i) => {
    if (d.type === 'same') return;
    for (let j = Math.max(0, i - context); j <= Math.min(diff.length - 1, i + context); j++)
      keep[j] = true;
  });
  const rows: Row[] = [];
  diff.forEach((d, i) => {
    if (keep[i]) rows.push(d);
    else if (rows.at(-1)?.type === 'gap') (rows.at(-1) as { count: number }).count++;
    else rows.push({ type: 'gap', count: 1 });
  });
  return rows;
}

export type SplitRow = { type: 'gap'; count: number } | { left?: DiffLine; right?: DiffLine };

/** Side-by-side layout: removed lines on the left, added on the right, a run of each paired up. */
export function pairRows(rows: Row[]): SplitRow[] {
  const out: SplitRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.type === 'gap') out.push(r);
    else if (r.type === 'same') out.push({ left: r, right: r });
    else {
      const del: DiffLine[] = [];
      const add: DiffLine[] = [];
      for (; i < rows.length; i++) {
        const c = rows[i]!;
        if (c.type === 'del') del.push(c);
        else if (c.type === 'add') add.push(c);
        else break;
      }
      i--;
      for (let k = 0; k < Math.max(del.length, add.length); k++)
        out.push({ left: del[k], right: add[k] });
    }
  }
  return out;
}
