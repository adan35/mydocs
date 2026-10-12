import { useEffect, useMemo, useRef } from 'react';
import { renderMarkdown } from '@/lib/markdown/render';

/**
 * Read-only rendering of Markdown that is not a workspace document (a Word file's
 * contents, a conversion preview). Images extracted from the source are shown from
 * `media`; links don't navigate.
 */
/** An image with the width it was laid out at in its source document. */
export interface MediaItem {
  blob: Blob;
  width?: number;
}

export function StaticMarkdown({
  text,
  media,
  className = '',
}: {
  text: string;
  media?: Record<string, Blob | MediaItem>;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const html = useMemo(() => renderMarkdown(text).html, [text]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const urls: string[] = [];
    for (const img of el.querySelectorAll('img')) {
      // The effect can run again over the same DOM (its blob URLs revoked), so keep the
      // source as written.
      const src = (img.dataset.src ??= img.getAttribute('src') ?? '');
      const item = media?.[decodeURI(src)];
      const blob = item instanceof Blob ? item : item?.blob;
      if (blob) {
        const url = URL.createObjectURL(blob);
        const width = item instanceof Blob ? undefined : item?.width;
        if (width) {
          img.style.width = `${width}px`;
          img.style.maxWidth = '100%';
        }
        urls.push(url);
        img.src = url;
        img.classList.remove('img-missing');
      } else if (!/^(https?:|data:)/.test(src)) {
        if (!img.alt.startsWith('Image: ')) img.alt = `Image: ${img.alt || src}`;
        img.classList.add('img-missing');
      }
    }
    for (const a of el.querySelectorAll('a'))
      a.addEventListener('click', (e) => e.preventDefault());
    for (const a of el.querySelectorAll('.heading-anchor')) a.remove();
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [html, media]);

  return (
    <article
      ref={ref}
      className={`prose ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
