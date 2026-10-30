import { StateEffect, StateField, Prec, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap } from '@codemirror/view';
import {
  completionStatus,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import type { EntryId } from '@/domain/types';
import { isMarkdownName } from '@/domain/names';
import { AiError, aiSource, complete } from '../ai';
import { docIdFacet, docModel } from '../doc-model';
import { ws } from '../app-store';
import { navigate } from '../router';
import { hudhudElement } from './hudhud-art';
import { offerReminders } from './chat';
import { instructionsFor, isPrivate } from './memory';
import {
  MARKER,
  cleanInsertion,
  findAonRequest,
  inlineSystem,
  inlineUser,
  needsBreak,
  windowAround,
} from './protocol';

/**
 * AON inside a document. A request (`@aon …` + Enter, or a rewrite of the selection) shows
 * a suggestion under the text. Nothing is written to the file until it is accepted.
 */

export interface Suggestion {
  run: number;
  /** The text this suggestion replaces: the `@aon` request, the selection, or nothing. */
  from: number;
  to: number;
  original: string;
  kind: 'request' | 'selection';
  request: string;
  status: 'working' | 'ready' | 'error';
  text: string;
  error?: string;
  /** What to offer once the text is accepted. */
  followUp?: 'reminders';
  /** The error is about setup, so the suggestion offers the settings. */
  setup?: boolean;
}

const MAX_SELECTION = 20_000;
const set = StateEffect.define<Suggestion | null>();
const update = StateEffect.define<{ run: number; patch: Partial<Suggestion> }>();

export const suggestionField = StateField.define<Suggestion | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(set)) return e.value;
      if (e.is(update) && value && value.run === e.value.run)
        value = { ...value, ...e.value.patch };
    }
    if (value && tr.docChanged) {
      const from = tr.changes.mapPos(value.from, 1);
      value = { ...value, from, to: Math.max(from, tr.changes.mapPos(value.to, -1)) };
    }
    return value;
  },
  provide: (f) =>
    EditorView.decorations.from(f, (s) => {
      if (!s) return Decoration.none;
      return Decoration.set(
        Decoration.widget({ widget: new SuggestionWidget(s), block: true, side: 1 }).range(
          // Shown under the line where the replaced text ends.
          s.to,
        ),
      );
    }),
});

let runs = 0;
const controllers = new Map<EntryId, AbortController>();

const docOf = (state: EditorState) => state.facet(docIdFacet);

function isDocType(id: EntryId) {
  const name = ws().get(id)?.name ?? '';
  return isMarkdownName(name) || /\.txt$/i.test(name);
}

/** Starts a request: asks the model and streams the answer into the suggestion. */
export function startInline(
  view: EditorView,
  opts: {
    from: number;
    to: number;
    request: string;
    kind: Suggestion['kind'];
    followUp?: Suggestion['followUp'];
  },
) {
  const docId = docOf(view.state);
  if (!docId || view.state.readOnly) return;
  const s: Suggestion = {
    run: ++runs,
    ...opts,
    original: view.state.doc.sliceString(opts.from, opts.to),
    status: 'working',
    text: '',
  };
  view.dispatch({ effects: set.of(s) });
  void execute(docId, s);
}

const patchRun = (docId: EntryId, run: number, patch: Partial<Suggestion>) =>
  docModel.dispatch(docId, { effects: update.of({ run, patch }) });

