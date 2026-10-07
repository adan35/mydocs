import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EntryId } from '@/domain/types';
import { ws } from '@/app/app-store';
import { markdownToPlainText } from '@/app/search';
import { isMarkdownName } from '@/domain/names';
import { FileIcon } from '../components/FileIcon';
import { relativeTime } from '../hooks';

const OPEN_DELAY = 450;
const CLOSE_DELAY = 200;

/**
 * Hovering an internal link shows a small, read-only preview of the target.
 * Mouse only; dismissed by moving away, scrolling or Escape.
 */
export function useLinkPreview(resolve: (a: HTMLAnchorElement) => EntryId | undefined) {
  const [state, setState] = useState<{ id: EntryId; rect: DOMRect } | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const canHover = useMemo(() => matchMedia('(hover: hover) and (pointer: fine)').matches, []);

  useEffect(() => {
    if (!state) return;
    const hide = () => setState(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    addEventListener('scroll', hide, true);
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('scroll', hide, true);
      removeEventListener('keydown', onKey);
    };
  }, [state]);

  useEffect(
    () => () => {
      clearTimeout(openTimer.current);
      clearTimeout(closeTimer.current);
    },
    [],
  );

  const keepOpen = () => clearTimeout(closeTimer.current);
  const scheduleClose = () => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setState(null), CLOSE_DELAY);
  };

  const handlers = {
    onMouseOver(e: React.MouseEvent) {
      if (!canHover) return;
      const a = (e.target as HTMLElement).closest('a');
      if (!a) return;
      const id = resolve(a);
      if (!id) return;
      keepOpen();
      clearTimeout(openTimer.current);
      openTimer.current = setTimeout(
        () => setState({ id, rect: a.getBoundingClientRect() }),
        OPEN_DELAY,
      );
    },
    onMouseOut(e: React.MouseEvent) {
      if ((e.target as HTMLElement).closest('a')) scheduleClose();
    },
  };

  const card = state
    ? createPortal(
        <LinkPreviewCard
          id={state.id}
          rect={state.rect}
          onEnter={keepOpen}
          onLeave={scheduleClose}
        />,
        document.body,
      )
    : null;
  return { handlers, card, hide: () => setState(null) };
}

function LinkPreviewCard({
  id,
  rect,
  onEnter,
  onLeave,
}: {
  id: EntryId;
  rect: DOMRect;
  onEnter(): void;
  onLeave(): void;
}) {
  const e = ws().get(id);
  const text = ws().allTexts().get(id) ?? '';
  const excerpt = useMemo(() => {
    const plain = isMarkdownName(e?.name ?? '') ? markdownToPlainText(text) : text;
    const lines = plain
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const out = lines.join('\n');
    return out.length > 420 ? `${out.slice(0, 419)}…` : out;
  }, [text, e?.name]);
  if (!e) return null;
  const width = 340;
  const left = Math.max(8, Math.min(rect.left, innerWidth - width - 8));
  const below = rect.bottom + 8;
  const placeAbove = below + 220 > innerHeight && rect.top > 240;
  return (
    <div
      role="tooltip"
      className="popover animate-in fixed z-[60] p-3"
      style={{
        width,
        left,
        ...(placeAbove ? { bottom: innerHeight - rect.top + 8 } : { top: below }),
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <FileIcon entry={e} size={14} className="shrink-0 text-steel" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{e.name}</span>
        <span className="shrink-0 text-xs text-stone">{relativeTime(e.updatedAt)}</span>
      </div>
      <p className="line-clamp-8 text-[13px] leading-relaxed whitespace-pre-line text-slate">
        {excerpt || 'This document is empty.'}
      </p>
    </div>
  );
}
