import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { EntryId } from '@/domain/types';
import type { InlineSource, RenderResult } from '@/lib/markdown/render';
import { renderInlineMarkdown } from '@/lib/markdown/render';
import {
  caretOffset,
  escapeText,
  serializeInline,
  setCaretOffset,
  type SerializeOptions,
} from '@/lib/markdown/rich';
import {
  afterBlock,
  blockTypeOf,
  deleteBlock,
  fenceBody,
  layoutInline,
  lineStarts,
  locateInline,
  mergeInlineEdit,
  moveBlock,
  setBlockType,
  type BlockType,
} from '@/domain/source-edit';
import { docModel } from '@/app/doc-model';
import { editorActions } from '@/app/editor-store';
import { dialogs } from '@/app/dialog-store';
import { toast } from '@/app/toast-store';

/**
 * Rich editing in the preview.
 *
 * Every rendered block knows where its inline content lives in the Markdown source.
 * Editing a block changes only that range, through one transaction on the document
 * model: the block keeps its type, position and attributes (heading level, list
 * marker, task state, cell, link destination, code language), and the rest of the
 * file is untouched. Blocks the serializer can't represent faithfully (HTML, diagrams,
 * math blocks, callout titles) open as Markdown source in place instead.
 */

export interface RichFocus {
  kind: InlineSource['kind'] | 'code' | 'source' | 'new';
  /** Source lines of the block the caret is in. */
  line: number;
  end: number;
  type: BlockType;
}

export interface RichApi {
  /** Applies an inline format to the selection in the block being edited. */
  format(cmd: 'bold' | 'italic' | 'strike' | 'code' | 'link'): void;
  /** Explicitly changes the type of the focused block. */
  setType(type: BlockType): void;
  /** Moves the focused top-level block up or down. */
  move(dir: -1 | 1): void;
  /** Deletes the focused top-level block. */
  remove(): void;
  focused(): RichFocus | null;
}

interface Session {
  host: HTMLElement;
  src: InlineSource;
  /** Serializer output before any edit. */
  s0: string;
  html0: string;
  opts: SerializeOptions;
}

type Pending =
  | { kind: 'host'; src: Pick<InlineSource, 'kind' | 'line' | 'col'>; at: 'start' | 'end' | number }
  | {
      kind: 'point';
      x: number;
      y: number;
      /** Where to go if nothing editable is under the point after the re-render. */
      fallback: Pick<InlineSource, 'kind' | 'line' | 'col'>;
    }
  | {
      kind: 'new';
      /** Line after which the new block goes, and whether it's a list item. */
      line: number;
      item: { prefix: string } | null;
    };

const optsFor = (src: InlineSource): SerializeOptions => ({
  singleLine: src.kind === 'heading' || src.kind === 'cell',
  cell: src.kind === 'cell',
});

const taskMarker = /^\[[ xX]\][ \t]?/;
const contentOf = (src: InlineSource) =>
  src.kind === 'item' ? src.content.replace(taskMarker, '') : src.content;

const hostOf = (el: EventTarget | null): HTMLElement | null =>
  el instanceof HTMLElement
    ? el.closest<HTMLElement>('[data-rich="inline"], [data-rich="new"]')
    : null;

/** The source lines of the block an element belongs to. */
function blockLines(el: HTMLElement): { line: number; end: number } | null {
  const b = el.closest<HTMLElement>('[data-line]');
  if (!b) return null;
  return {
    line: Number(b.dataset.line),
    end: Number(b.dataset.lineEnd ?? Number(b.dataset.line) + 1),
  };
}

/** Top-level blocks of the article, in order, with their source lines. */
function topBlocks(root: HTMLElement): { el: HTMLElement; line: number; end: number }[] {
  const out: { el: HTMLElement; line: number; end: number }[] = [];
  for (const child of root.children) {
    const el = child as HTMLElement;
    const b = el.matches('[data-line]') ? el : el.querySelector<HTMLElement>('[data-line]');
    if (!b) continue;
    out.push({ el, line: Number(b.dataset.line), end: Number(b.dataset.lineEnd) });
  }
  return out;
}

