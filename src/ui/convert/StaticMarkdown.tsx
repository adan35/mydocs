import { useEffect, useMemo, useRef } from 'react';
import { renderMarkdown } from '@/lib/markdown/render';

/**
 * Read-only rendering of Markdown that is not a workspace document (a Word file's
 * contents, a conversion preview). Images extracted from the source are shown from
 * `media`; links don't navigate.
 */
export function StaticMarkdown({
  text,
  media,
  className = '',
}: {
  text: string;
  media?: Record<string, Blob>;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const html = useMemo(() => renderMarkdown(text).html, [text]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const urls: string[] = [];
    for (const img of el.querySelectorAll('img')) {
      const src = img.getAttribute('src') ?? '';
      const blob = media?.[decodeURI(src)];
      if (blob) {
        const url = URL.createObjectURL(blob);
        urls.push(url);
        img.src = url;
      } else if (!/^(https?:|data:)/.test(src)) {
        img.alt = `Image: ${img.alt || src}`;
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
