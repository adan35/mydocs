import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
  useImperativeHandle,
} from 'react';
import { createPortal } from 'react-dom';
import type { EntryId } from '@/domain/types';
import { isExternalHref, resolvePath, safeDecode } from '@/domain/paths';
import { renderMarkdown } from '@/lib/markdown/render';
import { renderMermaidIn } from '@/lib/markdown/mermaid';
import { session, ws } from '@/app/app-store';
import { openEntry } from '@/app/actions';
import { slugify } from '@/domain/outline';
import { resolveWikiLink } from '@/app/workspace';
import { toast } from '@/app/toast-store';
import { useResolvedTheme, useTree } from '../hooks';
import { useLinkPreview } from './LinkPreview';

export interface PreviewHandle {
  scrollToLine(line: number, smooth?: boolean): void;
  scrollToSlug(slug: string): void;
  element: HTMLElement | null;
}

interface Props {
  docId: EntryId;
  text: string;
  className?: string;
  /** Toggle a task checkbox on a given source line. */
  onToggleTask?(line: number): void;
  onVisibleLine?(line: number): void;
  ref?: Ref<PreviewHandle>;
}

/** Object URLs for images stored in the workspace, keyed by entry id. */
const imageUrls = new Map<EntryId, { url: string; updatedAt: number }>();

async function imageUrlFor(id: EntryId): Promise<string | null> {
  const entry = ws().get(id);
  if (!entry) return null;
  const cached = imageUrls.get(id);
  if (cached && cached.updatedAt === entry.updatedAt) return cached.url;
  const blob = await ws().readBlob(id);
  if (!blob) return null;
  // SVGs are rendered via <img>, which never executes their scripts.
  const typed = blob.type ? blob : new Blob([blob], { type: entry.mime ?? '' });
  const url = URL.createObjectURL(typed);
  if (cached) URL.revokeObjectURL(cached.url);
  imageUrls.set(id, { url, updatedAt: entry.updatedAt });
  return url;
}

