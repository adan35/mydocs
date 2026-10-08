import { EditorSelection, type ChangeSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { emptyTable, findTable, parseTable, serializeTable } from '@/domain/table';
import { dialogs } from '@/app/dialog-store';

/** Wraps each selection with `marker` (or unwraps if already wrapped). */
export function toggleWrap(view: EditorView, marker: string, placeholder = 'text'): boolean {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const before = state.sliceDoc(range.from - marker.length, range.from);
    const after = state.sliceDoc(range.to, range.to + marker.length);
    if (before === marker && after === marker) {
      return {
        changes: [
          { from: range.from - marker.length, to: range.from },
          { from: range.to, to: range.to + marker.length },
        ],
        range: EditorSelection.range(range.from - marker.length, range.to - marker.length),
      };
    }
    const text = state.sliceDoc(range.from, range.to);
    if (text.startsWith(marker) && text.endsWith(marker) && text.length >= marker.length * 2) {
      const inner = text.slice(marker.length, text.length - marker.length);
      return {
        changes: { from: range.from, to: range.to, insert: inner },
        range: EditorSelection.range(range.from, range.from + inner.length),
      };
    }
    const content = text || placeholder;
    return {
      changes: { from: range.from, to: range.to, insert: `${marker}${content}${marker}` },
      range: EditorSelection.range(
        range.from + marker.length,
        range.from + marker.length + content.length,
      ),
    };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.format' }));
  view.focus();
  return true;
}

export function insertLink(view: EditorView, url = 'https://'): boolean {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to) || 'link';
    const insert = `[${text}](${url})`;
    const urlStart = range.from + text.length + 3;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(urlStart, urlStart + url.length),
    };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.format' }));
  view.focus();
  return true;
}

/** Sets or toggles a line prefix (headings, lists, quotes, tasks) on every selected line. */
export function toggleLinePrefix(view: EditorView, prefix: string): boolean {
  const { state } = view;
  const changes: ChangeSpec[] = [];
  const seen = new Set<number>();
  const strip = /^(\s*)(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?)?/;
  for (const range of state.selection.ranges) {
    for (let pos = range.from; pos <= range.to;) {
      const line = state.doc.lineAt(pos);
      if (!seen.has(line.number)) {
        seen.add(line.number);
        const m = strip.exec(line.text)!;
        const indent = m[1] ?? '';
        const existing = m[2] ?? '';
        const replacement = existing.trim() === prefix.trim() ? '' : prefix;
        changes.push({
          from: line.from + indent.length,
          to: line.from + indent.length + existing.length,
          insert: replacement,
        });
      }
      pos = line.to + 1;
    }
  }
  const changeSet = state.changes(changes);
  view.dispatch({
    changes: changeSet,
    // Map forward so a cursor sitting where the prefix goes ends up after it.
    selection: state.selection.map(changeSet, 1),
    userEvent: 'input.format',
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

export function insertText(view: EditorView, text: string): void {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    userEvent: 'input',
    scrollIntoView: true,
  });
  view.focus();
}

/** Inserts a fenced code block (or wraps the selection in one). */
export function insertCodeBlock(view: EditorView): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  const text = state.sliceDoc(from, to);
  const line = state.doc.lineAt(from);
  const lead = from === line.from ? '' : '\n';
  const insert = `${lead}\`\`\`\n${text}\n\`\`\`\n`;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + lead.length + 3 },
    userEvent: 'input.format',
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

/**
 * Opens the visual table editor: on the table under the cursor, or for a new table
 * inserted at the cursor. The result is written back as valid Markdown.
 */
export function insertTable(view: EditorView): boolean {
  void editTable(view);
  return true;
}

async function editTable(view: EditorView) {
  const { state } = view;
  const lines = state.doc.toString().split('\n');
  const cursorLine = state.doc.lineAt(state.selection.main.head).number - 1;
  const found = findTable(lines, cursorLine);
  const existing = found ? parseTable(lines.slice(found.start, found.end + 1)) : null;
  const result = await dialogs.table(existing ?? emptyTable(), !existing);
  if (!result || !view.dom.isConnected) return;
  const md = serializeTable(result);
  if (found && existing) {
    const from = view.state.doc.line(found.start + 1).from;
    const to = view.state.doc.line(found.end + 1).to;
    // Only replace if the table wasn't changed in the meantime.
    if (view.state.sliceDoc(from, to) !== lines.slice(found.start, found.end + 1).join('\n'))
      return;
    view.dispatch({
      changes: { from, to, insert: md },
      selection: { anchor: from },
      userEvent: 'input.format',
      scrollIntoView: true,
    });
    view.focus();
    return;
  }
  const line = view.state.doc.lineAt(view.state.selection.main.from);
  const lead = line.text.trim() ? '\n\n' : '';
  insertText(view, `${lead}${md}\n`);
}

/** Inserts a display-math block with the cursor inside it. */
export function insertMathBlock(view: EditorView): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  const text = state.sliceDoc(from, to);
  const line = state.doc.lineAt(from);
  const lead = from === line.from ? '' : '\n';
  const insert = `${lead}$$\n${text}\n$$\n`;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + lead.length + 3, head: from + lead.length + 3 + text.length },
    userEvent: 'input.format',
    scrollIntoView: true,
  });
  view.focus();
  return true;
}
