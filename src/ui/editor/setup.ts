import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  placeholder,
  highlightSpecialChars,
} from '@codemirror/view';
import { defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search';
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import {
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
  foldGutter,
  LanguageDescription,
  indentUnit,
} from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { baseName, isMarkdownName } from '@/domain/names';
import { extractHeadings } from '@/domain/outline';
import { useSettings } from '@/app/settings-store';
import { session, ws } from '@/app/app-store';
import { saveAttachment } from '@/app/attachments';
import { toastError } from '@/app/toast-store';
import { docIdFacet, docModel } from '@/app/doc-model';
import { editorActions } from '@/app/editor-store';
import { resolveWikiLink } from '@/app/workspace';
import { markdownHighlight } from './highlight';
import { slashCompletion } from './slash';
import { insertCodeBlock, insertLink, insertText, toggleLinePrefix, toggleWrap } from './commands';

/**
 * Editor configuration shared by every document state, whether it is on screen or not.
 * Nothing here closes over a component or a document: the document a state belongs to
 * is read from `docIdFacet`, so states can move between editor instances safely.
 */

export const settingsComp = new Compartment();
export const langComp = new Compartment();
export const readOnlyComp = new Compartment();
/** CodeMirror's own defaults (selection, panels, autocomplete) follow the app theme too. */
export const themeComp = new Compartment();
export const isDark = () => document.documentElement.dataset.theme === 'dark';

const docIdOf = (state: EditorState) => state.facet(docIdFacet);

/**
 * `[[` completes document names (and `[[Name#` its headings); `#` completes tags.
 * Names shared by several documents complete to their path, so the link is unambiguous.
 */
function wikiAndTagCompletion(ctx: CompletionContext): CompletionResult | null {
  const docId = docIdOf(ctx.state);
  const heading = ctx.matchBefore(/\[\[[^\]\n#|]+#[^\]\n|]*/);
  if (heading) {
    const hash = heading.text.indexOf('#');
    const target = resolveWikiLink(ws().tree, heading.text.slice(2, hash));
    if (!target) return null;
    const text =
      target.id === docId ? ctx.state.doc.toString() : (ws().allTexts().get(target.id) ?? '');
    return {
      from: heading.from + hash + 1,
      options: extractHeadings(text).map((h) => ({
        label: h.text,
        detail: `H${h.level}`,
        apply: applyWikiTarget(h.text),
        type: 'property',
      })),
      validFor: /^[^\]\n|]*$/,
    };
  }
  const wiki = ctx.matchBefore(/\[\[[^\]\n]*/);
  if (wiki) {
    const tree = ws().tree;
    const files = tree.liveFiles().filter((e) => e.id !== docId);
    const counts = new Map<string, number>();
    for (const e of files) {
      const key = baseName(e.name).toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return {
      from: wiki.from + 2,
      options: files
        .filter((e) => isMarkdownName(e.name))
        .slice(0, 2000)
        .map((e) => {
          const name = baseName(e.name);
          const duplicate = (counts.get(name.toLowerCase()) ?? 0) > 1;
          const dir = tree.dirOf(e.id);
          // Two documents share this name: link by path so the link means this one.
          const target = duplicate && dir ? `${dir}/${name}` : name;
          return {
            label: name,
            detail: dir || undefined,
            info: duplicate ? 'Several documents have this name; links by path.' : undefined,
            apply: applyWikiTarget(target),
            type: 'text',
            boost: duplicate ? -1 : 0,
          } satisfies Completion;
        }),
      validFor: /^[^\]\n]*$/,
    };
  }
  const tag = ctx.matchBefore(/(^|\s)#[\p{L}\p{N}_\-/]*/u);
  if (tag && (tag.text.length > 1 || ctx.explicit)) {
    const start = tag.from + tag.text.indexOf('#') + 1;
    return {
      from: start,
      options: session()
        .knowledge.allTags(ws().tree)
        .map(({ tag: t, count }) => ({ label: t, detail: `${count}`, type: 'keyword' })),
      validFor: /^[\p{L}\p{N}_\-/]*$/u,
    };
  }
  return null;
}

/** Inserts a wiki link target, reusing the `]]` that bracket auto-closing already typed. */
function applyWikiTarget(target: string) {
  return (view: EditorView, _c: Completion, from: number, to: number) => {
    const end = view.state.sliceDoc(to, to + 2) === ']]' ? to + 2 : to;
    const insert = `${target}]]`;
    view.dispatch({
      changes: { from, to: end, insert },
      selection: { anchor: from + insert.length },
      userEvent: 'input.complete',
    });
  };
}

const LIST_MARKER = String.raw`(?:[-*+] (?:\[[ xX]\] )?|\d+[.)] )`;
const DOUBLE_MARKER = new RegExp(String.raw`^(\s*)${LIST_MARKER}(${LIST_MARKER})$`);

/**
 * Lists continue automatically on Enter, so people who then type the marker
 * themselves ("- [ ] ") would get it twice. Typing a marker straight after an
 * automatic one replaces it instead.
 */
const dedupeListMarker = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== ' ' || from !== to) return false;
  const line = view.state.doc.lineAt(from);
  const before = line.text.slice(0, from - line.from) + ' ';
  if (from !== line.to) return false;
  const m = DOUBLE_MARKER.exec(before);
  if (!m) return false;
  const insert = `${m[1]}${m[2]}`;
  view.dispatch({
    changes: { from: line.from, to: line.to, insert },
    selection: { anchor: line.from + insert.length },
    userEvent: 'input.type',
  });
  return true;
});

/**
 * Fonts and editor chrome (gutter, cursor, find bar, tooltips) come from CSS variables
 * set by the app theme and document view. They live in an editor theme because
 * CodeMirror's base theme outranks plain stylesheet rules.
 */
const fontTheme = EditorView.theme({
  '.cm-scroller': {
    fontFamily: 'var(--editor-font, var(--font-mono))',
    lineHeight: 'var(--editor-line-height, 1.7)',
  },
  '.cm-content': { fontVariantLigatures: 'none', caretColor: 'var(--ink)' },
  '.cm-gutters': {
    backgroundColor: 'var(--canvas)',
    color: 'var(--stone)',
    border: 'none',
  },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ink)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--hover) 60%, transparent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--ink)' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--mark) 70%, transparent)' },
  '.cm-searchMatch': {
    backgroundColor: 'var(--mark)',
    outline: '1px solid color-mix(in srgb, var(--warning) 40%, transparent)',
    borderRadius: '2px',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--warning) 35%, transparent)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--surface-soft)',
    color: 'var(--charcoal)',
    borderColor: 'var(--hairline)',
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--hairline)' },
  '.cm-panel.cm-search': {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 48px 8px 12px',
    fontFamily: 'var(--font-sans)',
    fontSize: '13px',
  },
  '.cm-panel.cm-search br': { flexBasis: '100%', height: '0' },
  '.cm-panel.cm-search input[type=checkbox]': { accentColor: 'var(--primary)' },
  '.cm-panel.cm-search label': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    color: 'var(--slate)',
    fontSize: '12px',
  },
  '.cm-textfield': {
    height: '32px',
    margin: '0',
    padding: '0 10px',
    border: '1px solid var(--hairline-strong)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--canvas)',
    color: 'var(--ink)',
    fontSize: '13px',
    minWidth: '140px',
    flex: '1 1 160px',
    maxWidth: '280px',
  },
  '.cm-textfield:focus': { outline: 'none', borderColor: 'var(--primary)' },
  '.cm-button': {
    height: '32px',
    margin: '0',
    padding: '0 10px',
    backgroundColor: 'var(--canvas)',
    backgroundImage: 'none',
    border: '1px solid var(--hairline)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--charcoal)',
    fontSize: '12px',
    textTransform: 'capitalize',
  },
  '.cm-button:hover': { backgroundColor: 'var(--hover)' },
  '.cm-button:active': { backgroundImage: 'none', backgroundColor: 'var(--active)' },
  '.cm-panel.cm-search [name=close]': {
    position: 'absolute',
    top: '8px',
    right: '10px',
    width: '32px',
    height: '32px',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--steel)',
    fontSize: '20px',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--canvas)',
    color: 'var(--charcoal)',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-3)',
    overflow: 'hidden',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--hairline)',
    color: 'var(--steel)',
  },
});

