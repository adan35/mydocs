/** Lazily loads Mermaid (it's large) and renders diagram placeholders in `root`. */
let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;
let counter = 0;
let currentTheme: 'default' | 'dark' | null = null;

function loadMermaid() {
  mermaidPromise ??= import('mermaid').then((m) => m.default);
  return mermaidPromise;
}

const cache = new Map<string, string>();

export async function renderMermaidIn(root: HTMLElement, dark: boolean): Promise<void> {
  const blocks = [...root.querySelectorAll<HTMLElement>('.mermaid-block')];
  if (!blocks.length) return;
  const mermaid = await loadMermaid();
  const theme = dark ? 'dark' : 'default';
  if (currentTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme,
      fontFamily: 'inherit',
      suppressErrorRendering: true,
    });
    currentTheme = theme;
    cache.clear();
  }
  for (const block of blocks) {
    if (block.dataset.rendered) continue;
    const src = block.querySelector('code')?.textContent ?? '';
    const id = `mermaid-${++counter}`;
    try {
      let svg = cache.get(src);
      if (!svg) {
        ({ svg } = await mermaid.render(id, src));
        cache.set(src, svg);
        if (cache.size > 100) cache.delete(cache.keys().next().value!);
      }
      if (!block.isConnected) return;
      block.innerHTML = svg;
      block.dataset.rendered = src;
      block.classList.remove('mermaid-error');
    } catch {
      block.classList.add('mermaid-error');
      block.dataset.rendered = src;
      const note = document.createElement('p');
      note.className = 'mermaid-error-note';
      note.textContent = 'This diagram has a syntax error, so it is shown as text.';
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = src;
      pre.append(code);
      block.replaceChildren(note, pre);
      // Mermaid can leave its scratch element behind on failure.
      document.getElementById(`d${id}`)?.remove();
      document.getElementById(id)?.remove();
    }
  }
}
