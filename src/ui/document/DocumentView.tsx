import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Columns2,
  Copy,
  Download,
  Eye,
  FolderInput,
  History,
  Maximize2,
  MoreHorizontal,
  PanelRight,
  PencilLine,
  Search,
  Star,
  Tag,
  Trash2,
  ArrowLeft,
  Minimize2,
  Focus,
  ChevronRight,
  FileQuestion,
  BookOpenCheck,
  Users,
  FileCode2,
  Link2,
  Link2Off,
  FileOutput,
  Table2,
  FileText,
  AlertCircle,
  LocateFixed,
} from 'lucide-react';
import type { Entry, EntryId } from '@/domain/types';
import { isMarkdownName } from '@/domain/names';
import { extractHeadings } from '@/domain/outline';
import { useOutlines, type DocOutline } from '@/app/outline-store';
import { textOutline, type TextOutline } from './text-outline';
import { toggleTaskAt } from '@/domain/tasks';
import { findFirstMatch } from '@/app/search';
import { ws } from '@/app/app-store';
import { editorActions, useEditor } from '@/app/editor-store';
import { useSettings, type ViewMode } from '@/app/settings-store';
import { useUi } from '@/app/ui-store';
import { useAon } from '@/app/aon/chat';
import { goBack, navigate } from '@/app/router';
import { SHORTCUTS } from '@/app/shortcuts';
import { dialogs } from '@/app/dialog-store';
import * as A from '@/app/actions';
import '../editor/setup';
import { Editor, type EditorHandle } from '../editor/Editor';
import { insertTable } from '../editor/commands';
import { runEdit, type EditAction } from '../editor/clipboard';
import { Ribbon } from '../editor/Ribbon';
import { TOOLS, applyBlockStyle, type EditSurface, type ToolContext } from '../editor/tools';
import type { BlockType } from '@/domain/source-edit';
import { baseName } from '@/domain/names';
import { ScrollSync } from './scroll-sync';
import type { RichFocus } from './rich-editing';
import { openMenuAt, type MenuEntry } from '../components/Menu';
import { formatShortcut, useLayout, useTree } from '../hooks';
import { copyPathSubmenu, exportSubmenu } from '../entry-menu';
import { sendDocCommand } from '../doc-commands';
import { Preview, type PreviewHandle } from './Preview';
import { RightPanel } from './RightPanel';
import { DiskStatus, SaveStatus } from './SaveStatus';
import { ShareChip } from '../share/ShareChip';
import { useReadOnly } from '@/app/collab-state';
import { cloudAvailable } from '@/app/cloud';
import { useShares } from '@/app/share';
import { BinaryView } from './BinaryView';
import { formatOf, conversionsFrom } from '@/lib/convert/capabilities';
import { DocxView, PdfView, TextSheetView, XlsxView } from '../lazy-views';

export function DocumentView({ id, anchor }: { id: EntryId; anchor?: string }) {
  const tree = useTree()!;
  const entry = tree.get(id);
  const isOpen = useEditor((s) => s.tabs.includes(id));

  const live = !!entry && entry.kind === 'file' && !tree.isTrashed(id);
  useEffect(() => {
    if (!live) return;
    if (isOpen) editorActions.activate(id);
    else void editorActions.open(id);
  }, [id, live, isOpen]);

  if (!entry || tree.isTrashed(id)) return <MissingDocument trashed={!!entry} />;
  if (entry.kind === 'folder') {
    navigate({ name: 'folder', id }, { replace: true });
    return null;
  }
  const textual = ws().isEditable(entry);
  if (textual) return <TextDocument entry={entry} anchor={anchor} />;
  return <FileDocument entry={entry} />;
}

