import {
  Annotation,
  Compartment,
  EditorState,
  Facet,
  type Extension,
  Transaction,
  type TransactionSpec,
} from '@codemirror/state';
import { history, redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import type { EntryId } from '@/domain/types';
import { formatsExtension, formatsField, setFormats, type DocFormats } from './sheet-format-state';

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

/** Marks a change that came from a collaborator, so it is not sent back to them. */
export const remoteChange = Annotation.define<boolean>();

/** Where a shared document's collaboration extensions (remote cursors) live in its state. */
const collabComp = new Compartment();

/** Mirrors a shared document's local edits to its collaborators (see `collab.ts`). */
export interface DocSync {
  local(transactions: readonly Transaction[]): void;
}

/** Something that shows a state and applies transactions to it (an `EditorView`). */
export interface DocView {
  readonly state: EditorState;
  dispatch(tr: Transaction): void;
  dispatch(...specs: TransactionSpec[]): void;
}

type ChangeListener = (id: EntryId, text: string) => void;
type FormatListener = (id: EntryId, formats: DocFormats) => void;

const states = new Map<EntryId, EditorState>();
const views = new Map<EntryId, DocView>();
const listeners = new Set<ChangeListener>();
const formatListeners = new Set<FormatListener>();
const NO_FORMATS: DocFormats = {};
const syncs = new Map<EntryId, DocSync>();
/** Documents that can't be edited right now (viewer role, or a shared document that is offline). */
const locked = new Set<EntryId>();
let extensionsFor: (id: EntryId) => Extension = () => [];

function notify(id: EntryId, state: EditorState) {
  const text = state.doc.toString();
  for (const fn of listeners) fn(id, text);
}

/** Tells listeners when a transaction replaced the document's sheet colors (also when undone). */
function notifyFormats(id: EntryId, trs: readonly Transaction[], state: EditorState) {
  if (!trs.some((tr) => tr.effects.some((e) => e.is(setFormats)))) return;
  const formats = state.field(formatsField);
  for (const fn of formatListeners) fn(id, formats);
}

function create(id: EntryId, text: string): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [
      docIdFacet.of(id),
      history(),
      formatsExtension,
      collabComp.of([]),
      extensionsFor(id),
    ],
  });
}

export const docModel = {
  /** Sets the extensions every new document state gets (keymaps, completion…). Called by the UI. */
  configure(fn: (id: EntryId) => Extension) {
    extensionsFor = fn;
  },

  /** Notified with the document's sheet colors whenever they change, including by undo. */
  onFormats(fn: FormatListener): () => void {
    formatListeners.add(fn);
    return () => formatListeners.delete(fn);
  },

  /** The sheet colors of an open document. */
  formats(id: EntryId): DocFormats {
    const s = views.get(id)?.state ?? states.get(id);
    return s ? s.field(formatsField) : NO_FORMATS;
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
    notifyFormats(id, transactions, state);
    if (!transactions.some((tr) => tr.docChanged)) return;
    syncs.get(id)?.local(transactions);
    notify(id, state);
  },

  /** Starts mirroring a document's edits to collaborators; returns the function that stops it. */
  setSync(id: EntryId, sync: DocSync): () => void {
    syncs.set(id, sync);
    return () => {
      if (syncs.get(id) === sync) syncs.delete(id);
    };
  },

  /** Locked documents refuse edits from the app (the editor is also made read-only). */
  setLocked(id: EntryId, value: boolean) {
    if (value) locked.add(id);
    else locked.delete(id);
  },

  isLocked: (id: EntryId) => locked.has(id),

  /** Collaboration extensions (remote cursors) for a document, or none. */
  setCollabExtension(id: EntryId, ext: Extension) {
    docModel.dispatchRemote(id, { effects: collabComp.reconfigure(ext) });
  },

  /** Applies a collaborator's change: never mirrored back, not undoable, allowed on locked documents. */
  dispatchRemote(id: EntryId, spec: TransactionSpec): boolean {
    const was = locked.delete(id);
    try {
      return docModel.dispatch(id, {
        ...spec,
        annotations: [remoteChange.of(true), Transaction.addToHistory.of(false)],
      });
    } finally {
      if (was) locked.add(id);
    }
  },

  /**
   * Applies a change to a document, through its editor when one is attached.
   * Returns false when the document isn't open.
   */
  dispatch(id: EntryId, spec: TransactionSpec): boolean {
    if (locked.has(id)) return false;
    const view = views.get(id);
    if (view) {
      view.dispatch(spec);
      return true;
    }
    const s = states.get(id);
    if (!s) return false;
    const tr = s.update(spec);
    states.set(id, tr.state);
    notifyFormats(id, [tr], tr.state);
    if (tr.docChanged) {
      syncs.get(id)?.local([tr]);
      notify(id, tr.state);
    }
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
    syncs.delete(id);
    locked.delete(id);
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
  if (locked.has(id)) return false;
  const view = views.get(id);
  const state = view?.state ?? states.get(id);
  if (!state) return false;
  return cmd({
    state,
    dispatch: (tr) => {
      if (view) view.dispatch(tr);
      else {
        states.set(id, tr.state);
        notifyFormats(id, [tr], tr.state);
        if (tr.docChanged) {
          syncs.get(id)?.local([tr]);
          notify(id, tr.state);
        }
      }
    },
  });
}