export function useRichEditing({
  docId,
  root,
  rendered,
  enabled,
  onFocusChange,
}: {
  docId: EntryId;
  root: RefObject<HTMLElement | null>;
  rendered: RenderResult;
  enabled: boolean;
  onFocusChange?(f: RichFocus | null): void;
}) {
  const session = useRef<Session | null>(null);
  const pending = useRef<Pending | null>(null);
  const suspend = useRef(false);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const renderedRef = useRef(rendered);
  renderedRef.current = rendered;
  const focusCb = useRef(onFocusChange);
  focusCb.current = onFocusChange;
  const lastFocus = useRef<RichFocus | null>(null);

  const currentText = () => docModel.text(docId) ?? editorActions.textOf(docId) ?? '';

  const report = (f: RichFocus | null) => {
    lastFocus.current = f;
    focusCb.current?.(f);
  };

  const sourceOf = (host: HTMLElement): InlineSource | undefined =>
    host.dataset.inline !== undefined
      ? renderedRef.current.inlines[Number(host.dataset.inline)]
      : undefined;

  const describe = (host: HTMLElement): RichFocus | null => {
    const src = sourceOf(host);
    const doc = currentText();
    if (src) {
      const starts = lineStarts(doc);
      const lineText = doc.slice(
        starts[src.line] ?? 0,
        (starts[src.line + 1] ?? doc.length + 1) - 1,
      );
      const lines = src.kind === 'cell' ? blockLines(host) : { line: src.line, end: src.end };
      return {
        kind: src.kind,
        line: lines?.line ?? src.line,
        end: lines?.end ?? src.end,
        type: blockTypeOf(lineText),
      };
    }
    const b = blockLines(host);
    return b ? { kind: 'new', ...b, type: 'paragraph' } : null;
  };

  // ---------------------------------------------------------------- prepare the DOM

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    if (!enabled) {
      for (const n of el.querySelectorAll<HTMLElement>('[data-rich]')) {
        n.removeAttribute('contenteditable');
        n.removeAttribute('data-rich');
        n.removeAttribute('tabindex');
      }
      el.querySelector('.rich-source')?.remove();
      return;
    }
    for (const host of el.querySelectorAll<HTMLElement>('[data-inline]')) {
      const src = rendered.inlines[Number(host.dataset.inline)];
      if (!src) continue;
      if (src.sourceOnly) {
        host.dataset.rich = 'source';
        host.tabIndex = 0;
        continue;
      }
      host.contentEditable = 'true';
      host.dataset.rich = 'inline';
      host.spellcheck = true;
    }
    // Heading anchors are for reading; inside an editable heading they only get in the way.
    for (const a of el.querySelectorAll<HTMLElement>('[data-rich="inline"] > .heading-anchor')) {
      const prev = a.previousSibling;
      if (prev?.nodeType === Node.TEXT_NODE) prev.nodeValue = prev.nodeValue!.replace(/\s+$/, '');
      a.remove();
    }
    for (const n of el.querySelectorAll<HTMLElement>('.katex, .copy-code, .code-lang, input'))
      n.contentEditable = 'false';
    for (const b of topBlocks(el)) {
      if (b.el.matches('[data-rich="inline"]') || b.el.querySelector('[data-rich="inline"]'))
        continue;
      b.el.dataset.rich = b.el.classList.contains('code-block') ? 'code' : 'source';
      b.el.tabIndex = 0;
      b.el.title = 'Click to edit';
    }
    // After a change re-rendered the document, put the caret back where the user is.
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    const findHost = (src: Pick<InlineSource, 'kind' | 'line' | 'col'>) =>
      [...el.querySelectorAll<HTMLElement>('[data-rich="inline"]')].find((h) => {
        const s = rendered.inlines[Number(h.dataset.inline)];
        return s && s.kind === src.kind && s.line === src.line && s.col === src.col;
      });
    if (p.kind === 'point') {
      const range = document.caretRangeFromPoint?.(p.x, p.y);
      const node = range?.startContainer;
      const host = hostOf(node instanceof Element ? node : (node?.parentElement ?? null));
      const expected = findHost(p.fallback);
      if (host && range && (!expected || host === expected)) {
        host.focus();
        const sel = getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      } else if (expected) {
        expected.focus();
        setCaretOffset(expected, Infinity);
      }
      return;
    }
    if (p.kind === 'host') {
      const host = [...el.querySelectorAll<HTMLElement>('[data-rich="inline"]')].find((h) => {
        const s = rendered.inlines[Number(h.dataset.inline)];
        return s && s.kind === p.src.kind && s.line === p.src.line && s.col === p.src.col;
      });
      if (host) {
        host.focus();
        setCaretOffset(host, p.at === 'start' ? 0 : p.at === 'end' ? Infinity : p.at);
      }
      return;
    }
    // A new, empty block after a block the user pressed Enter in.
    createNewBlock(el, p.line, p.item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered, enabled]);

  // Typing over a whole link label keeps the link (browsers would drop it).
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !enabled) return;
    let typingInto: HTMLAnchorElement | null = null;
    const onBeforeInput = (e: InputEvent) => {
      if (e.inputType !== 'insertText' && e.inputType !== 'insertReplacementText') {
        typingInto = null;
        return;
      }
      const host = hostOf(e.target);
      const sel = getSelection();
      if (!host || !sel?.rangeCount) return;
      const range = sel.getRangeAt(0);
      // Keep typing inside a link label that was just replaced.
      if (typingInto && range.collapsed && host.contains(typingInto)) {
        const last = typingInto.lastChild;
        if (last && range.endContainer === last && range.endOffset === last.nodeValue?.length) {
          e.preventDefault();
          (last as Text).appendData(e.data ?? '');
          sel.collapse(last, last.nodeValue!.length);
          return;
        }
      }
      typingInto = null;
      const a = (
        range.commonAncestorContainer instanceof Element
          ? range.commonAncestorContainer
          : range.commonAncestorContainer.parentElement
      )?.closest('a');
      const whole = a && host.contains(a) && !range.collapsed && range.toString() === a.textContent;
      if (!a || !whole) return;
      const text = e.data ?? e.dataTransfer?.getData('text/plain') ?? '';
      e.preventDefault();
      a.textContent = text;
      const t = a.firstChild ?? a;
      sel.collapse(t, text.length);
      typingInto = a;
    };
    const stop = () => (typingInto = null);
    el.addEventListener('beforeinput', onBeforeInput);
    el.addEventListener('mousedown', stop);
    return () => {
      el.removeEventListener('beforeinput', onBeforeInput);
      el.removeEventListener('mousedown', stop);
    };
  }, [enabled, root]);

  function createNewBlock(el: HTMLElement, line: number, item: { prefix: string } | null) {
    const anchor = [...el.querySelectorAll<HTMLElement>(item ? 'li[data-line]' : '[data-line]')]
      .filter((n) => Number(n.dataset.lineEnd) - 1 >= line && Number(n.dataset.line) <= line)
      .pop();
    const block = item ? anchor : anchor && topBlocks(el).find((b) => b.el.contains(anchor))?.el;
    const node = document.createElement(item ? 'li' : 'p');
    const host = item ? document.createElement('span') : node;
    if (item) node.append(host);
    host.contentEditable = 'true';
    host.dataset.rich = 'new';
    host.dataset.afterLine = String(line);
    if (item) host.dataset.prefix = item.prefix;
    host.className = 'rich-new';
    host.setAttribute('aria-label', 'New block');
    if (block) block.after(node);
    else el.append(node);
    host.focus();
  }

  // ---------------------------------------------------------------- commits

  function start(host: HTMLElement): boolean {
    const src = sourceOf(host);
    if (!src) return false;
    const opts = optsFor(src);
    let s0: string;
    try {
      s0 = serializeInline(host, opts);
    } catch {
      openSource(host);
      return false;
    }
    // The serializer must describe the same content as the source, or editing could change it.
    if (renderInlineMarkdown(s0) !== renderInlineMarkdown(contentOf(src))) {
      openSource(host);
      return false;
    }
    session.current = { host, src, s0, html0: host.innerHTML, opts };
    report(describe(host));
    return true;
  }

  /** Writes the edited block back. Returns the number of lines added (for focus mapping). */
  function commit(s: Session, extra?: { at: number; insert: string }): number | null {
    if (!s.host.isConnected) return null;
    let s1: string;
    try {
      s1 = serializeInline(s.host, s.opts);
    } catch {
      toast({
        message: "That formatting can't be saved in Markdown, so it was undone.",
        tone: 'error',
      });
      s.host.innerHTML = s.html0;
      return null;
    }
    if (s1 === s.s0 && !extra) return 0;
    const doc = currentText();
    const range = locateInline(doc, s.src);
    if (!range) {
      toast({
        message:
          'This part of the document changed while you were editing it, so your edit was not applied.',
        tone: 'error',
      });
      s.host.innerHTML = s.html0;
      return null;
    }
    const merged =
      s1 === s.s0 ? contentOf(s.src) : (mergeInlineEdit(contentOf(s.src), s.s0, s1) ?? s1);
    const insert = layoutInline(merged, range, !!s.opts.singleLine);
    const changes = [{ from: range.from, to: range.to, insert }];
    if (extra) changes.push({ from: extra.at, to: extra.at, insert: extra.insert });
    const before = doc.slice(range.from, range.to).split('\n').length;
    editorActions.edit(docId, { changes, userEvent: 'input.rich' });
    return insert.split('\n').length - before + (extra ? extra.insert.split('\n').length - 1 : 0);
  }

  function commitNew(host: HTMLElement) {
    let text: string;
    try {
      text = serializeInline(host, {});
    } catch {
      text = escapeText(host.textContent ?? '');
    }
    const line = Number(host.dataset.afterLine);
    if (!text.trim()) {
      if (host.closest('li') && host.dataset.prefix) host.closest('li')!.remove();
      else host.remove();
      return;
    }
    const doc = currentText();
    const prefix = host.dataset.prefix;
    const at = prefix !== undefined ? endOfLine(doc, line) : afterBlock(doc, line + 1);
    const insert =
      prefix !== undefined
        ? `\n${prefix}${text.replace(/\n/g, `\n${' '.repeat(prefix.length)}`)}`
        : `\n\n${text}`;
    editorActions.edit(docId, { changes: { from: at, insert }, userEvent: 'input.rich' });
  }

  // ---------------------------------------------------------------- source fallback

  function openSource(target: HTMLElement) {
    const el = root.current;
    if (!el) return;
    const block = topBlocks(el).find((b) => b.el.contains(target));
    const own = target.closest<HTMLElement>('[data-line]');
    const lines = block
      ? { line: block.line, end: block.end, el: block.el }
      : own
        ? { line: Number(own.dataset.line), end: Number(own.dataset.lineEnd), el: own }
        : null;
    if (!lines) return;
    const doc = currentText();
    const starts = lineStarts(doc);
    const isCode = lines.el.dataset.rich === 'code';
    const body = isCode ? fenceBody(doc, lines.line, lines.end) : null;
    const from = body ? body.from : (starts[lines.line] ?? doc.length);
    const to = body ? body.to : afterBlock(doc, lines.end);
    const original = doc.slice(from, to);
    const ta = document.createElement('textarea');
    ta.className = 'rich-source';
    ta.value = original;
    ta.spellcheck = !isCode;
    ta.setAttribute(
      'aria-label',
      isCode ? `Edit ${body?.info || 'code'} block` : 'Edit this block as Markdown',
    );
    const label = document.createElement('div');
    label.className = 'rich-source-hint';
    label.textContent = isCode
      ? `${body?.info || 'Code'} · Ctrl+Enter or click outside to save · Esc to cancel`
      : 'Markdown · Ctrl+Enter or click outside to save · Esc to cancel';
    const wrap = document.createElement('div');
    wrap.className = 'rich-source-wrap';
    wrap.append(label, ta);
    lines.el.style.display = 'none';
    lines.el.after(wrap);
    const fit = () => {
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight + 2}px`;
    };
    fit();
    ta.addEventListener('input', fit);
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      wrap.remove();
      lines.el.style.display = '';
      if (!save || ta.value === original) return;
      const now = currentText();
      if (now.slice(from, to) !== original) {
        toast({
          message: 'This part of the document changed meanwhile, so your edit was not applied.',
          tone: 'error',
        });
        return;
      }
      let insert = ta.value;
      if (body?.empty && insert && !insert.endsWith('\n')) insert += '\n';
      editorActions.edit(docId, { changes: { from, to, insert }, userEvent: 'input.rich' });
    };
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Tab' && isCode) {
        e.preventDefault();
        document.execCommand('insertText', false, '  ');
      }
    });
    ta.addEventListener('blur', () => finish(true));
    ta.focus();
    report({
      kind: isCode ? 'code' : 'source',
      line: lines.line,
      end: lines.end,
      type: 'paragraph',
    });
  }

  // ---------------------------------------------------------------- events

  const onFocus = (e: React.FocusEvent) => {
    if (!enabled) return;
    const host = hostOf(e.target);
    if (!host) return;
    if (host.dataset.rich === 'new') {
      report(describe(host));
      return;
    }
    if (session.current?.host !== host) start(host);
  };

  const onBlur = (e: React.FocusEvent) => {
    if (!enabled || suspend.current) return;
    const host = hostOf(e.target);
    if (!host) return;
    const next = e.relatedTarget as HTMLElement | null;
    if (host.dataset.rich === 'new') {
      commitNew(host);
      return;
    }
    const s = session.current;
    if (!s || s.host !== host) return;
    session.current = null;
    // Where focus went, described by source position, so it survives the re-render.
    const nextHost = hostOf(next);
    const nextSrc = nextHost ? sourceOf(nextHost) : undefined;
    const changed = safeSerialize(s) !== s.s0;
    const delta = commit(s);
    if (delta && lastFocus.current)
      lastFocus.current = { ...lastFocus.current, end: lastFocus.current.end + delta };
    // Any saved change re-renders the document, so focus has to be put back.
    if (changed && delta !== null && nextSrc) {
      const shift = nextSrc.line >= s.src.end ? delta : 0;
      const pt = pointer.current;
      const moved = { ...nextSrc, line: nextSrc.line + shift };
      pending.current = pt
        ? { kind: 'point', x: pt.x, y: pt.y, fallback: moved }
        : { kind: 'host', src: moved, at: 'start' };
    }
    // Using the ribbon keeps the block selected, so its commands apply to it.
    if (!next || (!root.current?.contains(next) && !next.closest('.ribbon'))) report(null);
  };

  const onMouseDown = (e: React.MouseEvent) => {
    pointer.current = { x: e.clientX, y: e.clientY };
    setTimeout(() => (pointer.current = null), 0);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!enabled) return;
    const target = e.target as HTMLElement;
    const host = hostOf(target);
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    // Blocks shown as source open on Enter, like a button.
    if (
      !host &&
      (target.dataset.rich === 'source' || target.dataset.rich === 'code') &&
      e.key === 'Enter'
    ) {
      e.preventDefault();
      openSource(target);
      return;
    }
    if (mod && (key === 'z' || key === 'y')) {
      const s = session.current;
      const dirty = s && s.host === host && safeSerialize(s) !== s.s0;
      if (dirty) return; // the browser undoes typing inside the block
      e.preventDefault();
      const redo = key === 'y' || e.shiftKey;
      const src = host ? sourceOf(host) : undefined;
      if (src) pending.current = { kind: 'host', src, at: caretOffset(host!) ?? 'end' };
      session.current = null;
      if (redo) docModel.redo(docId);
      else docModel.undo(docId);
      return;
    }
    if (!host) return;
    const s = session.current;
    if (mod && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      api.move(e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (mod && !e.altKey) {
      const fmt =
        key === 'b'
          ? 'bold'
          : key === 'i'
            ? 'italic'
            : key === '`'
              ? 'code'
              : e.shiftKey && key === 'x'
                ? 'strike'
                : e.shiftKey && key === 'k'
                  ? 'link'
                  : null;
      if (fmt) {
        e.preventDefault();
        api.format(fmt);
        return;
      }
    }
    const src = sourceOf(host);
    if (e.key === 'Escape' && s) {
      e.preventDefault();
      s.host.innerHTML = s.html0;
      session.current = null;
      host.blur();
      return;
    }
    if (src?.kind === 'cell' && (e.key === 'Tab' || e.key === 'Enter')) {
      e.preventDefault();
      const cells = [...root.current!.querySelectorAll<HTMLElement>('[data-rich="inline"]')].filter(
        (h) => sourceOf(h)?.kind === 'cell' && h.closest('table') === host.closest('table'),
      );
      const i = cells.indexOf(host);
      const target =
        e.key === 'Tab'
          ? cells[i + (e.shiftKey ? -1 : 1)]
          : cells.find((c, j) => j > i && sourceOf(c)?.col === src.col);
      if (target) {
        pointer.current = null;
        target.focus();
        setCaretOffset(target, Infinity);
      } else host.blur();
      return;
    }
    if (e.key === 'Enter' && host.dataset.rich !== 'new' && src) {
      if (e.shiftKey && src.kind !== 'heading') {
        e.preventDefault();
        document.execCommand('insertLineBreak');
        return;
      }
      e.preventDefault();
      splitBlock(host, src);
      return;
    }
    if (e.key === 'Enter' && host.dataset.rich === 'new') {
      e.preventDefault();
      host.blur();
      return;
    }
    if (
      e.key === 'Backspace' &&
      src &&
      !host.textContent &&
      (src.kind === 'paragraph' || src.kind === 'item')
    ) {
      e.preventDefault();
      removeLines(src.line, src.end, host);
      return;
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.shiftKey) {
      const off = caretOffset(host);
      const len = host.textContent?.length ?? 0;
      const up = e.key === 'ArrowUp';
      if ((up && off === 0) || (!up && off === len)) {
        const hosts = [...root.current!.querySelectorAll<HTMLElement>('[data-rich="inline"]')];
        const next = hosts[hosts.indexOf(host) + (up ? -1 : 1)];
        if (next) {
          e.preventDefault();
          const nsrc = sourceOf(next);
          pointer.current = null;
          // Focus moves; if the block changed, its commit re-renders and the caret is restored.
          next.focus();
          setCaretOffset(next, up ? Infinity : 0);
          if (pending.current?.kind === 'host' && nsrc) pending.current.at = up ? 'end' : 'start';
        }
      }
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (!enabled) return;
    const host = hostOf(e.target);
    if (!host) return;
    e.preventDefault();
    // Pasted content is untrusted: only its text comes in.
    let text = e.clipboardData.getData('text/plain');
    const src = sourceOf(host);
    if (src && optsFor(src).singleLine) text = text.replace(/\s*\n\s*/g, ' ');
    document.execCommand('insertText', false, text);
  };

  const onClick = (e: React.MouseEvent): boolean => {
    if (!enabled) return false;
    const target = e.target as HTMLElement;
    const block = target.closest<HTMLElement>('[data-rich="source"], [data-rich="code"]');
    if (block && !target.closest('.copy-code')) {
      e.preventDefault();
      openSource(block);
      return true;
    }
    // Links inside editable blocks are edited; Ctrl/Cmd+click follows them.
    if (hostOf(target) && target.closest('a') && !(e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      return true;
    }
    return false;
  };

  function safeSerialize(s: Session): string | null {
    try {
      return serializeInline(s.host, s.opts);
    } catch {
      return null;
    }
  }

  /** Enter: the text after the caret becomes a new block of the same kind below. */
  function splitBlock(host: HTMLElement, src: InlineSource) {
    const s = session.current;
    if (!s || s.host !== host) return;
    const sel = getSelection();
    let rest = '';
    if (sel?.rangeCount) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const tail = document.createRange();
      tail.setStart(range.endContainer, range.endOffset);
      tail.setEnd(host, host.childNodes.length);
      const frag = tail.extractContents();
      const holder = document.createElement('span');
      holder.append(frag);
      try {
        rest = serializeInline(holder, {});
      } catch {
        rest = escapeText(holder.textContent ?? '');
      }
    }
    const doc = currentText();
    const item = src.kind === 'item' ? itemPrefix(doc, src.line) : null;
    session.current = null;
    if (rest.trim()) {
      const at = item ? endOfLine(doc, src.end - 1) : afterBlock(doc, src.end);
      const insert = item ? `\n${item.prefix}${rest}` : `\n\n${rest}`;
      const delta = commit(s, { at, insert });
      if (delta === null) return;
      // Lines the edited block itself gained, then the new block's first line.
      const own = delta - (insert.split('\n').length - 1);
      const atLine = lineStarts(doc).filter((x) => x <= at).length - 1;
      pending.current = {
        kind: 'host',
        src: {
          kind: item ? 'item' : 'paragraph',
          line: atLine + own + (item ? 1 : 2),
          col: undefined,
        },
        at: 'start',
      };
      return;
    }
    const delta = commit(s) ?? 0;
    pending.current = { kind: 'new', line: src.end - 1 + delta, item };
    if (!delta) {
      // Nothing re-rendered: create the new block right away.
      const el = root.current;
      const p = pending.current;
      pending.current = null;
      if (el && p.kind === 'new') createNewBlock(el, p.line, p.item);
    }
  }

  function removeLines(line: number, end: number, host: HTMLElement) {
    const doc = currentText();
    const hosts = [...root.current!.querySelectorAll<HTMLElement>('[data-rich="inline"]')];
    const prev = hosts[hosts.indexOf(host) - 1];
    const prevSrc = prev ? sourceOf(prev) : undefined;
    session.current = null;
    if (prevSrc) pending.current = { kind: 'host', src: prevSrc, at: 'end' };
    editorActions.edit(docId, { changes: deleteBlock(doc, line, end), userEvent: 'delete.rich' });
  }

  /** The unit the move and delete tools act on: the focused list item, else its top-level block. */
  function focusedBlock(): {
    line: number;
    end: number;
    index: number;
    blocks: { line: number; end: number }[];
    item: boolean;
  } | null {
    const el = root.current;
    const f = lastFocus.current;
    if (!el || !f) return null;
    const range = (n: HTMLElement) => ({
      line: Number(n.dataset.line),
      end: Number(n.dataset.lineEnd),
    });
    let item = false;
    let blocks = topBlocks(el).map(({ line, end }) => ({ line, end }));
    if (f.kind === 'item') {
      const li = [...el.querySelectorAll<HTMLElement>('li[data-line]')]
        .filter((n) => Number(n.dataset.line) === f.line)
        .pop();
      const siblings = [...(li?.parentElement?.children ?? [])].filter(
        (n): n is HTMLElement => n instanceof HTMLElement && n.matches('li[data-line]'),
      );
      if (siblings.length) {
        blocks = siblings.map(range);
        item = true;
      }
    }
    const index = blocks.findIndex((b) => f.line >= b.line && f.line < b.end);
    if (index < 0) return null;
    return { ...blocks[index]!, index, blocks, item };
  }

  const api: RichApi = {
    format(cmd) {
      const s = session.current;
      if (!s) return;
      s.host.focus();
      if (cmd === 'bold') document.execCommand('bold');
      else if (cmd === 'italic') document.execCommand('italic');
      else if (cmd === 'strike') document.execCommand('strikeThrough');
      else if (cmd === 'code') {
        const sel = getSelection();
        if (!sel?.rangeCount) return;
        const inside = (
          sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement
        )?.closest('code');
        // Already code: turn it back into plain text.
        if (inside && s.host.contains(inside)) {
          const text = document.createTextNode(inside.textContent ?? '');
          inside.replaceWith(text);
          sel.selectAllChildren(text.parentNode!);
          sel.collapseToEnd();
          return;
        }
        // No selection: use the word at the caret, or a placeholder.
        if (sel.isCollapsed) {
          sel.modify('move', 'backward', 'word');
          sel.modify('extend', 'forward', 'word');
        }
        const range = sel.getRangeAt(0);
        const code = document.createElement('code');
        code.textContent = range.toString().trim() || 'code';
        range.deleteContents();
        range.insertNode(code);
        sel.selectAllChildren(code);
      } else if (cmd === 'link') {
        const sel = getSelection();
        const range = sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        suspend.current = true;
        void dialogs
          .prompt({ title: 'Link', label: 'Address or document path', initial: 'https://' })
          .then((url) => {
            suspend.current = false;
            if (!s.host.isConnected) return;
            s.host.focus();
            if (range) {
              const sel2 = getSelection();
              sel2?.removeAllRanges();
              sel2?.addRange(range);
            }
            if (!url) return;
            if (range && range.collapsed) document.execCommand('insertText', false, url);
            document.execCommand('createLink', false, url);
          });
      }
    },
    setType(type) {
      const f = lastFocus.current;
      if (!f) return;
      const s = session.current;
      // Save typing first, then change the type in a separate, undoable step.
      if (s) {
        session.current = null;
        commit(s);
      }
      const doc = currentText();
      const lines = f.kind === 'cell' ? null : { line: f.line, end: f.end };
      if (!lines) return;
      const change = setBlockType(doc, lines.line, lines.end, type);
      if (!change) return;
      pending.current = {
        kind: 'host',
        src: {
          kind: type.startsWith('h')
            ? 'heading'
            : type === 'paragraph' || type === 'quote'
              ? 'paragraph'
              : 'item',
          line: lines.line,
          col: undefined,
        },
        at: 'end',
      };
      editorActions.edit(docId, { changes: change, userEvent: 'input.rich.type' });
      lastFocus.current = { ...f, type };
      focusCb.current?.(lastFocus.current);
    },
    move(dir) {
      const s = session.current;
      if (s) {
        session.current = null;
        commit(s);
      }
      const b = focusedBlock();
      const f = lastFocus.current;
      if (!b || !f) return;
      const change = moveBlock(currentText(), b.blocks, b.index, dir, b.item);
      if (!change) return;
      // Keep the caret in the moved block (and the tool aimed at it) so it can be moved again.
      const host = hostOf(document.activeElement);
      const src = host ? sourceOf(host) : undefined;
      if (src)
        pending.current = {
          kind: 'host',
          src: { ...src, line: src.line + change.shift },
          at: 'end',
        };
      lastFocus.current = { ...f, line: f.line + change.shift, end: f.end + change.shift };
      focusCb.current?.(lastFocus.current);
      editorActions.edit(docId, { changes: change, userEvent: 'move.rich' });
    },
    remove() {
      const b = focusedBlock();
      if (!b) return;
      session.current = null;
      editorActions.edit(docId, {
        changes: deleteBlock(currentText(), b.line, b.end),
        userEvent: 'delete.rich',
      });
      report(null);
    },
    focused: () => lastFocus.current,
  };

  return {
    api,
    handlers: { onFocus, onBlur, onKeyDown, onPaste, onMouseDown },
    onClick,
  };
}

function endOfLine(doc: string, line: number): number {
  const starts = lineStarts(doc);
  return line + 1 < starts.length ? starts[line + 1]! - 1 : doc.length;
}

/** The marker a new sibling of the list item on `line` gets (next number, unchecked task). */
function itemPrefix(doc: string, line: number): { prefix: string } | null {
  const starts = lineStarts(doc);
  const text = doc.slice(starts[line] ?? 0, endOfLine(doc, line));
  const m = /^(\s*(?:>\s?)*)(\s*)([-*+]|\d+)([.)])?(\s+)(\[[ xX]\]\s+)?/.exec(text);
  if (!m) return null;
  const num = /^\d+$/.test(m[3]!) ? `${Number(m[3]) + 1}${m[4] ?? '.'}` : m[3]!;
  return { prefix: `${m[1]}${m[2]}${num}${m[5]}${m[6] ? '[ ] ' : ''}` };
}