/** Word, Excel, PDF, images and other files that aren't edited as text. */
function FileDocument({ entry }: { entry: Entry }) {
  const { wide } = useLayout();
  // The docked details panel steps aside while AON's panel is open, so the document keeps its width.
  const aonOpen = useAon((s) => s.open);
  const panelOpen = useUi((s) => s.rightPanelOpen) && !aonOpen;
  const panelWidth = useUi((s) => s.rightPanelWidth);
  const focusMode = useUi((s) => s.focusMode);
  const readingMode = useUi((s) => s.readingMode);
  const [outlineSheet, setOutlineSheet] = useState(false);
  useEffect(() => setOutlineSheet(false), [entry.id]);
  useEffect(() => {
    const onCmd = (e: Event) => {
      if ((e as CustomEvent<string>).detail === 'panel-sheet') setOutlineSheet((v) => !v);
    };
    addEventListener('mydoc:doc-command', onCmd);
    return () => removeEventListener('mydoc:doc-command', onCmd);
  }, []);
  const published = useOutlines((s) => s[entry.id]);
  const outline: DocOutline = published
    ? {
        ...published,
        jump: (i) => {
          setOutlineSheet(false);
          published.jump(i);
        },
      }
    : {
        items: [],
        active: -1,
        noun: 'items',
        empty: 'This file has no outline. Its details are under Info.',
        jump: () => {},
      };
  const format = formatOf(entry.name)?.id;
  const onConvert = () => void dialogs.convert(entry.id);
  const showPanel = panelOpen && wide && !focusMode && !readingMode;
  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <DocHeader
          entry={entry}
          mode="edit"
          setMode={() => {}}
          onOutline={() => setOutlineSheet(true)}
        />
        <div className="min-h-0 flex-1">
          {format === 'xlsx' ? (
            <XlsxView entry={entry} onConvert={onConvert} />
          ) : format === 'docx' ? (
            <DocxView entry={entry} onConvert={onConvert} />
          ) : format === 'pdf' ? (
            <PdfView entry={entry} />
          ) : (
            <BinaryView entry={entry} />
          )}
        </div>
      </div>
      {showPanel && (
        <div
          className="relative shrink-0 border-l border-hairline no-print"
          style={{ width: panelWidth }}
        >
          <PanelResizeHandle />
          <RightPanel
            docId={entry.id}
            outline={outline}
            onClose={() => useUi.getState().setRightPanel(false)}
          />
        </div>
      )}
      {outlineSheet && (
        <OutlineSheet onClose={() => setOutlineSheet(false)}>
          <RightPanel docId={entry.id} outline={outline} onClose={() => setOutlineSheet(false)} />
        </OutlineSheet>
      )}
    </div>
  );
}

function MissingDocument({ trashed }: { trashed: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <FileQuestion size={32} className="text-stone" aria-hidden />
      <h2 className="text-[16px] font-semibold text-ink">
        {trashed ? 'This document is in the Trash' : 'This document no longer exists'}
      </h2>
      <p className="max-w-sm text-caption text-steel">
        {trashed
          ? 'Restore it from the Trash to open it again.'
          : 'It may have been deleted, or the link is out of date.'}
      </p>
      <div className="flex gap-2">
        {trashed && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate({ name: 'trash' })}
          >
            Open Trash
          </button>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => navigate({ name: 'home' })}
        >
          Go home
        </button>
      </div>
    </div>
  );
}

const NO_OUTLINE: TextOutline = { items: [], lines: [], noun: 'headings', empty: '' };