/** Typewriter scrolling: the line being edited stays near the middle of the screen. */
const typewriter: Extension = [
  EditorView.editorAttributes.of({ class: 'cm-typewriter' }),
  EditorView.updateListener.of((u) => {
    if (!u.selectionSet && !u.docChanged) return;
    if (
      !u.transactions.some(
        (tr) => tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('select'),
      )
    )
      return;
    const view = u.view;
    requestAnimationFrame(() => {
      if (!view.dom.isConnected) return;
      view.dispatch({
        effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' }),
      });
    });
  }),
];

export function settingsExtensions(): Extension[] {
  const s = useSettings.getState();
  return [
    s.lineNumbers ? [lineNumbers(), highlightActiveLineGutter(), foldGutter()] : [],
    s.wordWrap ? EditorView.lineWrapping : [],
    EditorState.tabSize.of(s.tabSize),
    indentUnit.of(' '.repeat(s.tabSize)),
    s.typewriter ? typewriter : [],
    EditorView.contentAttributes.of({
      spellcheck: s.spellcheck ? 'true' : 'false',
      autocorrect: 'on',
      autocapitalize: 'sentences',
    }),
  ];
}

function handleFiles(files: FileList | undefined, view: EditorView, event: Event): boolean {
  const id = docIdOf(view.state);
  const entry = ws().get(id);
  if (!files?.length || !entry || !isMarkdownName(entry.name) || view.state.readOnly) return false;
  event.preventDefault();
  event.stopPropagation();
  void (async () => {
    const parts: string[] = [];
    for (const file of files) {
      try {
        parts.push(await saveAttachment(id, file));
      } catch (err) {
        toastError(`Unable to attach "${file.name}".`, err);
      }
    }
    // Inserted where the document is now, even if it moved to another editor meanwhile.
    if (!parts.length) return;
    const state = docModel.state(id, '');
    const { from, to } = state.selection.main;
    const text = parts.join('\n');
    if (view.state.facet(docIdFacet) === id && view.dom.isConnected) insertText(view, text);
    else
      docModel.dispatch(id, {
        changes: { from, to, insert: text },
        userEvent: 'input',
      });
  })();
  return true;
}

