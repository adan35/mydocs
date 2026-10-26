import type { ReactNode } from 'react';
import { emptyTable, serializeTable } from '@/domain/table';
import { toastError } from '@/app/toast-store';
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { openSearchPanel, gotoLine } from '@codemirror/search';
import { deleteLine, indentLess, indentMore, moveLineDown, moveLineUp } from '@codemirror/commands';
import {
  ArrowDown,
  ArrowUp,
  Bold,
  CaseSensitive,
  Code,
  CodeXml,
  ImagePlus,
  Indent,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Outdent,
  Quote,
  Redo2,
  Replace,
  Search,
  Sigma,
  SortAsc,
  Strikethrough,
  Table,
  Trash2,
  Undo2,
  WrapText,
  Eraser,
  ListOrdered as GoTo,
  Sheet,
} from 'lucide-react';
import type { EntryId } from '@/domain/types';
import { blockTypeOf, setBlockType, afterBlock, type BlockType } from '@/domain/source-edit';
import { docModel } from '@/app/doc-model';
import { editorActions } from '@/app/editor-store';
import { useSettings } from '@/app/settings-store';
import { dialogs } from '@/app/dialog-store';
import { SHORTCUTS } from '@/app/shortcuts';
import type { RichApi, RichFocus } from '../document/rich-editing';
import {
  insertCodeBlock,
  insertLink,
  insertMathBlock,
  insertTable,
  insertText,
  toggleWrap,
} from './commands';

/**
 * One registry of editing commands. The ribbon, the command palette and the help
 * dialog all read it, so a command has one name, one shortcut and one behaviour in
 * every place it appears. Each tool says which formats and modes it applies to; a
 * tool is only offered where its result is valid for the document's format.
 */

export type EditKind = 'markdown' | 'text';
export type EditSurface = 'source' | 'rich';

export interface ToolContext {
  docId: EntryId;
  kind: EditKind;
  surface: EditSurface;
  /** The source editor, when it is on screen. */
  view: EditorView | null;
  rich: RichApi | null;
  richFocus: RichFocus | null;
  /** The document has tables (offers the sheet view). */
  hasTables?: boolean;
  openSheet?(): void;
}

export interface Tool {
  id: string;
  label: string;
  /** One line saying what the button does, shown in its tooltip beside the name. */
  hint?: string | ((ctx: ToolContext) => string);
  icon: ReactNode;
  group: 'history' | 'inline' | 'block' | 'insert' | 'arrange' | 'text' | 'table';
  shortcut?: string;
  when(ctx: ToolContext): boolean;
  run(ctx: ToolContext): void;
  pressed?(ctx: ToolContext): boolean;
  disabled?(ctx: ToolContext): boolean;
}

const md = (ctx: ToolContext) => ctx.kind === 'markdown';
const mdSource = (ctx: ToolContext) => md(ctx) && ctx.surface === 'source' && !!ctx.view;
const mdRich = (ctx: ToolContext) => md(ctx) && ctx.surface === 'rich' && !!ctx.rich;
const anyMd = (ctx: ToolContext) => mdSource(ctx) || mdRich(ctx);
const textSource = (ctx: ToolContext) => ctx.surface === 'source' && !!ctx.view;

/** Syntax nodes around the selection head (for pressed states). */
function nodesAt(view: EditorView): Set<string> {
  const out = new Set<string>();
  const pos = view.state.selection.main.head;
  for (
    let n: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(view.state).resolveInner(
      pos,
      -1,
    );
    n;
    n = n.parent
  )
    out.add(n.name);
  return out;
}

/** The caret is inside inline code in rich editing. */
function inRichCode(): boolean {
  const n = getSelection()?.anchorNode;
  return !!(n instanceof Element ? n : n?.parentElement)?.closest('.prose code');
}

/** The block type at the cursor in source mode. */
export function sourceBlockType(view: EditorView): BlockType {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  return blockTypeOf(line.text);
}

