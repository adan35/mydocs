import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
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
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  searchKeymap,
  highlightSelectionMatches,
  search,
  openSearchPanel,
} from '@codemirror/search';
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
import type { EntryId } from '@/domain/types';
import { baseName, isMarkdownName } from '@/domain/names';
import { useSettings } from '@/app/settings-store';
import { session, ws } from '@/app/app-store';
import { saveAttachment } from '@/app/attachments';
import { toastError } from '@/app/toast-store';
import { findFirstMatch as findFirst } from '@/app/search';
import { markdownHighlight } from './highlight';
import { slashCompletion } from './slash';
import { insertCodeBlock, insertLink, insertText, toggleLinePrefix, toggleWrap } from './commands';

export interface EditorHandle {
  view: EditorView | null;
  /** Focuses the editor, optionally selecting the first match of `find` or moving to the end. */
  focus(opts?: { find?: string[]; end?: boolean }): void;
  scrollToLine(line: number): void;
  openSearch(): void;
}

interface Props {
  docId: EntryId;
  name: string;
  text: string;
  /** Changes when text was replaced externally and must be reloaded. */
  rev: number;
  readOnly?: boolean;
  onChange(text: string): void;
  onSave(): void;
  onScrollLine?(line: number): void;
  ref?: Ref<EditorHandle>;
}

/**
 * Shared by every editor instance, so a cached state from an earlier instance can
 * still be reconfigured when it is shown again.
 */
const settingsComp = new Compartment();
const langComp = new Compartment();
const readOnlyComp = new Compartment();

/** Per-document editor state (selection, undo history) survives tab switches. */
const stateCache = new Map<string, { state: EditorState; rev: number }>();
const scrollCache = new Map<string, number>();

