import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './render';

const html = (md: string) => renderMarkdown(md).html;

describe('renderMarkdown', () => {
  it('renders GFM features with source lines and heading ids', () => {
    const out = html(
      '# Title\n\n- [ ] task\n- [x] done\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nText[^1]\n\n[^1]: Note',
    );
    expect(out).toContain('<h1 data-line="0" data-heading="title">');
    expect(out).toContain('class="task-list-item-checkbox"');
    expect(out).toContain('<div class="table-wrap">');
    expect(out).toContain('footnote');
  });
  it('renders math, code and mermaid placeholders', () => {
    const out = html('$x^2$\n\n```ts\nconst a = 1;\n```\n\n```mermaid\ngraph TD; A-->B\n```');
    expect(out).toContain('katex');
    expect(out).toContain('hljs-keyword');
    expect(out).toMatch(/<div class="mermaid-block" data-line="\d+"><pre><code>graph TD; A--&gt;B/);
  });
  it('keeps line numbers correct after front matter', () => {
    const out = html('---\ntags: [a]\n---\n# H');
    expect(out).toContain('<h1 data-line="3"');
    expect(renderMarkdown('---\ntitle: x\n---\nbody').frontMatter).toEqual({ title: 'x' });
  });

  describe('security', () => {
    const attacks = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '[click](javascript:alert(1))',
      '<a href="javascript:alert(1)">x</a>',
      '<iframe src="https://evil.example"></iframe>',
      '<svg><script>alert(1)</script></svg>',
      '<svg onload=alert(1)></svg>',
      '<form action="https://evil"><input type=password></form>',
      '<div style="position:fixed;inset:0">overlay</div>',
      '<a href="data:text/html,<script>alert(1)</script>">x</a>',
      '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
      '<object data="x.swf"></object><embed src="x">',
      '<meta http-equiv="refresh" content="0;url=https://evil">',
      '<base href="https://evil/">',
      '$\\href{javascript:alert(1)}{x}$',
      '<details open ontoggle=alert(1)>',
    ];
    for (const attack of attacks) {
      it(`neutralizes ${attack.slice(0, 40)}`, () => {
        const out = html(attack);
        expect(out).not.toMatch(/<script/i);
        expect(out).not.toMatch(/\son\w+=/i);
        expect(out).not.toMatch(/(href|src|action)="\s*javascript:/i);
        expect(out).not.toMatch(/<(iframe|object|embed|form|meta|base|style)\b/i);
        expect(out).not.toMatch(/position\s*:\s*fixed/i);
        expect(out).not.toMatch(/href="data:/i);
      });
    }
    it('opens external links safely', () => {
      const out = html('[x](https://example.com)');
      expect(out).toContain('target="_blank"');
      expect(out).toContain('rel="noopener noreferrer nofollow"');
    });
    it('keeps relative links and images', () => {
      const out = html('[doc](./a.md) ![img](./assets/p.png)');
      expect(out).toContain('href="./a.md"');
      expect(out).toContain('src="./assets/p.png"');
    });
  });
});

describe('wiki links', () => {
  it('renders [[Target]], sections and labels as resolvable links', () => {
    const { html } = renderMarkdown(
      'See [[Keyboard shortcuts]], [[Guide#Install|setup]] and `[[code]]`.',
    );
    expect(html).toContain('data-wiki="Keyboard shortcuts"');
    expect(html).toContain('href="Keyboard%20shortcuts.md"');
    expect(html).toContain('data-fragment="Install"');
    expect(html).toContain('>setup</a>');
    expect(html).toContain('<code>[[code]]</code>');
  });

  it('renders ![[image]] embeds as images and ![[Note]] as a link', () => {
    const { html } = renderMarkdown('![[site photo.png|Site]] and ![[Methods]]');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const img = doc.querySelector('img')!;
    expect(img.getAttribute('data-wiki')).toBe('site photo.png');
    expect(img.getAttribute('alt')).toBe('Site');
    expect(doc.querySelector('a.wiki-link')?.textContent).toBe('Methods');
    expect(doc.body.textContent).not.toContain('!');
  });

  it('cannot smuggle markup through a wiki link', () => {
    const { html } = renderMarkdown('[[<img src=x onerror=alert(1)>|"><script>x</script>]]');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelectorAll('script, img, [onerror]')).toHaveLength(0);
    expect(doc.querySelector('a.wiki-link')?.textContent).toBe('"><script>x</script>');
  });

  it('renders callouts with a title and escapes it', () => {
    const { html } = renderMarkdown(
      '> [!WARNING] Back up <b>first</b>\n> The body text.\n\n> [!tip]\n> Short.',
    );
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const [warn, tip] = doc.querySelectorAll('blockquote');
    expect(warn!.className).toBe('callout callout-warning');
    expect(warn!.querySelector('.callout-title')?.textContent).toBe('Back up <b>first</b>');
    expect(warn!.querySelector('b')).toBeNull();
    expect(warn!.textContent).toContain('The body text.');
    expect(warn!.textContent).not.toContain('[!WARNING]');
    expect(tip!.querySelector('.callout-title')?.textContent).toBe('Tip');
  });
});
