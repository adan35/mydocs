import { describe, expect, it } from 'vitest';
import { renderInlineMarkdown, renderMarkdown } from './render';
import { escapeText, serializeInline } from './rich';

function blocks(md: string) {
  const r = renderMarkdown(md);
  const root = document.createElement('div');
  root.innerHTML = r.html;
  return [...root.querySelectorAll<HTMLElement>('[data-inline]')].map((el) => ({
    el,
    src: r.inlines[Number(el.dataset.inline)]!,
  }));
}

const content = (c: string) => c.replace(/^\[[ xX]\][ \t]?/, '');

describe('serializeInline', () => {
  const samples = [
    'Plain text with **bold**, *italic*, ~~gone~~ and `code`.',
    'A [link](https://example.com "Title") and [[Wiki Page]] and [[Other#Part|alias]].',
    'Image ![alt text](images/a.png) inline.',
    'Math $x^2$ stays.',
    'Escapes: 2 \\* 3 and a\\_b_c and \\[not a link\\].',
    'Line one\nline two',
    'Nested **bold *and italic*** text',
    'Unicode: café, 日本語, emoji 🚀, RTL שלום',
    'Code with backtick `` a`b ``',
  ];
  for (const md of samples) {
    it(`round-trips ${md.slice(0, 40)}`, () => {
      const [b] = blocks(md);
      const out = serializeInline(b!.el, {});
      expect(renderInlineMarkdown(out)).toBe(renderInlineMarkdown(content(b!.src.content)));
    });
  }

  it('reproduces common syntax exactly, so unchanged blocks are never rewritten', () => {
    const md = 'Text **b** *i* `c` [l](u) [[W]] ~~s~~';
    expect(serializeInline(blocks(md)[0]!.el)).toBe(md);
  });

  it('keeps a heading one line and skips its anchor', () => {
    const [h] = blocks('## Hello *world*');
    expect(serializeInline(h!.el, { singleLine: true })).toBe('Hello *world*');
  });

  it('skips the task checkbox (its marker stays in the source)', () => {
    const [li] = blocks('- [ ] buy milk');
    expect(serializeInline(li!.el)).toBe('buy milk');
  });

  it('keeps link destinations when the label changes', () => {
    const [p] = blocks('See [the docs](<https://example.com/a b>) now');
    p!.el.querySelector('a')!.textContent = 'new label';
    expect(serializeInline(p!.el)).toBe('See [new label](https://example.com/a%20b) now');
  });

  it('serializes formatting applied while editing', () => {
    const p = document.createElement('p');
    p.innerHTML = 'make <b>this</b> bold and <i>that</i> italic<br>next';
    expect(serializeInline(p)).toBe('make **this** bold and *that* italic\\\nnext');
  });

  it('refuses elements it cannot represent', () => {
    const p = document.createElement('p');
    p.innerHTML = 'x <video></video>';
    expect(() => serializeInline(p)).toThrow();
  });
});

describe('escapeText', () => {
  it('escapes only what would become syntax', () => {
    expect(escapeText('a*b snake_case _x_ <b> 1 < 2')).toBe('a\\*b snake_case \\_x\\_ \\<b> 1 < 2');
    expect(escapeText('# not a heading', {}, true)).toBe('\\# not a heading');
    expect(escapeText('1. not a list', {}, true)).toBe('1\\. not a list');
    expect(escapeText('a|b', { cell: true })).toBe('a\\|b');
  });
});