async function execute(docId: EntryId, s: Suggestion) {
  controllers.get(docId)?.abort();
  const controller = new AbortController();
  controllers.set(docId, controller);
  const fail = (error: string, setup = false) =>
    patchRun(docId, s.run, { status: 'error', error, setup });
  const tree = ws().tree;
  const texts = ws().allTexts();
  if (isPrivate(tree, texts, docId))
    return fail(
      'This folder is private to AON. Set “private: false” in its AON.md to use AON here.',
    );
  const source = aiSource();
  if (source === 'none' || source === 'sign-in')
    return fail(
      source === 'sign-in'
        ? 'Sign in with Google to use the free allowance, or add your own API key in Settings.'
        : 'Add your own API key, or choose a local model, in Settings to use AON.',
      true,
    );
  if (s.kind === 'selection' && s.original.length > MAX_SELECTION)
    return fail('The selection is too long for AON (20,000 characters at most). Select less.');
  const text = docModel.text(docId) ?? '';
  const path = tree.pathOf(docId);
  const user =
    s.kind === 'selection'
      ? inlineUser({
          path,
          doc: windowAround(text, s.from, 6000),
          selection: s.original,
          request: s.request,
        })
      : inlineUser({
          path,
          doc: windowAround(text.slice(0, s.from) + MARKER + text.slice(s.to), s.from, 24_000),
          request: s.request,
        });
  let acc = '';
  try {
    const r = await complete(
      {
        system: inlineSystem({
          now: new Date(),
          instructions: instructionsFor(tree, texts, docId),
        }),
        messages: [{ role: 'user', content: user }],
        maxTokens: 2048,
      },
      {
        signal: controller.signal,
        onText(chunk) {
          acc += chunk;
          patchRun(docId, s.run, { text: acc });
        },
      },
    );
    const out = cleanInsertion(r.text);
    if (!out.trim()) return fail('AON returned nothing. Try rephrasing the request.');
    patchRun(docId, s.run, { status: 'ready', text: out });
  } catch (e) {
    if (controller.signal.aborted) return;
    fail(e instanceof AiError || e instanceof Error ? e.message : 'AON could not finish.');
  } finally {
    if (controllers.get(docId) === controller) controllers.delete(docId);
  }
}

function current(view: EditorView) {
  return view.state.field(suggestionField, false) ?? null;
}

export function discardSuggestion(view: EditorView): boolean {
  const s = current(view);
  if (!s) return false;
  controllers.get(docOf(view.state))?.abort();
  view.dispatch({ effects: set.of(null) });
  view.focus();
  return true;
}

export function acceptSuggestion(view: EditorView): boolean {
  const s = current(view);
  if (!s || s.status !== 'ready') return false;
  if (view.state.doc.sliceString(s.from, s.to) !== s.original) {
    view.dispatch({
      effects: update.of({
        run: s.run,
        patch: { status: 'error', error: 'The text changed while AON worked. Retry or discard.' },
      }),
    });
    return true;
  }
  const lead =
    s.from === s.to &&
    needsBreak(view.state.doc.sliceString(Math.max(0, s.from - 1), s.from), s.text)
      ? '\n\n'
      : '';
  view.dispatch({
    changes: { from: s.from, to: s.to, insert: lead + s.text },
    selection: { anchor: s.from + lead.length + s.text.length },
    effects: set.of(null),
    userEvent: 'input.aon',
    scrollIntoView: true,
  });
  view.focus();
  if (s.followUp === 'reminders') offerReminders(docOf(view.state));
  return true;
}

export function retrySuggestion(view: EditorView): boolean {
  const s = current(view);
  if (!s || s.status === 'working') return false;
  startInline(view, {
    from: s.from,
    to: s.to,
    request: s.request,
    kind: s.kind,
    followUp: s.followUp,
  });
  return true;
}

/** Enter on a line holding `@aon <request>` asks AON instead of adding a line. */
function onEnter(view: EditorView): boolean {
  const docId = docOf(view.state);
  const sel = view.state.selection.main;
  if (
    !sel.empty ||
    view.composing ||
    view.state.readOnly ||
    completionStatus(view.state) === 'active'
  )
    return false;
  if (!docId || !isDocType(docId)) return false;
  const line = view.state.doc.lineAt(sel.head);
  const m = findAonRequest(line.text);
  if (!m) return false;
  if (current(view)?.status === 'working') return true;
  startInline(view, {
    from: line.from + m.index,
    to: line.to,
    request: m.request,
    kind: 'request',
  });
  return true;
}