/** Sets the block type of every selected line in source mode. */
export function setSourceBlockType(view: EditorView, type: BlockType) {
  const { state } = view;
  const doc = state.doc.toString();
  const from = state.doc.lineAt(state.selection.main.from).number - 1;
  const to = state.doc.lineAt(state.selection.main.to).number;
  const changes = [];
  // Each line separately, so a multi-line selection becomes several items or headings.
  for (let l = from; l < to; l++) {
    const c = setBlockType(doc, l, l + 1, type);
    if (c && doc.slice(c.from, c.to) !== c.insert) changes.push(c);
  }
  if (!changes.length) return;
  const set = state.changes(changes);
  view.dispatch({
    changes: set,
    selection: state.selection.map(set, 1),
    userEvent: 'input.format',
    scrollIntoView: true,
  });
  view.focus();
}

function richOrSource(ctx: ToolContext, type: BlockType) {
  if (ctx.surface === 'rich') ctx.rich?.setType(type);
  else if (ctx.view) {
    // Toggle: applying the current type again turns the line back into a paragraph.
    const current = sourceBlockType(ctx.view);
    setSourceBlockType(ctx.view, current === type && type !== 'paragraph' ? 'paragraph' : type);
  }
}

function currentType(ctx: ToolContext): BlockType | null {
  if (ctx.surface === 'rich') return ctx.richFocus?.type ?? null;
  return ctx.view ? sourceBlockType(ctx.view) : null;
}

/** Inserts Markdown after the focused block in rich mode (or at the end). */
function insertAfterFocused(ctx: ToolContext, text: string) {
  const doc = editorActions.textOf(ctx.docId) ?? '';
  const f = ctx.richFocus;
  const at = f ? afterBlock(doc, f.end) : doc.length;
  const lead =
    at === 0
      ? ''
      : doc.slice(0, at).endsWith('\n\n')
        ? ''
        : doc.slice(0, at).endsWith('\n')
          ? '\n'
          : '\n\n';
  editorActions.edit(ctx.docId, {
    changes: { from: at, insert: `${lead}${text}\n` },
    userEvent: 'input.rich',
  });
}

async function pickImageInto(ctx: ToolContext) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const { saveAttachment } = await import('@/app/attachments');
    try {
      const md = await saveAttachment(ctx.docId, file);
      if (ctx.surface === 'source' && ctx.view) insertText(ctx.view, md);
      else insertAfterFocused(ctx, md);
    } catch (err) {
      toastError(`Unable to attach "${file.name}".`, err);
    }
  };
  input.click();
}

function sortLines(view: EditorView) {
  const { state } = view;
  const sel = state.selection.main;
  const from = sel.empty ? 0 : state.doc.lineAt(sel.from).from;
  const to = sel.empty ? state.doc.length : state.doc.lineAt(sel.to).to;
  const text = state.sliceDoc(from, to);
  const sorted = text
    .split('\n')
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .join('\n');
  if (sorted !== text)
    view.dispatch({ changes: { from, to, insert: sorted }, userEvent: 'input.sort' });
  view.focus();
}

function trimTrailing(view: EditorView) {
  const changes = [];
  for (let i = 1; i <= view.state.doc.lines; i++) {
    const line = view.state.doc.line(i);
    const m = /[ \t]+$/.exec(line.text);
    if (m) changes.push({ from: line.to - m[0].length, to: line.to });
  }
  if (changes.length) view.dispatch({ changes, userEvent: 'delete.trim' });
  view.focus();
}

function changeCase(view: EditorView) {
  const { state } = view;
  view.dispatch(
    state.changeByRange((r) => {
      const text = state.sliceDoc(r.from, r.to);
      const next = text === text.toUpperCase() ? text.toLowerCase() : text.toUpperCase();
      return {
        changes: { from: r.from, to: r.to, insert: next },
        range: EditorSelection.range(r.from, r.to),
      };
    }),
    { userEvent: 'input.case' },
  );
  view.focus();
}