function TextDocument({ entry, anchor }: { entry: Entry; anchor?: string }) {
  const id = entry.id;
  const buffer = useEditor((s) => s.buffers[id]);
  const isMd = isMarkdownName(entry.name);
  const defaultMode = useSettings((s) => s.defaultViewMode);
  const fontSize = useSettings((s) => s.fontSize);
  const editorFont = useSettings((s) => s.editorFont);
  const readingWidth = useSettings((s) => s.readingWidth);
  const showToolbar = useSettings((s) => s.formatToolbar);
  const storedMode = useUi((s) => s.viewModes[id]);
  const focusMode = useUi((s) => s.focusMode);
  const readingMode = useUi((s) => s.readingMode);
  // The docked details panel steps aside while AON's panel is open, so the document keeps its width.
  const aonOpen = useAon((s) => s.open);
  const panelOpen = useUi((s) => s.rightPanelOpen) && !aonOpen;
  const syncScroll = useSettings((s) => s.syncScroll);
  const splitRatio = useUi((s) => s.splitRatio);
  const panelWidth = useUi((s) => s.rightPanelWidth);
  const { wide, phone } = useLayout();
  /** Phones stack the panes; wider screens put them side by side. */
  const stacked = phone;
  const editorRef = useRef<EditorHandle>(null);
  const previewRef = useRef<PreviewHandle>(null);
  const previewScroller = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const [activeLine, setActiveLine] = useState(0);
  const [tick, setTick] = useState(0);
  const tickRaf = useRef(0);
  const bumpTick = useCallback(() => {
    cancelAnimationFrame(tickRaf.current);
    tickRaf.current = requestAnimationFrame(() => setTick((t) => t + 1));
  }, []);
  const [richFocus, setRichFocus] = useState<RichFocus | null>(null);
  const sync = useMemo(
    () =>
      new ScrollSync(
        () => editorRef.current?.view ?? null,
        () =>
          previewRef.current?.element && previewScroller.current
            ? { root: previewRef.current.element, scroller: previewScroller.current }
            : null,
      ),
    [],
  );
  const [progress, setProgress] = useState(0);
  const [outlineSheet, setOutlineSheet] = useState(false);
  // Following a link from the details sheet shows the new document, not the sheet.
  useEffect(() => setOutlineSheet(false), [id]);
  const focusRequest = useEditor((s) => s.focusRequest);
  const sharedReadOnly = useReadOnly(id);

  const delimited = /\.(csv|tsv|tab|unl)$/i.test(entry.name);
  let mode: ViewMode = isMd
    ? (storedMode ?? defaultMode)
    : delimited
      ? (storedMode ?? 'sheet')
      : 'edit';
  if (!isMd && mode !== 'sheet') mode = 'edit';
  if (readingMode && isMd) mode = 'preview';
  const setMode = (m: ViewMode) => useUi.getState().setViewMode(id, m);
  const text = buffer?.text ?? '';
  // Worked out only while the outline can be seen, a beat behind typing.
  const outlineText = useDeferredValue(text);
  const outlineShown = (panelOpen && wide) || outlineSheet;
  const structure = useMemo(
    () => (outlineShown ? textOutline(outlineText, entry.name) : NO_OUTLINE),
    [outlineShown, outlineText, entry.name],
  );
  // A view that knows its own structure (the sheet view's tables or columns) takes over.
  const published = useOutlines((s) => s[id]);

  // After a jump the outline shows the target, even when scrolling lands a little short.
  const jumpLock = useRef(0);
  const followLine = useCallback((line: number) => {
    if (Date.now() >= jumpLock.current) setActiveLine(line);
  }, []);
  const jumpTo = useCallback(
    (line: number) => {
      setOutlineSheet(false);
      setActiveLine(line);
      jumpLock.current = Date.now() + 900;
      if (mode === 'sheet') {
        // The sheet view has no lines to scroll to: read the document there instead.
        setMode('preview');
        setTimeout(() => previewRef.current?.scrollToLine(line), 60);
        return;
      }
      if (mode === 'split') {
        // The editor leads; the preview follows through scroll sync (or directly if it's off).
        sync.authority = 'editor';
        editorRef.current?.scrollToLine(line);
        if (!syncScroll) previewRef.current?.scrollToLine(line);
      } else if (mode === 'edit') editorRef.current?.scrollToLine(line);
      else previewRef.current?.scrollToLine(line, true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, sync, syncScroll],
  );

  // Two-way scroll sync in split view.
  const bufferReady = !!buffer && buffer.status !== 'loading' && buffer.status !== 'load-error';
  useEffect(() => {
    sync.enabled = syncScroll;
    if (mode !== 'split' || !bufferReady) {
      sync.disconnect();
      return;
    }
    sync.connect();
    sync.invalidate();
    return () => sync.disconnect();
  }, [mode, id, sync, syncScroll, bufferReady]);

  // Deep links to a heading (#/doc/id?h=slug).
  useEffect(() => {
    if (!anchor || !buffer || buffer.status === 'loading' || buffer.status === 'load-error') return;
    const h = extractHeadings(buffer.text).find((x) => x.slug === anchor);
    const t = setTimeout(() => {
      if (mode === 'edit' || mode === 'split') {
        if (h) editorRef.current?.scrollToLine(h.line);
      } else previewRef.current?.scrollToSlug(anchor);
    }, 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, id, buffer?.status]);

  // Move focus into the document when asked (new documents, quick open, search results).
  // Deferred a frame so it lands on the editor that ends up mounted.
  useEffect(() => {
    if (focusRequest?.id !== id || !bufferReady) return;
    // Focus right away so early keystrokes land in the editor, then finish a frame later.
    const hasEditor = mode === 'edit' || mode === 'split';
    if (hasEditor) editorRef.current?.focus();
    const raf = requestAnimationFrame(() => {
      const req = editorActions.takeFocusRequest(id);
      if (!req) return;
      if (hasEditor) {
        editorRef.current?.focus({ find: req.find, end: req.end });
        return;
      }
      const match = req.find ? findFirstMatch(buffer.text, req.find) : null;
      if (match) {
        const line = buffer.text.slice(0, match.from).split('\n').length - 1;
        previewRef.current?.scrollToLine(line, true);
      }
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest, id, buffer?.status, bufferReady, mode]);

  // Listen for "find" and "toggle mode" commands sent from the shell/palette.
  useEffect(() => {
    const onCmd = (e: Event) => {
      const cmd = (e as CustomEvent<string>).detail;
      if (cmd === 'find') {
        if (mode === 'preview' || mode === 'rich') setMode('edit');
        setTimeout(() => editorRef.current?.openSearch(), 0);
      } else if (cmd === 'toggle-mode' && isMd) setMode(mode === 'edit' ? 'preview' : 'edit');
      else if (cmd === 'rich' && isMd) setMode(mode === 'rich' ? 'edit' : 'rich');
      else if (cmd === 'sync-scroll') useSettings.getState().update({ syncScroll: !syncScroll });
      else if (cmd.startsWith('edit:'))
        void runEdit(editorRef.current?.view ?? null, cmd.slice(5) as EditAction);
      else if (cmd.startsWith('tool:')) {
        const tool = TOOLS.find((t) => t.id === cmd.slice(5));
        if (tool && tool.when(toolCtx) && !tool.disabled?.(toolCtx)) tool.run(toolCtx);
      } else if (cmd.startsWith('style:')) applyBlockStyle(toolCtx, cmd.slice(6) as BlockType);
      else if (cmd === 'split' && isMd) setMode(mode === 'split' ? 'edit' : 'split');
      else if (cmd === 'focus-editor') editorRef.current?.focus();
      else if (cmd === 'panel-sheet' && !readingMode) setOutlineSheet((v) => !v);
      else if (cmd === 'insert-table' && isMd) {
        if (mode === 'preview' || mode === 'rich') setMode('edit');
        setTimeout(() => {
          const view = editorRef.current?.view;
          if (view) insertTable(view);
        }, 0);
      }
    };
    addEventListener('mydoc:doc-command', onCmd);
    return () => removeEventListener('mydoc:doc-command', onCmd);
  });

  const onPreviewScroll = (line: number) => {
    if (mode !== 'edit') followLine(line);
  };

  const surface: EditSurface | null =
    mode === 'edit' || mode === 'split' ? 'source' : mode === 'rich' ? 'rich' : null;
  const toolCtx: ToolContext = {
    docId: id,
    kind: isMd ? 'markdown' : 'text',
    surface: surface ?? 'source',
    view: surface === 'source' ? (editorRef.current?.view ?? null) : null,
    rich: surface === 'rich' ? (previewRef.current?.rich ?? null) : null,
    richFocus,
  };
  const showRibbon = !!surface && showToolbar && !focusMode && (isMd || mode === 'edit');

  if (!buffer || buffer.status === 'loading') {
    return (
      <div className="flex h-full flex-col">
        <DocHeader entry={entry} mode={mode} setMode={setMode} />
        <div
          className="mx-auto w-full max-w-[760px] space-y-3 px-6 py-10"
          aria-busy="true"
          aria-label="Loading document"
        >
          <div className="skeleton h-8 w-2/3" />
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-5/6" />
          <div className="skeleton h-4 w-4/6" />
        </div>
      </div>
    );
  }

  if (buffer.status === 'load-error') {
    return (
      <div className="flex h-full flex-col">
        <DocHeader entry={entry} mode={mode} setMode={setMode} />
        <div className="m-auto max-w-md px-6 py-10 text-center" role="alert">
          <AlertCircle className="mx-auto mb-3 text-warning" size={28} aria-hidden />
          <h2 className="text-lg font-semibold">This document could not be opened</h2>
          <p className="mt-2 text-sm text-steel">
            Editing is paused to protect the saved document. Try opening it again.
          </p>
          <button
            type="button"
            className="btn btn-primary mt-5"
            onClick={() => void editorActions.retryLoad(id)}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  // Full width: the column fills the pane, keeping only a small margin.
  const widthPx = { narrow: 640, normal: 760, wide: 980, full: null }[readingWidth];
  const showPanel = panelOpen && wide && !focusMode && !readingMode;
  let active = -1;
  for (let i = 0; i < structure.lines.length; i++)
    if (structure.lines[i]! <= activeLine) active = i;
  const outline: DocOutline = published ?? {
    items: structure.items,
    active,
    noun: structure.noun,
    summary: structure.summary,
    empty: structure.empty,
    jump: (i) => {
      const line = structure.lines[i];
      if (line !== undefined) jumpTo(line);
    },
  };
  const editorStyle = {
    '--editor-size': `${fontSize - (editorFont === 'mono' ? 1 : 0)}px`,
    '--editor-font': editorFont === 'mono' ? 'var(--font-mono)' : 'var(--font-sans)',
    '--editor-line-height': editorFont === 'mono' ? 1.65 : 1.75,
    '--editor-max': mode === 'split' || widthPx === null ? '100%' : `${widthPx + 60}px`,
  } as React.CSSProperties;

  const preview = (
    <div
      ref={previewScroller}
      className={`scroll-area min-w-0 flex-1 print-source ${stacked ? 'min-h-0 w-full' : 'h-full'}`}
      data-testid="preview-pane"
      onScroll={
        readingMode
          ? (e) => {
              const el = e.currentTarget;
              setProgress(
                el.scrollHeight > el.clientHeight
                  ? el.scrollTop / (el.scrollHeight - el.clientHeight)
                  : 1,
              );
            }
          : undefined
      }
    >
      <div
        className="mx-auto px-4 pt-8 pb-[30vh] sm:px-8 sm:pt-12"
        style={{ maxWidth: widthPx === null ? undefined : widthPx + 64 }}
      >
        {mode === 'rich' && !text.trim() && (
          <button
            type="button"
            className="mb-4 text-[15px] text-stone hover:text-steel"
            onClick={() => {
              editorActions.edit(id, {
                changes: { from: 0, insert: '# ' + baseName(entry.name) + '\n' },
              });
            }}
          >
            This document is empty. Click to add a title, or switch to Source to write Markdown.
          </button>
        )}
        <Preview
          ref={previewRef}
          docId={id}
          text={text}
          className=""
          rich={mode === 'rich'}
          onRichFocus={(f) => {
            setRichFocus(f);
            bumpTick();
          }}
          onVisibleLine={onPreviewScroll}
          onToggleTask={(line) => {
            const next = toggleTaskAt(text, line);
            // One transaction on the document model, so it is undoable from any mode.
            const from = lineStart(text, line);
            const to = text.indexOf('\n', from);
            editorActions.edit(id, {
              changes: {
                from,
                to: to < 0 ? text.length : to,
                insert: next.split('\n')[line] ?? '',
              },
              userEvent: 'input.toggle',
            });
          }}
        />
        <style>{`.prose{--prose-size:${fontSize}px}`}</style>
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {readingMode && (
          <div className="h-0.5 w-full bg-transparent" aria-hidden>
            <div
              className="h-full bg-primary transition-[width] duration-75"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        )}
        <DocHeader
          entry={entry}
          mode={mode}
          setMode={setMode}
          onOutline={() => setOutlineSheet(true)}
        />
        {showRibbon && mode !== 'sheet' && <Ribbon ctx={toolCtx} tick={tick} />}
        {mode === 'sheet' ? (
          <div className="min-h-0 flex-1">
            <TextSheetView
              docId={id}
              name={entry.name}
              text={text}
              onConvert={() => void dialogs.convert(id, 'xlsx')}
            />
          </div>
        ) : (
          <div
            ref={splitRef}
            className={`flex min-h-0 flex-1 ${stacked ? 'flex-col' : ''}`}
            style={editorStyle}
          >
            {(mode === 'edit' || mode === 'split') && (
              <div
                className={`flex min-w-0 flex-col ${stacked && mode === 'split' ? 'min-h-0 w-full' : 'h-full'}`}
                style={mode === 'split' ? { flex: `0 0 ${splitRatio * 100}%` } : { flex: '1 1 0%' }}
              >
                <div className="min-h-0 flex-1">
                  <Editor
                    ref={editorRef}
                    docId={id}
                    name={entry.name}
                    text={text}
                    readOnly={sharedReadOnly}
                    onUpdate={bumpTick}
                    onScrollLine={(line) => {
                      if (mode === 'edit') followLine(line);
                    }}
                  />
                </div>
              </div>
            )}
            {mode === 'split' && (
              <SplitHandle
                vertical={stacked}
                ratio={splitRatio}
                containerRef={splitRef}
                onChange={(r) => {
                  useUi.getState().setSplitRatio(r);
                  sync.invalidate();
                }}
              />
            )}
            {mode !== 'edit' && preview}
          </div>
        )}
      </div>
      {showPanel && (
        <div
          className="relative shrink-0 border-l border-hairline no-print"
          style={{ width: panelWidth }}
        >
          <PanelResizeHandle />
          <RightPanel
            docId={id}
            text={text}
            outline={outline}
            onClose={() => useUi.getState().setRightPanel(false)}
          />
        </div>
      )}
      {outlineSheet && (
        <OutlineSheet onClose={() => setOutlineSheet(false)}>
          <RightPanel
            docId={id}
            text={text}
            outline={outline}
            onClose={() => setOutlineSheet(false)}
          />
        </OutlineSheet>
      )}
    </div>
  );
}

/** Draggable divider between the source and preview panes (also arrow keys). */
function SplitHandle({
  ratio,
  containerRef,
  onChange,
  vertical = false,
}: {
  ratio: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onChange(r: number): void;
  /** Panes are stacked: the divider is horizontal and moves up and down. */
  vertical?: boolean;
}) {
  const clamp = (r: number) => Math.min(0.8, Math.max(0.2, r));
  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'horizontal' : 'vertical'}
      aria-label="Resize source and preview"
      aria-valuemin={20}
      aria-valuemax={80}
      aria-valuenow={Math.round(ratio * 100)}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      className={`group relative z-10 shrink-0 touch-none no-print ${
        vertical ? '-my-2 h-5 cursor-row-resize' : '-mx-1 w-2 cursor-col-resize'
      }`}
      onDoubleClick={() => onChange(0.5)}
      onKeyDown={(e) => {
        const [less, more] = vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
        if (e.key === less) onChange(clamp(ratio - 0.05));
        else if (e.key === more) onChange(clamp(ratio + 0.05));
        else return;
        e.preventDefault();
      }}
      onPointerDown={(e) => {
        const box = containerRef.current?.getBoundingClientRect();
        if (!box) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) =>
          onChange(
            clamp(
              vertical ? (ev.clientY - box.top) / box.height : (ev.clientX - box.left) / box.width,
            ),
          );
        const up = () => {
          removeEventListener('pointermove', move);
          removeEventListener('pointerup', up);
        };
        addEventListener('pointermove', move);
        addEventListener('pointerup', up);
      }}
    >
      <div
        className={
          vertical
            ? 'absolute inset-x-0 top-1/2 h-px bg-hairline group-hover:bg-primary group-focus-visible:bg-primary'
            : 'mx-auto h-full w-px bg-hairline group-hover:bg-primary group-focus-visible:bg-primary'
        }
      />
    </div>
  );
}

/** Drag the side panel's left edge to resize it. */
function PanelResizeHandle() {
  const width = useUi((s) => s.rightPanelWidth);
  const clamp = (w: number) => Math.min(480, Math.max(220, Math.round(w)));
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize side panel"
      aria-valuemin={220}
      aria-valuemax={480}
      aria-valuenow={width}
      tabIndex={0}
      className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none hover:bg-[color-mix(in_srgb,var(--primary)_25%,transparent)] focus-visible:bg-[color-mix(in_srgb,var(--primary)_25%,transparent)]"
      onDoubleClick={() => useUi.getState().setRightPanelWidth(272)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') useUi.getState().setRightPanelWidth(clamp(width + 16));
        else if (e.key === 'ArrowRight') useUi.getState().setRightPanelWidth(clamp(width - 16));
        else return;
        e.preventDefault();
      }}
      onPointerDown={(e) => {
        const startX = e.clientX;
        const startW = width;
        e.currentTarget.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) =>
          useUi.getState().setRightPanelWidth(clamp(startW + (startX - ev.clientX)));
        const up = () => {
          removeEventListener('pointermove', move);
          removeEventListener('pointerup', up);
        };
        addEventListener('pointermove', move);
        addEventListener('pointerup', up);
      }}
    />
  );
}