class SuggestionWidget extends WidgetType {
  constructor(readonly s: Suggestion) {
    super();
  }
  override eq(o: SuggestionWidget) {
    const a = this.s;
    const b = o.s;
    return a.run === b.run && a.status === b.status && a.text === b.text && a.error === b.error;
  }
  toDOM(view: EditorView) {
    const el = document.createElement('div');
    el.className = 'cm-aon';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'AON suggestion');
    this.render(el, view);
    return el;
  }
  override updateDOM(dom: HTMLElement, view: EditorView) {
    this.render(dom, view);
    return true;
  }
  override ignoreEvent() {
    return true;
  }
  private render(el: HTMLElement, view: EditorView) {
    const s = this.s;
    const btn = (label: string, run: () => void, primary = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn ${primary ? 'btn-primary' : 'btn-secondary'} cm-aon-btn`;
      b.textContent = label;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', run);
      return b;
    };
    const head = document.createElement('div');
    head.className = 'cm-aon-head';
    head.setAttribute('role', 'status');
    head.textContent =
      s.status === 'working'
        ? 'AON is writing…'
        : s.status === 'ready'
          ? 'AON suggests'
          : 'AON could not do that';
    const pose = s.status === 'working' ? 'thinking' : s.status === 'ready' ? 'success' : 'idle';
    // Reuse the bird while streaming, so its fade-in doesn't restart on every chunk.
    const old = el.querySelector<HTMLElement>('.cm-aon-head .hudhud');
    head.prepend(old?.dataset.state === pose ? old : hudhudElement(pose));
    const body = document.createElement('div');
    body.className = 'cm-aon-body';
    if (s.status === 'error') body.classList.add('cm-aon-error');
    body.textContent = s.status === 'error' ? (s.error ?? '') : s.text;
    const actions = document.createElement('div');
    actions.className = 'cm-aon-actions';
    if (s.status === 'ready') actions.append(btn('Accept', () => acceptSuggestion(view), true));
    if (s.status === 'error' && s.setup)
      actions.append(btn('Open settings', () => navigate({ name: 'settings' }), true));
    if (s.status !== 'working') actions.append(btn('Retry', () => retrySuggestion(view)));
    actions.append(btn(s.status === 'working' ? 'Stop' : 'Discard', () => discardSuggestion(view)));
    if (s.status === 'ready') {
      const hint = document.createElement('span');
      hint.className = 'cm-aon-hint';
      hint.textContent = 'Ctrl+Enter to accept, Esc to discard';
      actions.append(hint);
    }
    el.replaceChildren(head, body, actions);
  }
}

/** Typing `@a` offers `@aon`, so the feature can be found without knowing about it. */
export function aonCompletion(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/@a\w*/);
  if (!m || !isDocType(docOf(ctx.state))) return null;
  const before = m.from > 0 ? ctx.state.doc.sliceString(m.from - 1, m.from) : '';
  if (/[\\\w@]/.test(before)) return null;
  return {
    from: m.from,
    options: [{ label: '@aon', detail: 'Ask AON to write or edit here', apply: '@aon ' }],
    validFor: /^@\w*$/,
  };
}

const theme = EditorView.baseTheme({
  '.cm-aon': {
    margin: '6px 0 10px',
    padding: '10px 12px',
    border: '1px solid var(--primary)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--primary-soft)',
    color: 'var(--primary-soft-ink)',
    fontFamily: 'var(--font-sans, inherit)',
    fontSize: '14px',
    lineHeight: '1.5',
  },
  '.cm-aon-head': {
    fontSize: '12px',
    fontWeight: '600',
    marginBottom: '4px',
    opacity: '0.85',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  '.cm-aon-head .hudhud': { '--hudhud-size': '22px' },
  '.cm-aon-body': {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: '320px',
    overflowY: 'auto',
  },
  '.cm-aon-error': { color: 'var(--danger)' },
  '.cm-aon-actions': {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
    marginTop: '8px',
  },
  '.cm-aon-btn': { height: '28px', padding: '0 10px', fontSize: '12px' },
  '.cm-aon-hint': { fontSize: '12px', opacity: '0.7', marginLeft: '4px' },
});

export function aonExtension(): Extension {
  return [
    suggestionField,
    theme,
    Prec.highest(
      keymap.of([
        { key: 'Enter', run: onEnter },
        { key: 'Mod-Enter', run: acceptSuggestion },
      ]),
    ),
    // A key handler, not a keymap entry: the autocomplete keymap comes first in a keymap and
    // swallows Escape whenever a completion is open or still being computed.
    Prec.highest(
      EditorView.domEventHandlers({
        keydown: (e, view) => e.key === 'Escape' && discardSuggestion(view),
      }),
    ),
  ];
}
