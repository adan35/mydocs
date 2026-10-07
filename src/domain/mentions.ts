import { blankInlineCode, proseLines } from './markdown-scan';

/** Blanks out link syntax, HTML and URLs (keeping offsets) so mentions inside them are ignored. */
function blankLinks(text: string): string {
  const blank = (m: string) => ' '.repeat(m.length);
  return text
    .replace(/!?\[\[[^\]\n]*\]\]/g, blank)
    .replace(/!?\[[^\]\n]*\]\([^)\n]*\)/g, blank)
    .replace(/<[^>\n]+>/g, blank)
    .replace(/\bhttps?:\/\/\S+/g, blank);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Plain-text mentions of `name` (whole words, any case) in prose: not in code,
 * front matter, links or URLs. Used for "unlinked references".
 */
export function findMentions(text: string, name: string): { from: number; to: number }[] {
  const needle = name.trim();
  if (needle.length < 3) return [];
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(needle)}(?![\\p{L}\\p{N}_])`, 'giu');
  const out: { from: number; to: number }[] = [];
  for (const line of proseLines(text)) {
    const masked = blankLinks(blankInlineCode(line.text));
    for (const m of masked.matchAll(re)) {
      out.push({ from: line.offset + m.index!, to: line.offset + m.index! + m[0].length });
    }
  }
  return out;
}

/** Turns the first plain mention of `name` into a wiki link, keeping the original wording. */
export function linkFirstMention(text: string, name: string): string | null {
  const hit = findMentions(text, name)[0];
  if (!hit) return null;
  const original = text.slice(hit.from, hit.to);
  const link = original === name ? `[[${name}]]` : `[[${name}|${original}]]`;
  return text.slice(0, hit.from) + link + text.slice(hit.to);
}