function OutlineSheet({ children, onClose }: { children: React.ReactNode; onClose(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-[var(--scrim)]" aria-hidden />
      <div
        role="dialog"
        aria-label="Document details"
        aria-modal="true"
        className="animate-in safe-bottom relative flex h-full w-[min(340px,88vw)] flex-col bg-canvas shadow-3"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function DocHeader({
  entry,
  mode,
  setMode,
  onOutline,
}: {
  entry: Entry;
  mode: ViewMode;
  setMode(m: ViewMode): void;
  onOutline?: () => void;
}) {
  const tree = useTree()!;
  const { phone, wide } = useLayout();
  const focusMode = useUi((s) => s.focusMode);
  const readingMode = useUi((s) => s.readingMode);
  // The docked details panel steps aside while AON's panel is open, so the document keeps its width.
  const aonOpen = useAon((s) => s.open);
  const panelOpen = useUi((s) => s.rightPanelOpen) && !aonOpen;
  const isMd = isMarkdownName(entry.name);
  const textual = ws().isEditable(entry);
  const ancestors = tree.ancestors(entry.id);
  const shared = useShares((s) => !!s.bindings[entry.id]);
  const delimited = /\.(csv|tsv|tab|unl)$/i.test(entry.name);
  const format = formatOf(entry.name)?.id;
  const canConvert = !!format && conversionsFrom(format).length > 0;
  const hasTables = useEditor((s) =>
    isMd ? /^\s*\|?.*\|.*\n\s*\|?\s*:?-+:?\s*\|/m.test(s.buffers[entry.id]?.text ?? '') : false,
  );

  const menu: MenuEntry[] = [
    {
      label: 'Reveal in Files',
      icon: <LocateFixed />,
      onSelect: () => A.revealInFiles(entry.id),
    },
    { label: 'Copy path', icon: <Link2 />, submenu: copyPathSubmenu(entry) },
    'separator',
    { label: 'Rename…', icon: <PencilLine />, onSelect: () => void A.renameEntry(entry.id) },
    { label: 'Move to…', icon: <FolderInput />, onSelect: () => void A.moveEntries([entry.id]) },
    { label: 'Duplicate', icon: <Copy />, onSelect: () => void A.duplicateEntry(entry.id) },
    ...(textual && cloudAvailable
      ? ([
          { label: 'Share…', icon: <Users />, onSelect: () => void dialogs.share(entry.id) },
          ...(shared
            ? [
                {
                  label: 'Shared history…',
                  icon: <History />,
                  onSelect: () => void dialogs.shareHistory(entry.id),
                },
              ]
            : []),
        ] as MenuEntry[])
      : []),
    ...(isMd
      ? ([
          { label: 'Add tag…', icon: <Tag />, onSelect: () => void A.addTagTo(entry.id) },
          {
            label: 'Version history',
            icon: <History />,
            onSelect: () => void dialogs.history(entry.id),
          },
        ] as MenuEntry[])
      : []),
    ...(textual
      ? ([
          {
            label: 'Find and replace',
            icon: <Search />,
            shortcut: SHORTCUTS.find,
            onSelect: () => sendDocCommand('find'),
          },
        ] as MenuEntry[])
      : []),
    ...(canConvert
      ? ([
          {
            label: 'Convert or export…',
            icon: <FileOutput />,
            onSelect: () => void dialogs.convert(entry.id),
          },
        ] as MenuEntry[])
      : []),
    ...(!isMd && (format === 'xlsx' || textual)
      ? ([
          {
            label: 'Version history',
            icon: <History />,
            onSelect: () => void dialogs.history(entry.id),
          },
        ] as MenuEntry[])
      : []),
    { label: 'Export', icon: <Download />, submenu: exportSubmenu(entry) },
    'separator',
    ...(textual
      ? ([
          {
            label: focusMode ? 'Exit focus mode' : 'Focus mode',
            icon: <Focus />,
            shortcut: SHORTCUTS.focusMode,
            onSelect: () => useUi.getState().setFocusMode(!focusMode),
          },
          ...(isMd
            ? [
                {
                  label: readingMode ? 'Exit reading mode' : 'Reading mode',
                  icon: <BookOpen />,
                  shortcut: SHORTCUTS.readingMode,
                  onSelect: () => useUi.getState().setReadingMode(!readingMode),
                },
              ]
            : []),
          'separator',
        ] as MenuEntry[])
      : []),
    {
      label: 'Move to Trash',
      icon: <Trash2 />,
      danger: true,
      onSelect: () => void A.trashEntries([entry.id]),
    },
  ];

  if (focusMode) {
    return (
      <div className="flex h-11 shrink-0 items-center justify-end gap-2 px-3 no-print">
        <SaveStatus id={entry.id} />
        <DiskStatus id={entry.id} />
        <button
          type="button"
          className="btn btn-ghost h-8 text-steel"
          onClick={() => useUi.getState().setFocusMode(false)}
        >
          <Minimize2 size={15} aria-hidden /> Exit focus
        </button>
      </div>
    );
  }

  return (
    <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-1 px-2 py-1 md:flex-nowrap sm:px-3 md:py-0 no-print">
      {phone && (
        <button
          type="button"
          className="icon-btn"
          aria-label="Back"
          onClick={() => goBack() || navigate({ name: 'home' })}
        >
          <ArrowLeft size={18} />
        </button>
      )}
      {readingMode &&
        (phone ? (
          <button
            type="button"
            className="icon-btn"
            aria-label="Exit reading"
            title="Exit reading"
            onClick={() => useUi.getState().setReadingMode(false)}
          >
            <BookOpenCheck size={18} />
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-ghost h-8 text-steel"
            onClick={() => useUi.getState().setReadingMode(false)}
          >
            <ArrowLeft size={15} aria-hidden /> Exit reading
          </button>
        ))}
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-0.5 text-[14px]">
        {!phone && ancestors.length > 3 && (
          <span className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-steel hover:bg-hover hover:text-ink"
              title={ancestors
                .slice(0, -3)
                .map((a) => a.name)
                .join(' / ')}
              aria-label={`Open ${ancestors[ancestors.length - 4]!.name}`}
              onClick={() => navigate({ name: 'folder', id: ancestors[ancestors.length - 4]!.id })}
            >
              …
            </button>
            <ChevronRight size={13} className="shrink-0 text-muted" aria-hidden />
          </span>
        )}
        {!phone &&
          ancestors.slice(-3).map((a) => (
            <span key={a.id} className="flex min-w-0 shrink items-center gap-0.5">
              <button
                type="button"
                className="max-w-[160px] truncate rounded px-1.5 py-0.5 text-steel hover:bg-hover hover:text-ink"
                title={a.name}
                onClick={() => navigate({ name: 'folder', id: a.id })}
              >
                {a.name}
              </button>
              <ChevronRight size={13} className="shrink-0 text-muted" aria-hidden />
            </span>
          ))}
        <button
          type="button"
          className="min-w-0 truncate rounded px-1.5 py-0.5 font-medium text-ink hover:bg-hover"
          title={`${tree.pathOf(entry.id)} (click to rename)`}
          onClick={() => void A.renameEntry(entry.id)}
        >
          {entry.name}
        </button>
      </nav>
      {textual && <ShareChip id={entry.id} />}
      {textual && <SaveStatus id={entry.id} />}
      <DiskStatus id={entry.id} />
      {isMd && !readingMode && (
        <div
          role="group"
          aria-label="View mode"
          className="document-modes ml-1 flex items-center rounded-md bg-surface p-0.5 max-md:order-1 max-md:ml-0 max-md:w-full max-md:justify-center"
        >
          <ModeButton
            label="Source"
            hint="Edit the Markdown source"
            active={mode === 'edit'}
            onClick={() => setMode('edit')}
            icon={<FileCode2 size={14} />}
            shortcut={SHORTCUTS.toggleMode}
          />
          <ModeButton
            label="Split"
            hint={phone ? 'Source above, preview below' : 'Source and preview side by side'}
            active={mode === 'split'}
            onClick={() => setMode('split')}
            icon={<Columns2 size={14} className={phone ? 'rotate-90' : ''} />}
            shortcut={SHORTCUTS.splitView}
          />
          <ModeButton
            label="Rich"
            hint="Edit the formatted document directly"
            active={mode === 'rich'}
            onClick={() => setMode('rich')}
            icon={<PencilLine size={14} />}
            shortcut={SHORTCUTS.richMode}
          />
          <ModeButton
            label="Read"
            hint="Read without editing"
            active={mode === 'preview'}
            onClick={() => setMode('preview')}
            icon={<Eye size={14} />}
            shortcut={SHORTCUTS.toggleMode}
          />
          {hasTables && (
            <ModeButton
              label="Sheet"
              hint="Edit this document's tables as a spreadsheet"
              active={mode === 'sheet'}
              onClick={() => setMode('sheet')}
              icon={<Table2 size={14} />}
            />
          )}
        </div>
      )}
      {delimited && (
        <div
          role="group"
          aria-label="View mode"
          className="document-modes ml-1 flex items-center rounded-md bg-surface p-0.5 max-md:order-1 max-md:ml-0 max-md:w-full max-md:justify-center"
        >
          <ModeButton
            label="Sheet"
            hint="Edit as a spreadsheet"
            active={mode === 'sheet'}
            onClick={() => setMode('sheet')}
            icon={<Table2 size={14} />}
          />
          <ModeButton
            label="Text"
            hint="Edit the raw text"
            active={mode !== 'sheet'}
            onClick={() => setMode('edit')}
            icon={<FileText size={14} />}
          />
        </div>
      )}
      {canConvert && !readingMode && !phone && (
        <button
          type="button"
          className="btn btn-ghost h-8 shrink-0 px-2 text-steel"
          title="Convert to another format, or export a copy"
          onClick={() => void dialogs.convert(entry.id)}
        >
          <FileOutput size={15} aria-hidden /> Convert
        </button>
      )}
      {isMd && mode === 'split' && !readingMode && <SyncScrollButton />}
      <button
        type="button"
        className="icon-btn"
        aria-pressed={!!entry.favorite}
        aria-label={entry.favorite ? 'Remove from favorites' : 'Add to favorites'}
        title={entry.favorite ? 'Remove from favorites' : 'Add to favorites'}
        onClick={() => void A.toggleFavorite(entry.id)}
      >
        <Star size={16} className={entry.favorite ? 'fill-[#f5c84c] text-[#e0a800]' : ''} />
      </button>
      {readingMode && !phone && <FullscreenButton />}
      {!wide && onOutline && (
        <button
          type="button"
          className="icon-btn"
          aria-label="Document details"
          title="Outline, links and info"
          onClick={onOutline}
        >
          <PanelRight size={16} />
        </button>
      )}
      {wide && !readingMode && (
        <button
          type="button"
          className="icon-btn"
          aria-pressed={panelOpen}
          aria-label="Toggle side panel"
          title={`Side panel (${formatShortcut(SHORTCUTS.togglePanel)})`}
          onClick={() => useUi.getState().setRightPanel(!panelOpen)}
        >
          <PanelRight size={16} />
        </button>
      )}
      <button
        type="button"
        className="icon-btn"
        aria-label="More actions"
        aria-haspopup="menu"
        title="More actions"
        onClick={(e) => openMenuAt(e.currentTarget, menu, entry.name)}
      >
        <MoreHorizontal size={16} />
      </button>
    </header>
  );
}

function SyncScrollButton() {
  const on = useSettings((s) => s.syncScroll);
  return (
    <button
      type="button"
      className="icon-btn"
      aria-pressed={on}
      aria-label="Sync scrolling"
      title={
        on
          ? 'Scrolling is synced between source and preview'
          : 'Scroll source and preview separately'
      }
      onClick={() => useSettings.getState().update({ syncScroll: !on })}
    >
      {on ? <Link2 size={16} /> : <Link2Off size={16} />}
    </button>
  );
}

function ModeButton({
  label,
  hint,
  active,
  onClick,
  icon,
  shortcut,
}: {
  label: string;
  hint: string;
  active: boolean;
  onClick(): void;
  icon: React.ReactNode;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={shortcut ? `${hint} (${formatShortcut(shortcut)})` : hint}
      className={`tap flex h-7 items-center gap-1.5 rounded-[5px] px-2 text-caption font-medium ${active ? 'bg-canvas text-ink shadow-1' : 'text-steel hover:text-ink'}`}
      onClick={onClick}
    >
      {icon}
      <span className="md:hidden lg:inline">{label}</span>
      <span className="sr-only hidden md:inline lg:hidden">{label}</span>
    </button>
  );
}

function FullscreenButton() {
  const [full, setFull] = useState(!!document.fullscreenElement);
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  if (!document.fullscreenEnabled) return null;
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={full ? 'Exit full screen' : 'Full screen'}
      onClick={() =>
        full ? void document.exitFullscreen() : void document.documentElement.requestFullscreen()
      }
    >
      {full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
    </button>
  );
}

/** Offset of the start of 0-based `line`. */
function lineStart(text: string, line: number): number {
  let pos = 0;
  for (let i = 0; i < line; i++) {
    const nl = text.indexOf('\n', pos);
    if (nl < 0) return text.length;
    pos = nl + 1;
  }
  return pos;
}
