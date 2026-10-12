import {
  EditorState,
  Facet,
  type Extension,
  type Transaction,
  type TransactionSpec,
} from '@codemirror/state';
import { history, redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import type { EntryId } from '@/domain/types';

/**
 * The single source of truth for the text of every open document.
 *
 * Each open text document has one CodeMirror `EditorState` here, whether or not an
 * editor is on screen. Source editing, rich editing in the preview, sheet edits of
 * Markdown tables, toolbar commands and task toggles are all transactions on that
 * state, so undo and redo cover every mode and there is never a second copy of the
 * text that could drift. A visible editor *attaches* to the state instead of owning it.
 *
 * Which document a state belongs to is stored in the state itself (`docIdFacet`), never
 * in a closure, so a state can move between editor instances without its changes
 * being attributed to another document.
 */

/** The document a state belongs to. */
export const docIdFacet = Facet.define<string, string>({ combine: (v) => v[0] ?? '' });

/** Something that shows a state and applies transactions to it (an `EditorView`). */
export interface DocView {
  readonly state: EditorState;
  dispatch(tr: Transaction): void;
  dispatch(...specs: TransactionSpec[]): void;
}

type ChangeListener = (id: EntryId, text: string) => void;

const states = new Map<EntryId, EditorState>();
const views = new Map<EntryId, DocView>();
const listeners = new Set<ChangeListener>();
let extensionsFor: (id: EntryId) => Extension = () => [];

function notify(id: EntryId, state: EditorState) {
  const text = state.doc.toString();
  for (const fn of listeners) fn(id, text);
}

function create(id: EntryId, text: string): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [docIdFacet.of(id), history(), extensionsFor(id)],
  });
}

export const docModel = {
  /** Sets the extensions every new document state gets (keymaps, completion…). Called by the UI. */
  configure(fn: (id: EntryId) => Extension) {
    extensionsFor = fn;
  },

  /** Notified with the new text after every change, from any mode. */
  onChange(fn: ChangeListener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  has(id: EntryId): boolean {
    return views.has(id) || states.has(id);
  },

  /** The current state, created from `text` the first time it's needed. */
  state(id: EntryId, text: string): EditorState {
    const view = views.get(id);
    if (view) return view.state;
    let s = states.get(id);
    if (!s) states.set(id, (s = create(id, text)));
    return s;
  },

  /** The current text, if the document is open. */
  text(id: EntryId): string | undefined {
    return (views.get(id)?.state ?? states.get(id))?.doc.toString();
  },

  /** An editor starts showing this document; it now applies its transactions. */
  attach(id: EntryId, view: DocView) {
    views.set(id, view);
    states.delete(id);
  },

  /** The editor stops showing it; its state (history, selection) is kept here. */
  detach(id: EntryId, view: DocView) {
    if (views.get(id) !== view) return;
    views.delete(id);
    states.set(id, view.state);
  },

  /** Called by an attached editor after it applied transactions. */
  viewUpdated(id: EntryId, transactions: readonly Transaction[], state: EditorState) {
    if (transactions.some((tr) => tr.docChanged)) notify(id, state);
  },

  /**
   * Applies a change to a document, through its editor when one is attached.
   * Returns false when the document isn't open.
   */
  dispatch(id: EntryId, spec: TransactionSpec): boolean {
    const view = views.get(id);
    if (view) {
      view.dispatch(spec);
      return true;
    }
    const s = states.get(id);
    if (!s) return false;
    const tr = s.update(spec);
    states.set(id, tr.state);
    if (tr.docChanged) notify(id, tr.state);
    return true;
  },

  /** Replaces the whole text after a change made outside the editor (restore, link rewrite). Undoable. */
  replaceAll(id: EntryId, text: string) {
    const cur = docModel.text(id);
    if (cur === undefined || cur === text) return;
    docModel.dispatch(id, {
      changes: { from: 0, to: cur.length, insert: text },
      userEvent: 'external',
    });
  },

  undo(id: EntryId): boolean {
    return runCommand(id, undo);
  },

  redo(id: EntryId): boolean {
    return runCommand(id, redo);
  },

  canUndo(id: EntryId): boolean {
    const s = views.get(id)?.state ?? states.get(id);
    return !!s && undoDepth(s) > 0;
  },

  canRedo(id: EntryId): boolean {
    const s = views.get(id)?.state ?? states.get(id);
    return !!s && redoDepth(s) > 0;
  },

  /** Forgets a closed document. */
  drop(id: EntryId) {
    states.delete(id);
  },

  /** Forgets everything (another tab took over the workspace). */
  reset() {
    states.clear();
  },
};

function runCommand(
  id: EntryId,
  cmd: (t: { state: EditorState; dispatch: (tr: Transaction) => void }) => boolean,
): boolean {
  const view = views.get(id);
  const state = view?.state ?? states.get(id);
  if (!state) return false;
  return cmd({
    state,
    dispatch: (tr) => {
      if (view) view.dispatch(tr);
      else {
        states.set(id, tr.state);
        if (tr.docChanged) notify(id, tr.state);
      }
    },
  });
}
