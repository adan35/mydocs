/**
 * A small, strict-enough XML reader and writer for Office Open XML parts.
 *
 * It runs anywhere (including Web Workers, which have no DOMParser), keeps namespace
 * prefixes as written (`w:p`, `x:c`) and never resolves external entities or DTDs.
 */

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}
export type XmlNode = XmlElement | string;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code =
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : '';
    }
    return ENTITIES[e] ?? m;
  });
}

export class XmlError extends Error {
  override name = 'XmlError';
}

/** Parses an XML document and returns its root element. */
export function parseXml(src: string): XmlElement {
  let i = 0;
  const n = src.length;
  const root: XmlElement = { name: '#root', attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  const top = () => stack[stack.length - 1]!;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      const text = src.slice(i);
      if (text.trim() && stack.length > 1) top().children.push(decode(text));
      break;
    }
    if (lt > i && stack.length > 1) top().children.push(decode(src.slice(i, lt)));
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      if (end === -1) throw new XmlError('Unterminated CDATA section');
      top().children.push(src.slice(lt + 9, end));
      i = end + 3;
      continue;
    }
    if (src[lt + 1] === '?' || src[lt + 1] === '!') {
      // Declarations, processing instructions and DOCTYPEs are skipped, never interpreted.
      const end = src.indexOf('>', lt);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (src[lt + 1] === '/') {
      const end = src.indexOf('>', lt);
      if (end === -1) throw new XmlError('Unterminated end tag');
      const name = src.slice(lt + 2, end).trim();
      if (stack.length > 1 && top().name === name) stack.pop();
      else throw new XmlError(`Unexpected </${name}>`);
      i = end + 1;
      continue;
    }
    // Start tag.
    let j = lt + 1;
    while (j < n && !/[\s/>]/.test(src[j]!)) j++;
    const el: XmlElement = { name: src.slice(lt + 1, j), attrs: {}, children: [] };
    for (;;) {
      while (j < n && /\s/.test(src[j]!)) j++;
      if (j >= n) throw new XmlError('Unterminated start tag');
      if (src[j] === '>' || (src[j] === '/' && src[j + 1] === '>')) break;
      const eq = src.indexOf('=', j);
      if (eq === -1) throw new XmlError('Malformed attribute');
      const key = src.slice(j, eq).trim();
      let k = eq + 1;
      while (/\s/.test(src[k]!)) k++;
      const q = src[k];
      if (q !== '"' && q !== "'") throw new XmlError('Unquoted attribute');
      const close = src.indexOf(q, k + 1);
      if (close === -1) throw new XmlError('Unterminated attribute');
      el.attrs[key] = decode(src.slice(k + 1, close));
      j = close + 1;
    }
    top().children.push(el);
    if (src[j] === '/') {
      i = j + 2;
    } else {
      stack.push(el);
      i = j + 1;
    }
  }
  const first = root.children.find((c): c is XmlElement => typeof c !== 'string');
  if (!first) throw new XmlError('No root element');
  return first;
}

/** Local name without the namespace prefix. */
export const local = (name: string) => name.slice(name.indexOf(':') + 1);

export function isEl(n: XmlNode | undefined): n is XmlElement {
  return !!n && typeof n !== 'string';
}

/** Direct children with this local name. */
export function kids(el: XmlElement, name?: string): XmlElement[] {
  return el.children.filter((c): c is XmlElement => isEl(c) && (!name || local(c.name) === name));
}

export function kid(el: XmlElement | undefined, name: string): XmlElement | undefined {
  return el ? kids(el, name)[0] : undefined;
}

/** All descendants with this local name, in document order. */
export function descendants(el: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (e: XmlElement) => {
    for (const c of e.children) {
      if (!isEl(c)) continue;
      if (local(c.name) === name) out.push(c);
      walk(c);
    }
  };
  walk(el);
  return out;
}

/** An attribute by local name (`w:val` and `val` both match `val`). */
export function attr(el: XmlElement | undefined, name: string): string | undefined {
  if (!el) return undefined;
  if (name in el.attrs) return el.attrs[name];
  for (const k in el.attrs) if (local(k) === name) return el.attrs[k];
  return undefined;
}

export function textOf(el: XmlElement): string {
  let s = '';
  for (const c of el.children) s += typeof c === 'string' ? c : textOf(c);
  return s;
}

// ------------------------------------------------------------------ writing

/** Escapes text and attribute values; drops characters XML 1.0 can't carry. */
export function esc(s: string): string {
  return (
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
  );
}

/** Builds an element string: `tag('w:p', {}, inner)`. */
export function tag(
  name: string,
  attrs: Record<string, string | number | undefined> = {},
  inner?: string,
): string {
  let a = '';
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) a += ` ${k}="${esc(String(v))}"`;
  return inner === undefined || inner === '' ? `<${name}${a}/>` : `<${name}${a}>${inner}</${name}>`;
}

export const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