/** Extensions every document state carries. History comes from the document model. */
export function documentExtensions(): Extension {
  return [
    highlightSpecialChars(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    syntaxHighlighting(markdownHighlight),
    fontTheme,
    themeComp.of(EditorView.darkTheme.of(isDark())),
    search({ top: true }),
    settingsComp.of(settingsExtensions()),
    langComp.of([]),
    readOnlyComp.of(EditorState.readOnly.of(false)),
    keymap.of([
      {
        key: 'Mod-s',
        preventDefault: true,
        run: (v) => (void editorActions.flush(docIdOf(v.state)), true),
      },
      { key: 'Mod-b', run: (v) => toggleWrap(v, '**') },
      { key: 'Mod-i', run: (v) => toggleWrap(v, '*') },
      { key: 'Mod-Shift-x', run: (v) => toggleWrap(v, '~~') },
      { key: 'Mod-`', run: (v) => toggleWrap(v, '`', 'code') },
      { key: 'Mod-Shift-k', preventDefault: true, run: (v) => insertLink(v) },
      { key: 'Mod-Alt-1', run: (v) => toggleLinePrefix(v, '# ') },
      { key: 'Mod-Alt-2', run: (v) => toggleLinePrefix(v, '## ') },
      { key: 'Mod-Alt-3', run: (v) => toggleLinePrefix(v, '### ') },
      { key: 'Mod-Shift-8', run: (v) => toggleLinePrefix(v, '- ') },
      { key: 'Mod-Shift-7', run: (v) => toggleLinePrefix(v, '1. ') },
      { key: 'Mod-Shift-9', run: (v) => toggleLinePrefix(v, '- [ ] ') },
      { key: 'Mod-Alt-c', run: (v) => insertCodeBlock(v) },
      ...closeBracketsKeymap,
      ...completionKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...defaultKeymap,
      indentWithTab,
    ]),
    EditorView.domEventHandlers({
      paste: (event, view) => handleFiles(event.clipboardData?.files, view, event),
      drop: (event, view) => {
        if (!event.altKey || !event.dataTransfer?.files.length) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos !== null) view.dispatch({ selection: { anchor: pos } });
        return handleFiles(event.dataTransfer.files, view, event);
      },
    }),
  ];
}

docModel.configure(() => documentExtensions());

/** Language, completions and the accessible name follow the file name (renames included). */
export function configureLanguage(view: EditorView, fileName: string) {
  const docId = docIdOf(view.state);
  const label = EditorView.contentAttributes.of({ 'aria-label': `Edit ${fileName}` });
  if (isMarkdownName(fileName)) {
    view.dispatch({
      effects: langComp.reconfigure([
        label,
        markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
        autocompletion({ override: [wikiAndTagCompletion, slashCompletion], icons: false }),
        dedupeListMarker,
        placeholder('Start writing…'),
      ]),
    });
    return;
  }
  const desc = LanguageDescription.matchFilename(languages, fileName);
  view.dispatch({ effects: langComp.reconfigure(label) });
  if (desc) {
    void desc.load().then((support) => {
      if (docIdOf(view.state) === docId) {
        view.dispatch({ effects: langComp.reconfigure([label, support]) });
      }
    });
  }
}
