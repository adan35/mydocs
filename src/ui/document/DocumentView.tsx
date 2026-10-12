import { useCallback, useEffect, useRef, useState } from 'react';
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
} from 'lucide-react';
import type { Entry, EntryId } from '@/domain/types';
import { isMarkdownName } from '@/domain/names';
import { extractHeadings } from '@/domain/outline';
import { toggleTaskAt } from '@/domain/tasks';
import { findFirstMatch } from '@/app/search';
import { ws } from '@/app/app-store';
import { editorActions, useEditor } from '@/app/editor-store';
import { useSettings, type ViewMode } from '@/app/settings-store';
import { useUi } from '@/app/ui-store';
import { navigate } from '@/app/router';
import { SHORTCUTS } from '@/app/shortcuts';
import { dialogs } from '@/app/dialog-store';
import * as A from '@/app/actions';
import '../editor/setup';
import { Editor, type EditorHandle } from '../editor/Editor';
import { FormatToolbar } from '../editor/FormatToolbar';
import { insertTable } from '../editor/commands';
import { openMenuAt, type MenuEntry } from '../components/Menu';
import { formatShortcut, useLayout, useTree } from '../hooks';
import { exportSubmenu } from '../entry-menu';
import { sendDocCommand } from '../doc-commands';
import { Preview, type PreviewHandle } from './Preview';
import { RightPanel } from './RightPanel';
import { DiskStatus, SaveStatus } from './SaveStatus';
import { BinaryView } from './BinaryView';

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
  return textual ? (
    <TextDocument entry={entry} anchor={anchor} />
  ) : (
    <div className="flex h-full min-h-0 flex-col">
      <DocHeader entry={entry} mode="edit" setMode={() => {}} />
      <div className="min-h-0 flex-1">
        <BinaryView entry={entry} />
      </div>
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
  const panelOpen = useUi((s) => s.rightPanelOpen);
  const { wide, desktop } = useLayout();
  const editorRef = useRef<EditorHandle>(null);
  const previewRef = useRef<PreviewHandle>(null);
  const [activeLine, setActiveLine] = useState(0);
  const [progress, setProgress] = useState(0);
  const [outlineSheet, setOutlineSheet] = useState(false);
  // Following a link from the details sheet shows the new document, not the sheet.
  useEffect(() => setOutlineSheet(false), [id]);
  const focusRequest = useEditor((s) => s.focusRequest);

  let mode: ViewMode = isMd ? (storedMode ?? defaultMode) : 'edit';
  if (mode === 'split' && !desktop) mode = 'edit';
  if (readingMode && isMd) mode = 'preview';
  const setMode = (m: ViewMode) => useUi.getState().setViewMode(id, m);
  const text = buffer?.text ?? '';

  const jumpTo = useCallback(
    (line: number) => {
      setOutlineSheet(false);
      if (mode === 'edit') editorRef.current?.scrollToLine(line);
      else previewRef.current?.scrollToLine(line, true);
      if (mode === 'split') editorRef.current?.scrollToLine(line);
    },
    [mode],
  );

  // Deep links to a heading (#/doc/id?h=slug).
  useEffect(() => {
    if (!anchor || buffer?.status === 'loading' || !buffer) return;
    const h = extractHeadings(buffer.text).find((x) => x.slug === anchor);
    const t = setTimeout(() => {
      if (mode === 'edit') {
        if (h) editorRef.current?.scrollToLine(h.line);
      } else previewRef.current?.scrollToSlug(anchor);
    }, 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, id, buffer?.status]);

  // Move focus into the document when asked (new documents, quick open, search results).
  // Deferred a frame so it lands on the editor that ends up mounted.
  useEffect(() => {
    if (focusRequest?.id !== id || !buffer || buffer.status === 'loading') return;
    // Focus right away so early keystrokes land in the editor, then finish a frame later.
    if (mode !== 'preview') editorRef.current?.focus();
    const raf = requestAnimationFrame(() => {
      const req = editorActions.takeFocusRequest(id);
      if (!req) return;
      if (mode !== 'preview') {
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
  }, [focusRequest, id, buffer?.status, mode]);

  // Listen for "find" and "toggle mode" commands sent from the shell/palette.
  useEffect(() => {
    const onCmd = (e: Event) => {
      const cmd = (e as CustomEvent<string>).detail;
      if (cmd === 'find') {
        if (mode === 'preview') setMode('edit');
        setTimeout(() => editorRef.current?.openSearch(), 0);
      } else if (cmd === 'toggle-mode' && isMd) setMode(mode === 'edit' ? 'preview' : 'edit');
      else if (cmd === 'split' && isMd && desktop) setMode(mode === 'split' ? 'edit' : 'split');
      else if (cmd === 'focus-editor') editorRef.current?.focus();
      else if (cmd === 'panel-sheet' && isMd && !readingMode) setOutlineSheet((v) => !v);
      else if (cmd === 'insert-table' && isMd) {
        if (mode === 'preview') setMode('edit');
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
    if (mode !== 'edit') setActiveLine(line);
  };

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

  const widthPx = { narrow: 640, normal: 760, wide: 980 }[readingWidth];
  const showPanel = isMd && panelOpen && wide && !focusMode && !readingMode;
  const editorStyle = {
    '--editor-size': `${fontSize - (editorFont === 'mono' ? 1 : 0)}px`,
    '--editor-font': editorFont === 'mono' ? 'var(--font-mono)' : 'var(--font-sans)',
    '--editor-line-height': editorFont === 'mono' ? 1.65 : 1.75,
    '--editor-max': mode === 'split' ? '100%' : `${widthPx + 60}px`,
  } as React.CSSProperties;

  const preview = (
    <div
      className="scroll-area h-full min-w-0 flex-1 print-source"
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
        className="mx-auto px-5 pt-8 pb-[30vh] sm:px-10 sm:pt-12"
        style={{ maxWidth: widthPx + 80 }}
      >
        <Preview
          ref={previewRef}
          docId={id}
          text={text}
          className=""
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
        <div className="flex min-h-0 flex-1" style={editorStyle}>
          {mode !== 'preview' && (
            <div
              className={`flex h-full min-w-0 flex-1 flex-col ${mode === 'split' ? 'border-r border-hairline' : ''}`}
            >
              {isMd && showToolbar && !focusMode && (
                <FormatToolbar getView={() => editorRef.current?.view ?? null} />
              )}
              <div className="min-h-0 flex-1">
                <Editor
                  ref={editorRef}
                  docId={id}
                  name={entry.name}
                  text={text}
                  onScrollLine={(line) => {
                    if (mode === 'edit') setActiveLine(line);
                    if (mode === 'split') previewRef.current?.scrollToLine(line);
                  }}
                />
              </div>
            </div>
          )}
          {mode !== 'edit' && preview}
        </div>
      </div>
      {showPanel && (
        <div className="w-[272px] shrink-0 border-l border-hairline no-print">
          <RightPanel
            docId={id}
            text={text}
            activeLine={activeLine}
            onJump={jumpTo}
            onClose={() => useUi.getState().setRightPanel(false)}
          />
        </div>
      )}
      {outlineSheet && (
        <OutlineSheet onClose={() => setOutlineSheet(false)}>
          <RightPanel
            docId={id}
            text={text}
            activeLine={activeLine}
            onJump={jumpTo}
            onClose={() => setOutlineSheet(false)}
          />
        </OutlineSheet>
      )}
    </div>
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
  const { phone, wide, desktop } = useLayout();
  const focusMode = useUi((s) => s.focusMode);
  const readingMode = useUi((s) => s.readingMode);
  const panelOpen = useUi((s) => s.rightPanelOpen);
  const isMd = isMarkdownName(entry.name);
  const textual = ws().isEditable(entry);
  const ancestors = tree.ancestors(entry.id);

  const menu: MenuEntry[] = [
    { label: 'Rename…', icon: <PencilLine />, onSelect: () => void A.renameEntry(entry.id) },
    { label: 'Move to…', icon: <FolderInput />, onSelect: () => void A.moveEntries([entry.id]) },
    { label: 'Duplicate', icon: <Copy />, onSelect: () => void A.duplicateEntry(entry.id) },
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
    <header className="flex h-12 shrink-0 items-center gap-1 px-2 sm:px-3 no-print">
      {phone && (
        <button
          type="button"
          className="icon-btn"
          aria-label="Back"
          onClick={() => (history.length > 1 ? history.back() : navigate({ name: 'home' }))}
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
      {textual && <SaveStatus id={entry.id} />}
      {textual && <DiskStatus id={entry.id} />}
      {isMd && !readingMode && (
        <div
          role="group"
          aria-label="View mode"
          className="ml-1 flex items-center rounded-md bg-surface p-0.5"
        >
          <ModeButton
            label="Edit"
            active={mode === 'edit'}
            onClick={() => setMode('edit')}
            icon={<PencilLine size={14} />}
            shortcut={SHORTCUTS.toggleMode}
          />
          {desktop && (
            <ModeButton
              label="Split"
              active={mode === 'split'}
              onClick={() => setMode('split')}
              icon={<Columns2 size={14} />}
              shortcut={SHORTCUTS.splitView}
            />
          )}
          <ModeButton
            label="Preview"
            active={mode === 'preview'}
            onClick={() => setMode('preview')}
            icon={<Eye size={14} />}
            shortcut={SHORTCUTS.toggleMode}
          />
        </div>
      )}
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
      {isMd && !wide && onOutline && (
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
      {isMd && wide && !readingMode && (
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

function ModeButton({
  label,
  active,
  onClick,
  icon,
  shortcut,
}: {
  label: string;
  active: boolean;
  onClick(): void;
  icon: React.ReactNode;
  shortcut: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={`${label} (${formatShortcut(shortcut)})`}
      className={`tap flex h-7 items-center gap-1.5 rounded-[5px] px-2 text-caption font-medium ${active ? 'bg-canvas text-ink shadow-1' : 'text-steel hover:text-ink'}`}
      onClick={onClick}
    >
      {icon}
      <span className="hidden lg:inline">{label}</span>
      <span className="sr-only lg:hidden">{label}</span>
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
