import { renderInlineMarkdown } from '@/lib/markdown/render';

const cache = new Map<string, string>();

/** Display inline Markdown as readable cell text while keeping the source for editing. */
export function markdownCellText(source: string): string {
  const cached = cache.get(source);
  if (cached !== undefined) return cached;
  // Template contents are inert: images and links are never loaded or mounted in the grid.
  const template = document.createElement('template');
  template.innerHTML = renderInlineMarkdown(source);
  for (const image of template.content.querySelectorAll('img')) image.replaceWith(image.alt);
  for (const br of template.content.querySelectorAll('br')) br.replaceWith('\n');
  const text = template.content.textContent ?? '';
  if (cache.size >= 2000) cache.clear();
  cache.set(source, text);
  return text;
}