function wikiAndTagCompletion(docId: EntryId) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const wiki = ctx.matchBefore(/\[\[[^\]\n]*/);
    if (wiki) {
      const tree = ws().tree;
      return {
        from: wiki.from + 2,
        options: tree
          .liveFiles()
          .filter((e) => e.id !== docId && isMarkdownName(e.name))
          .slice(0, 2000)
          .map((e) => ({
            label: baseName(e.name),
            detail: tree.dirOf(e.id) || undefined,
            apply: applyWikiTarget(baseName(e.name)),
            type: 'text',
          })),
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
  };
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

/** CodeMirror's own defaults (selection, panels, autocomplete) follow the app theme too. */
const themeComp = new Compartment();
const isDark = () => document.documentElement.dataset.theme === 'dark';

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

function settingsExtensions(): Extension[] {
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

export function Editor({
  docId,
  name,
  text,
  rev,
  readOnly,
  onChange,
  onSave,
  onScrollLine,
  ref,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onSave, onScrollLine });
  callbacks.current = { onChange, onSave, onScrollLine };
  const docRef = useRef(docId);
  docRef.current = docId;

  useImperativeHandle(ref, () => ({
    get view() {
      return viewRef.current;
    },
    focus({ find, end }: { find?: string[]; end?: boolean } = {}) {
      const view = viewRef.current;
      if (!view) return;
      view.focus();
      if (!find?.length && !end) return;
      const match = find?.length ? findFirst(view.state.doc.toString(), find) : null;
      // After the scroll position restored for this document.
      requestAnimationFrame(() => {
        if (viewRef.current !== view) return;
        if (match) {
          view.dispatch({
            selection: { anchor: match.from, head: match.to },
            effects: EditorView.scrollIntoView(match.from, { y: 'center' }),
          });
        } else if (end) {
          view.dispatch({
            selection: { anchor: view.state.doc.length },
            scrollIntoView: true,
          });
        }
        view.focus();
      });
    },
    scrollToLine(line: number) {
      const view = viewRef.current;
      if (!view) return;
      const l = view.state.doc.line(Math.min(Math.max(1, line + 1), view.state.doc.lines));
      view.dispatch({
        selection: { anchor: l.from },
        effects: EditorView.scrollIntoView(l.from, { y: 'start', yMargin: 24 }),
      });
      view.focus();
    },
    openSearch() {
      if (viewRef.current) openSearchPanel(viewRef.current);
    },
  }));

  // Create the view once.
  useEffect(() => {
    const view = new EditorView({ parent: host.current! });
    viewRef.current = view;
    let scrollRaf = 0;
    const onScroll = () => {
      cancelAnimationFrame(scrollRaf);
      scrollRaf = requestAnimationFrame(() => {
        scrollCache.set(docRef.current, view.scrollDOM.scrollTop);
        if (!callbacks.current.onScrollLine) return;
        const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop + 8);
        callbacks.current.onScrollLine(view.state.doc.lineAt(block.from).number - 1);
      });
    };
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      view.scrollDOM.removeEventListener('scroll', onScroll);
      stateCache.set(docRef.current, { state: view.state, rev: -1 });
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Swap documents (or reload externally changed text) without losing per-doc history.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const prevId = view.dom.dataset.docId;
    if (prevId && prevId !== docId) {
      stateCache.set(prevId, { state: view.state, rev: Number(view.dom.dataset.rev) });
    }
    const cached = stateCache.get(docId);
    let state: EditorState;
    if (cached && cached.state.doc.toString() === text) {
      state = cached.state;
    } else if (prevId === docId && view.state.doc.toString() !== text) {
      // External change to the open doc: replace content but keep undo history.
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        userEvent: 'external',
      });
      view.dom.dataset.rev = String(rev);
      return;
    } else if (prevId === docId) {
      return;
    } else {
      state = createState(text);
    }
    view.setState(state);
    // Settings may have changed while this document's state sat in the cache.
    view.dispatch({
      effects: [
        settingsComp.reconfigure(settingsExtensions()),
        readOnlyComp.reconfigure(EditorState.readOnly.of(!!readOnly)),
        themeComp.reconfigure(EditorView.darkTheme.of(isDark())),
      ],
    });
    view.dom.dataset.docId = docId;
    view.dom.dataset.rev = String(rev);
    const top = scrollCache.get(docId);
    if (top) requestAnimationFrame(() => (view.scrollDOM.scrollTop = top));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, rev]);

  // Language, completions and the accessible name follow the file name (renames included).
  useEffect(() => {
    const view = viewRef.current;
    if (view) configureLanguage(view, name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, name]);

  // Light and dark switch without reopening the document.
  useEffect(() => {
    const obs = new MutationObserver(() =>
      viewRef.current?.dispatch({
        effects: themeComp.reconfigure(EditorView.darkTheme.of(isDark())),
      }),
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  // Live settings changes.
  useEffect(
    () =>
      useSettings.subscribe(() => {
        viewRef.current?.dispatch({
          effects: settingsComp.reconfigure(settingsExtensions()),
        });
      }),
    [],
  );

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyComp.reconfigure(EditorState.readOnly.of(!!readOnly)),
    });
  }, [readOnly, docId]);

  function configureLanguage(view: EditorView, fileName: string) {
    const label = EditorView.contentAttributes.of({ 'aria-label': `Edit ${fileName}` });
    if (isMarkdownName(fileName)) {
      view.dispatch({
        effects: langComp.reconfigure([
          label,
          markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
          autocompletion({
            override: [wikiAndTagCompletion(docId), slashCompletion],
            icons: false,
          }),
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
        if (viewRef.current === view && view.dom.dataset.docId === docId) {
          view.dispatch({ effects: langComp.reconfigure([label, support]) });
        }
      });
    }
  }

  function createState(doc: string): EditorState {
    return EditorState.create({
      doc,
      extensions: [
        highlightSpecialChars(),
        history(),
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
        readOnlyComp.of(EditorState.readOnly.of(!!readOnly)),
        keymap.of([
          { key: 'Mod-s', preventDefault: true, run: () => (callbacks.current.onSave(), true) },
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
        EditorView.updateListener.of((u) => {
          if (u.docChanged) callbacks.current.onChange(u.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          paste: (event, view) => handleFiles(event.clipboardData?.files, view, event),
          drop: (event, view) => {
            if (!event.dataTransfer?.files.length) return false;
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos !== null) view.dispatch({ selection: { anchor: pos } });
            return handleFiles(event.dataTransfer.files, view, event);
          },
        }),
      ],
    });
  }

  function handleFiles(files: FileList | undefined, view: EditorView, event: Event): boolean {
    if (!files?.length || !isMarkdownName(name)) return false;
    event.preventDefault();
    event.stopPropagation();
    const id = docRef.current;
    void (async () => {
      const parts: string[] = [];
      for (const file of files) {
        try {
          parts.push(await saveAttachment(id, file));
        } catch (err) {
          toastError(`Unable to attach "${file.name}".`, err);
        }
      }
      if (parts.length && viewRef.current === view && view.dom.dataset.docId === id) {
        insertText(view, parts.join('\n'));
      }
    })();
    return true;
  }

  return <div ref={host} className="h-full min-h-0" data-testid="editor" />;
}