export const TOOLS: Tool[] = [
  {
    id: 'undo',
    label: 'Undo',
    icon: <Undo2 />,
    group: 'history',
    shortcut: 'Mod+Z',
    when: () => true,
    disabled: (c) => !docModel.canUndo(c.docId),
    run: (c) => {
      docModel.undo(c.docId);
      c.view?.focus();
    },
  },
  {
    id: 'redo',
    label: 'Redo',
    icon: <Redo2 />,
    group: 'history',
    shortcut: 'Mod+Shift+Z',
    when: () => true,
    disabled: (c) => !docModel.canRedo(c.docId),
    run: (c) => {
      docModel.redo(c.docId);
      c.view?.focus();
    },
  },
  {
    id: 'bold',
    label: 'Bold',
    icon: <Bold />,
    group: 'inline',
    shortcut: SHORTCUTS.bold,
    when: anyMd,
    pressed: (c) =>
      c.surface === 'rich'
        ? document.queryCommandState('bold')
        : !!c.view && nodesAt(c.view).has('StrongEmphasis'),
    run: (c) => (c.surface === 'rich' ? c.rich!.format('bold') : toggleWrap(c.view!, '**')),
  },
  {
    id: 'italic',
    label: 'Italic',
    icon: <Italic />,
    group: 'inline',
    shortcut: SHORTCUTS.italic,
    when: anyMd,
    pressed: (c) =>
      c.surface === 'rich'
        ? document.queryCommandState('italic')
        : !!c.view && nodesAt(c.view).has('Emphasis'),
    run: (c) => (c.surface === 'rich' ? c.rich!.format('italic') : toggleWrap(c.view!, '*')),
  },
  {
    id: 'strike',
    label: 'Strikethrough',
    icon: <Strikethrough />,
    group: 'inline',
    shortcut: 'Mod+Shift+X',
    when: anyMd,
    pressed: (c) =>
      c.surface === 'rich'
        ? document.queryCommandState('strikeThrough')
        : !!c.view && nodesAt(c.view).has('Strikethrough'),
    run: (c) => (c.surface === 'rich' ? c.rich!.format('strike') : toggleWrap(c.view!, '~~')),
  },
  {
    id: 'inline-code',
    label: 'Inline code',
    hint: 'Show the selected text as code, in a line of text. Use again to undo',
    icon: <CodeXml />,
    group: 'inline',
    shortcut: 'Mod+`',
    when: anyMd,
    pressed: (c) =>
      c.surface === 'rich' ? inRichCode() : !!c.view && nodesAt(c.view).has('InlineCode'),
    run: (c) => (c.surface === 'rich' ? c.rich!.format('code') : toggleWrap(c.view!, '`', 'code')),
  },
  {
    id: 'link',
    label: 'Link',
    hint: 'Link the selected text to a web address or document',
    icon: <Link />,
    group: 'inline',
    shortcut: SHORTCUTS.link,
    when: anyMd,
    pressed: (c) => c.surface === 'source' && !!c.view && nodesAt(c.view).has('Link'),
    run: (c) => (c.surface === 'rich' ? c.rich!.format('link') : insertLink(c.view!)),
  },
  {
    id: 'bullet',
    label: 'Bulleted list',
    icon: <List />,
    group: 'block',
    shortcut: 'Mod+Shift+8',
    when: anyMd,
    pressed: (c) => currentType(c) === 'bullet',
    disabled: (c) => c.surface === 'rich' && (!c.richFocus || c.richFocus.kind === 'cell'),
    run: (c) => richOrSource(c, 'bullet'),
  },
  {
    id: 'number',
    label: 'Numbered list',
    icon: <ListOrdered />,
    group: 'block',
    shortcut: 'Mod+Shift+7',
    when: anyMd,
    pressed: (c) => currentType(c) === 'number',
    disabled: (c) => c.surface === 'rich' && (!c.richFocus || c.richFocus.kind === 'cell'),
    run: (c) => richOrSource(c, 'number'),
  },
  {
    id: 'task',
    label: 'Checklist',
    icon: <ListTodo />,
    group: 'block',
    shortcut: 'Mod+Shift+9',
    when: anyMd,
    pressed: (c) => currentType(c) === 'task',
    disabled: (c) => c.surface === 'rich' && (!c.richFocus || c.richFocus.kind === 'cell'),
    run: (c) => richOrSource(c, 'task'),
  },
  {
    id: 'quote',
    label: 'Quote',
    icon: <Quote />,
    group: 'block',
    when: anyMd,
    pressed: (c) => currentType(c) === 'quote',
    disabled: (c) => c.surface === 'rich' && (!c.richFocus || c.richFocus.kind === 'cell'),
    run: (c) => richOrSource(c, 'quote'),
  },
  {
    id: 'outdent',
    label: 'Decrease indent',
    hint: 'Move the list item or line one level left',
    icon: <Outdent />,
    group: 'block',
    shortcut: 'Shift+Tab',
    when: mdSource,
    run: (c) => (indentLess(c.view!), c.view!.focus()),
  },
  {
    id: 'indent',
    label: 'Increase indent',
    hint: 'Move the list item or line one level right',
    icon: <Indent />,
    group: 'block',
    shortcut: 'Tab',
    when: mdSource,
    run: (c) => (indentMore(c.view!), c.view!.focus()),
  },
  {
    id: 'move-up',
    label: 'Move up',
    hint: (c) =>
      c.surface === 'rich'
        ? 'Move the current paragraph, list item or other block above the one before it'
        : 'Move the current line, or the selected lines, up',
    icon: <ArrowUp />,
    group: 'arrange',
    shortcut: 'Mod+Alt+ArrowUp',
    when: anyMd,
    disabled: (c) => c.surface === 'rich' && !c.richFocus,
    run: (c) => (c.surface === 'rich' ? c.rich!.move(-1) : (moveLineUp(c.view!), c.view!.focus())),
  },
  {
    id: 'move-down',
    label: 'Move down',
    hint: (c) =>
      c.surface === 'rich'
        ? 'Move the current paragraph, list item or other block below the one after it'
        : 'Move the current line, or the selected lines, down',
    icon: <ArrowDown />,
    group: 'arrange',
    shortcut: 'Mod+Alt+ArrowDown',
    when: anyMd,
    disabled: (c) => c.surface === 'rich' && !c.richFocus,
    run: (c) => (c.surface === 'rich' ? c.rich!.move(1) : (moveLineDown(c.view!), c.view!.focus())),
  },
  {
    id: 'delete-block',
    label: 'Delete',
    hint: (c) =>
      c.surface === 'rich'
        ? 'Delete the current paragraph, list item or other block'
        : 'Delete the current line, or the selected lines',
    icon: <Trash2 />,
    group: 'arrange',
    when: anyMd,
    disabled: (c) => c.surface === 'rich' && !c.richFocus,
    run: (c) => (c.surface === 'rich' ? c.rich!.remove() : (deleteLine(c.view!), c.view!.focus())),
  },
  {
    id: 'image',
    label: 'Image',
    icon: <ImagePlus />,
    group: 'insert',
    when: anyMd,
    run: (c) => void pickImageInto(c),
  },
  {
    id: 'table',
    label: 'Table',
    icon: <Table />,
    group: 'insert',
    when: anyMd,
    run: (c) => {
      if (c.surface === 'source') insertTable(c.view!);
      else
        void (async () => {
          const t = await dialogs.table(emptyTable(), true);
          if (t) insertAfterFocused(c, serializeTable(t));
        })();
    },
  },
  {
    id: 'code-block',
    label: 'Code block',
    hint: 'Insert a block for several lines of code',
    icon: <Code />,
    group: 'insert',
    shortcut: 'Mod+Alt+C',
    when: anyMd,
    run: (c) =>
      c.surface === 'source' ? insertCodeBlock(c.view!) : insertAfterFocused(c, '```\ncode\n```'),
  },
  {
    id: 'equation',
    label: 'Equation',
    hint: 'Insert a math formula block',
    icon: <Sigma />,
    group: 'insert',
    when: anyMd,
    run: (c) =>
      c.surface === 'source' ? insertMathBlock(c.view!) : insertAfterFocused(c, '$$\nx\n$$'),
  },
  {
    id: 'rule',
    label: 'Divider',
    icon: <Minus />,
    group: 'insert',
    when: anyMd,
    run: (c) =>
      c.surface === 'source' ? insertText(c.view!, '\n\n---\n\n') : insertAfterFocused(c, '---'),
  },
  {
    id: 'sheet',
    label: 'Edit tables as a sheet',
    hint: 'Edit all tables in this document in a spreadsheet',
    icon: <Sheet />,
    group: 'table',
    when: (c) => md(c) && !!c.hasTables && !!c.openSheet,
    run: (c) => c.openSheet!(),
  },
  // Plain text and code files.
  {
    id: 'find',
    label: 'Find',
    icon: <Search />,
    group: 'text',
    shortcut: SHORTCUTS.find,
    when: textSource,
    run: (c) => openSearchPanel(c.view!),
  },
  {
    id: 'replace',
    label: 'Replace',
    icon: <Replace />,
    group: 'text',
    when: (c) => textSource(c) && c.kind === 'text',
    run: (c) => {
      openSearchPanel(c.view!);
      requestAnimationFrame(() =>
        c.view!.dom.querySelector<HTMLInputElement>('.cm-search input[name=replace]')?.focus(),
      );
    },
  },
  {
    id: 'wrap',
    label: 'Wrap long lines',
    icon: <WrapText />,
    group: 'text',
    when: (c) => textSource(c) && c.kind === 'text',
    pressed: () => useSettings.getState().wordWrap,
    run: () => useSettings.getState().update({ wordWrap: !useSettings.getState().wordWrap }),
  },
  {
    id: 'goto-line',
    label: 'Go to line',
    icon: <GoTo />,
    group: 'text',
    shortcut: 'Mod+Alt+G',
    when: (c) => textSource(c) && c.kind === 'text',
    run: (c) => gotoLine(c.view!),
  },
  {
    id: 'sort-lines',
    label: 'Sort lines',
    icon: <SortAsc />,
    group: 'text',
    when: (c) => textSource(c) && c.kind === 'text',
    run: (c) => sortLines(c.view!),
  },
  {
    id: 'case',
    label: 'Change case',
    icon: <CaseSensitive />,
    group: 'text',
    when: (c) => textSource(c) && c.kind === 'text',
    disabled: (c) => c.view!.state.selection.main.empty,
    run: (c) => changeCase(c.view!),
  },
  {
    id: 'trim',
    label: 'Remove trailing spaces',
    icon: <Eraser />,
    group: 'text',
    when: (c) => textSource(c) && c.kind === 'text',
    run: (c) => trimTrailing(c.view!),
  },
];

export const BLOCK_STYLES: { type: BlockType; label: string; shortcut?: string }[] = [
  { type: 'paragraph', label: 'Text' },
  { type: 'h1', label: 'Heading 1', shortcut: 'Mod+Alt+1' },
  { type: 'h2', label: 'Heading 2', shortcut: 'Mod+Alt+2' },
  { type: 'h3', label: 'Heading 3', shortcut: 'Mod+Alt+3' },
  { type: 'h4', label: 'Heading 4' },
  { type: 'h5', label: 'Heading 5' },
  { type: 'h6', label: 'Heading 6' },
];

/** Applies a paragraph style (text or heading level) in the current surface. */
export function applyBlockStyle(ctx: ToolContext, type: BlockType) {
  if (ctx.surface === 'rich') ctx.rich?.setType(type);
  else if (ctx.view) setSourceBlockType(ctx.view, type);
}

export function currentBlockStyle(ctx: ToolContext): BlockType | null {
  const t = currentType(ctx);
  return t && (t === 'paragraph' || t.startsWith('h')) ? t : t ? 'paragraph' : null;
}