export function Preview({ docId, text, className = '', onToggleTask, onVisibleLine, ref }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const deferred = useDeferredValue(text);
  const tree = useTree()!;
  const theme = useResolvedTheme();
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);
  const rendered = useMemo(() => renderMarkdown(deferred), [deferred]);
  const linkPreview = useLinkPreview((a) => {
    if (a.dataset.wiki !== undefined) return resolveWiki(a.dataset.wiki);
    const href = a.getAttribute('href') ?? '';
    if (!href || href.startsWith('#') || isExternalHref(href)) return undefined;
    const id = resolveHref(docId, href);
    return id && id !== docId ? id : undefined;
  });
  const callbacks = useRef({ onToggleTask, onVisibleLine });
  callbacks.current = { onToggleTask, onVisibleLine };

  useImperativeHandle(ref, () => ({
    get element() {
      return root.current;
    },
    scrollToLine(line: number, smooth = false) {
      const container = scrollParent(root.current);
      const el = nearestLineElement(root.current, line);
      if (!container || !el) return;
      const top =
        el.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop -
        16;
      container.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
    },
    scrollToSlug(slug: string) {
      const el = root.current?.querySelector(
        `[data-heading="${CSS.escape(slug)}"], [id="${CSS.escape(slug)}"]`,
      );
      el?.scrollIntoView({ block: 'start' });
    },
  }));

  // Post-process: resolve local images, add copy buttons, mark broken links, render diagrams.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let cancelled = false;
    const dir = tree.dirOf(docId);
    for (const img of el.querySelectorAll<HTMLImageElement>('img[src], img[data-src]')) {
      // The written path is kept in data-src: this effect can run again (Strict Mode, a
      // tree change) after src was cleared or swapped for an object URL.
      const src = img.dataset.src ?? img.getAttribute('src') ?? '';
      if (isExternalHref(src) || src.startsWith('data:') || src.startsWith('blob:')) continue;
      img.dataset.src = src;
      const wiki = img.dataset.wiki;
      const path = wiki ? null : resolvePath(dir, safeDecode(src.split('#')[0]!.split('?')[0]!));
      const target = wiki
        ? resolveWikiLink(tree, wiki)
        : path !== null
          ? tree.findByPath(path)
          : undefined;
      if (!img.src.startsWith('blob:')) img.removeAttribute('src');
      if (!target) {
        markMissing(img, src);
        continue;
      }
      void imageUrlFor(target.id).then((url) => {
        if (cancelled) return;
        if (url) img.src = url;
        else markMissing(img, src);
      });
    }
    for (const block of el.querySelectorAll<HTMLElement>('.code-block')) {
      if (block.querySelector('.copy-code')) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy-code';
      btn.textContent = 'Copy';
      btn.setAttribute('aria-label', 'Copy code');
      block.append(btn);
    }
    for (const a of el.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      const href = a.getAttribute('href') ?? '';
      if (isExternalHref(href) || href.startsWith('#') || a.classList.contains('heading-anchor'))
        continue;
      const target = a.dataset.wiki ? resolveWiki(a.dataset.wiki) : resolveHref(docId, href);
      if (!target) {
        a.classList.add('link-broken');
        a.title = 'This document could not be found';
      }
    }
    void renderMermaidIn(el, theme === 'dark');
    return () => {
      cancelled = true;
    };
  }, [rendered, tree, docId, theme]);

  // Report the first visible source line (for outline highlighting and scroll sync).
  useEffect(() => {
    const el = root.current;
    const container = scrollParent(el);
    if (!el || !container) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const top = container.getBoundingClientRect().top;
        let line = 0;
        for (const node of el.querySelectorAll<HTMLElement>('[data-line]')) {
          if (node.getBoundingClientRect().top - top > 40) break;
          line = Number(node.dataset.line);
        }
        callbacks.current.onVisibleLine?.(line);
      });
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => container.removeEventListener('scroll', onScroll);
  }, [rendered]);

  const onClick = (e: React.MouseEvent) => {
    let target = e.target as HTMLElement;
    // On touch screens a tap anywhere on a task's own text toggles it.
    if (
      target.classList.contains('task-list-item') &&
      matchMedia('(pointer: coarse)').matches &&
      !getSelection()?.toString()
    ) {
      const box = target.querySelector<HTMLInputElement>(':scope > .task-list-item-checkbox');
      if (box) target = box;
    }
    if (
      target instanceof HTMLInputElement &&
      target.classList.contains('task-list-item-checkbox')
    ) {
      e.preventDefault();
      const li = target.closest<HTMLElement>('[data-line]');
      if (li && callbacks.current.onToggleTask)
        callbacks.current.onToggleTask(Number(li.dataset.line));
      return;
    }
    if (target.classList.contains('copy-code')) {
      const code = target.parentElement?.querySelector('code')?.textContent ?? '';
      void navigator.clipboard?.writeText(code).then(
        () => {
          target.textContent = 'Copied';
          setTimeout(() => (target.textContent = 'Copy'), 1500);
        },
        () => toast({ message: 'Copying is blocked by the browser.', tone: 'error' }),
      );
      return;
    }
    if (target instanceof HTMLImageElement && target.src) {
      setZoom({ src: target.src, alt: target.alt });
      return;
    }
    const a = target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      e.preventDefault();
      const slug = safeDecode(href.slice(1));
      root.current
        ?.querySelector(`[data-heading="${CSS.escape(slug)}"], [id="${CSS.escape(slug)}"]`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    if (a.dataset.wiki !== undefined) {
      e.preventDefault();
      const id = resolveWiki(a.dataset.wiki);
      if (id) void openEntry(id, a.dataset.fragment && slugify(a.dataset.fragment));
      else
        toast({ message: `"${a.dataset.wiki}" doesn't exist in this workspace.`, tone: 'error' });
      return;
    }
    if (isExternalHref(href)) return; // target=_blank + rel=noopener from the sanitizer
    e.preventDefault();
    const [, fragment] = href.split('#');
    const id = resolveHref(docId, href);
    if (id) void openEntry(id, fragment ? safeDecode(fragment) : undefined);
    else
      toast({ message: `"${safeDecode(href)}" doesn't exist in this workspace.`, tone: 'error' });
  };

  return (
    <>
      {rendered.frontMatter && <Properties data={rendered.frontMatter} className={className} />}
      <article
        ref={root}
        className={`prose ${className}`}
        onClick={(e) => {
          linkPreview.hide();
          onClick(e);
        }}
        {...linkPreview.handlers}
        // Sanitized by DOMPurify in renderMarkdown.
        dangerouslySetInnerHTML={{ __html: rendered.html }}
      />
      {linkPreview.card}
      {zoom &&
        createPortal(
          <div
            className="fixed inset-0 z-[70] flex cursor-zoom-out items-center justify-center bg-[var(--scrim)] p-4 sm:p-10"
            role="dialog"
            aria-modal="true"
            aria-label={zoom.alt || 'Image'}
            onClick={() => setZoom(null)}
            onKeyDown={(e) => e.key === 'Escape' && setZoom(null)}
            tabIndex={-1}
            ref={(el) => el?.focus()}
          >
            <div
              className="absolute top-3 right-3 flex gap-1 rounded-lg bg-canvas p-1 shadow-3"
              role="toolbar"
              aria-label="Image actions"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="btn btn-ghost h-8 px-2 text-caption"
                onClick={() => window.open(zoom.src, '_blank', 'noopener')}
              >
                Open full size
              </button>
              <button
                type="button"
                className="btn btn-ghost h-8 px-2 text-caption"
                onClick={() => void copyImage(zoom.src)}
              >
                Copy
              </button>
              <a
                className="btn btn-ghost h-8 px-2 text-caption"
                href={zoom.src}
                download={zoom.alt || 'image'}
              >
                Download
              </a>
              <button
                type="button"
                className="btn btn-ghost h-8 px-2 text-caption"
                onClick={() => setZoom(null)}
              >
                Close
              </button>
            </div>
            <img
              src={zoom.src}
              alt={zoom.alt}
              className="max-h-full max-w-full rounded-md bg-canvas object-contain shadow-3"
            />
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * Copies an image to the clipboard as PNG (the format every browser accepts).
 * Drawn through a canvas rather than fetched, which the content security policy allows.
 */
async function copyImage(src: string) {
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/png'),
    );
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    toast({ message: 'Image copied.', tone: 'success' });
  } catch {
    toast({ message: "This image can't be copied here. Try Download instead.", tone: 'error' });
  }
}

/** Formats a front-matter value for display without changing the source. */
export function propertyText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.map(propertyText).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Front matter shown as a quiet properties table above the document. */
function Properties({ data, className }: { data: Record<string, unknown>; className: string }) {
  const entries = Object.entries(data).filter(([, v]) => propertyText(v) !== '');
  if (!entries.length) return null;
  return (
    <dl
      aria-label="Properties"
      className={`properties mb-6 grid grid-cols-[minmax(80px,auto)_1fr] gap-x-6 gap-y-1 border-b border-hairline pb-4 text-[13px] ${className}`}
    >
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="truncate text-steel">{k}</dt>
          <dd className="min-w-0 break-words text-charcoal">{propertyText(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function markMissing(img: HTMLImageElement, src: string) {
  img.classList.add('img-missing');
  img.alt = `Image not found: ${safeDecode(src)}`;
}

function resolveHref(docId: EntryId, href: string): EntryId | undefined {
  const [path = ''] = href.split('#');
  const tree = ws().tree;
  return session().knowledge.resolve(tree, docId, { kind: 'markdown', target: safeDecode(path) });
}

function resolveWiki(target: string): EntryId | undefined {
  return resolveWikiLink(ws().tree, target)?.id;
}

function nearestLineElement(root: HTMLElement | null, line: number): HTMLElement | null {
  if (!root) return null;
  let best: HTMLElement | null = null;
  for (const node of root.querySelectorAll<HTMLElement>('[data-line]')) {
    if (Number(node.dataset.line) <= line) best = node;
    else break;
  }
  return best;
}

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  let cur = el?.parentElement ?? null;
  while (cur) {
    const style = getComputedStyle(cur);
    if (/(auto|scroll)/.test(style.overflowY)) return cur;
    cur = cur.parentElement;
  }
  return null;
}
