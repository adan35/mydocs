import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { openSearchPanel } from '@codemirror/search';
import type { EntryId } from '@/domain/types';
import { isMarkdownName } from '@/domain/names';
import { useSettings } from '@/app/settings-store';
import { docIdFacet, docModel } from '@/app/doc-model';
import { findFirstMatch as findFirst } from '@/app/search';
import {
  configureLanguage,
  isDark,
  readOnlyComp,
  settingsComp,
  settingsExtensions,
  themeComp,
} from './setup';

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
  /** The document's text when the editor first shows it (later changes come from the document model). */
  text: string;
  readOnly?: boolean;
  onScrollLine?(line: number): void;
  /** Called when the editor's scroll position or geometry changes (for scroll sync). */
  onScroll?(): void;
  /** Called after any update, so toolbars can reflect the selection. */
  onUpdate?(view: EditorView): void;
  ref?: Ref<EditorHandle>;
}

const scrollCache = new Map<string, number>();

/**
 * The source editor. It shows the document model's state for `docId`: edits are
 * applied to that state and reported by the model, so the editor never decides
 * which document a change belongs to.
 */
export function Editor({
  docId,
  name,
  text,
  readOnly,
  onScrollLine,
  onScroll,
  onUpdate,
  ref,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const callbacks = useRef({ onScrollLine, onScroll, onUpdate });
  callbacks.current = { onScrollLine, onScroll, onUpdate };

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

  // Create the view once. Transactions are reported to the document model of the
  // state's own document, read from the state, never from this component's props.
  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      dispatchTransactions(trs, v) {
        v.update(trs);
        const id = v.state.facet(docIdFacet);
        if (id) docModel.viewUpdated(id, trs, v.state);
        callbacks.current.onUpdate?.(v);
      },
    });
    viewRef.current = view;
    let scrollRaf = 0;
    const onScrollEvent = () => {
      callbacks.current.onScroll?.();
      cancelAnimationFrame(scrollRaf);
      scrollRaf = requestAnimationFrame(() => {
        const id = view.state.facet(docIdFacet);
        if (id) scrollCache.set(id, view.scrollDOM.scrollTop);
        if (!callbacks.current.onScrollLine) return;
        const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop + 8);
        callbacks.current.onScrollLine(view.state.doc.lineAt(block.from).number - 1);
      });
    };
    view.scrollDOM.addEventListener('scroll', onScrollEvent, { passive: true });
    return () => {
      view.scrollDOM.removeEventListener('scroll', onScrollEvent);
      const id = view.state.facet(docIdFacet);
      if (id) docModel.detach(id, view);
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Show this document's state (history, selection and all).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const prevId = view.state.facet(docIdFacet);
    if (prevId === docId) return;
    if (prevId) docModel.detach(prevId, view);
    const state: EditorState = docModel.state(docId, text);
    view.setState(state);
    docModel.attach(docId, view);
    // Settings may have changed while this document's state was in the model.
    view.dispatch({
      effects: [
        settingsComp.reconfigure(settingsExtensions()),
        readOnlyComp.reconfigure(EditorState.readOnly.of(!!readOnly)),
        themeComp.reconfigure(EditorView.darkTheme.of(isDark())),
      ],
    });
    configureLanguage(view, name);
    view.dom.dataset.docId = docId;
    const top = scrollCache.get(docId);
    if (top) requestAnimationFrame(() => (view.scrollDOM.scrollTop = top));
    callbacks.current.onUpdate?.(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  // Renames change the language and accessible name.
  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.facet(docIdFacet) === docId) configureLanguage(view, name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

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

  return (
    <div
      ref={host}
      className="h-full min-h-0"
      data-testid="editor"
      // Alt-drop explicitly attaches files; a regular drop imports them app-wide.
      data-attach-drop={isMarkdownName(name) && !readOnly ? '' : undefined}
    />
  );
}
