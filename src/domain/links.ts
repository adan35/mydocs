import { blankInlineCode, proseLines } from './markdown-scan';
import { isExternalHref, resolvePath, safeDecode } from './paths';

export type LinkKind = 'markdown' | 'wiki' | 'image';

export interface RawLink {
  kind: LinkKind;
  /** The target as written: a relative path for markdown links, a name for wiki links. */
  target: string;
  /** Optional `#fragment`. */
  fragment?: string;
  /** `![[...]]`: an embedded image or note, written as a wiki link. */
  embed?: boolean;
  /** Offsets of the target text within the source (for rewriting). */
  start: number;
  end: number;
}

// [text](target "title") / ![alt](target). Target may be wrapped in <...>.
const MD_LINK_RE =
  /(!?)\[(?:[^\]\\]|\\.)*\]\(\s*(<[^>\n]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const WIKI_RE = /(!?)\[\[([^\]|#\n]+)(#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g;

/** Extracts internal (non-external) links from Markdown, skipping code. */
export function extractLinks(src: string): RawLink[] {
  const links: RawLink[] = [];
  for (const line of proseLines(src)) {
    const text = blankInlineCode(line.text);
    for (const m of text.matchAll(MD_LINK_RE)) {
      let target = m[2]!;
      let targetStart = line.offset + m.index! + m[0].indexOf(target, m[0].indexOf(']('));
      if (target.startsWith('<')) {
        target = target.slice(1, -1);
        targetStart += 1;
      }
      if (!target || isExternalHref(target) || target.startsWith('#')) continue;
      const hash = target.indexOf('#');
      const path = hash >= 0 ? target.slice(0, hash) : target;
      links.push({
        kind: m[1] ? 'image' : 'markdown',
        target: safeDecode(path),
        fragment: hash >= 0 ? target.slice(hash + 1) : undefined,
        start: targetStart,
        end: targetStart + path.length,
      });
    }
    for (const m of text.matchAll(WIKI_RE)) {
      const name = m[2]!.trim();
      const start = line.offset + m.index! + m[1]!.length + 2;
      links.push({
        kind: 'wiki',
        target: name,
        fragment: m[3]?.slice(1),
        embed: !!m[1] || undefined,
        start,
        end: start + m[2]!.length,
      });
    }
  }
  // Markdown and wiki links are found in separate passes; callers rewrite in text order.
  return links.sort((a, b) => a.start - b.start);
}

/** Resolves a link to a workspace path (markdown/image) or returns null (wiki links resolve by name). */
export function resolveLinkPath(fromDir: string, link: RawLink): string | null {
  if (link.kind === 'wiki') return null;
  return resolvePath(fromDir, link.target);
}

/**
 * Applies replacements to link targets. `replace` returns a new target or null to keep it.
 * Used to keep links working when documents are renamed or moved.
 */
export function rewriteLinks(src: string, replace: (link: RawLink) => string | null): string {
  const links = extractLinks(src); // in text order, so `last` only moves forward
  let out = '';
  let last = 0;
  for (const link of links) {
    const next = replace(link);
    if (next === null) continue;
    out += src.slice(last, link.start) + next;
    last = link.end;
  }
  return last === 0 ? src : out + src.slice(last);
}

export interface ExternalLink {
  href: string;
  /** The link text, or the address for autolinks. */
  label: string;
}

const AUTOLINK_RE = /<((?:https?|mailto):[^>\s]+)>/gi;

/** Web and mail links in Markdown (`[text](https://…)` and `<https://…>`), skipping code. */
export function extractExternalLinks(src: string): ExternalLink[] {
  const seen = new Map<string, ExternalLink>();
  for (const line of proseLines(src)) {
    const text = blankInlineCode(line.text);
    for (const m of text.matchAll(MD_LINK_RE)) {
      if (m[1]) continue;
      const href = m[2]!.replace(/^<|>$/g, '');
      // Only web and mail addresses: the panel opens these, so no javascript: or data:.
      if (!/^(?:https?:|mailto:)/i.test(href) || seen.has(href)) continue;
      const label = m[0].slice(1, m[0].indexOf('](')).replace(/\\(.)/g, '$1').trim();
      seen.set(href, { href, label: label || href });
    }
    for (const m of text.matchAll(AUTOLINK_RE)) {
      if (!seen.has(m[1]!)) seen.set(m[1]!, { href: m[1]!, label: m[1]! });
    }
  }
  return [...seen.values()];
}
