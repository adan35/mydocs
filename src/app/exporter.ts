import { zipSync } from 'fflate';
import type { Entry, EntryId } from '@/domain/types';
import { baseName, isMarkdownName } from '@/domain/names';
import type { Workspace } from './workspace';
import { markdownToPlainText } from './search';

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Builds a zip of `rootId` (or the whole workspace when null), preserving structure. */
export async function buildZip(ws: Workspace, rootId: EntryId | null): Promise<Uint8Array> {
  const tree = ws.tree;
  const files: Record<string, Uint8Array | Record<string, never>> = {};
  const add = async (e: Entry, prefix: string) => {
    if (e.trashedAt !== undefined) return;
    const path = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.kind === 'folder') {
      const children = tree.rawChildren(e.id).filter((c) => c.trashedAt === undefined);
      if (!children.length) files[path] = {};
      for (const c of children) await add(c, path);
      return;
    }
    const blob = await ws.readBlob(e.id);
    files[path] = blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array();
  };
  const roots = rootId ? tree.childrenOf(rootId) : tree.childrenOf(null);
  for (const e of roots) await add(e, '');
  return zipSync(files as Parameters<typeof zipSync>[0], { level: 6 });
}

export async function exportZip(ws: Workspace, rootId: EntryId | null) {
  const data = await buildZip(ws, rootId);
  const name = rootId ? ws.get(rootId)!.name : ws.name;
  downloadBlob(
    new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/zip' }),
    `${name}.zip`,
  );
}

export async function exportFile(ws: Workspace, id: EntryId) {
  const e = ws.get(id);
  if (!e) return;
  const blob = await ws.readBlob(id);
  if (blob) downloadBlob(blob, e.name);
}

const HTML_STYLES = `
body{margin:0;background:#fff;color:#1a1a1a;font:16px/1.65 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:760px;margin:0 auto;padding:48px 24px}
h1,h2,h3,h4{line-height:1.25;font-weight:600;margin:1.6em 0 .6em}h1{font-size:2.2em;margin-top:0}h2{font-size:1.6em}h3{font-size:1.25em}
a{color:#0075de}code{font:.9em "JetBrains Mono",ui-monospace,monospace;background:#f6f5f4;padding:.15em .35em;border-radius:4px}
pre{background:#f6f5f4;border:1px solid #e5e3df;border-radius:8px;padding:16px;overflow:auto}pre code{background:none;padding:0}
blockquote{margin:1em 0;padding:.2em 1em;border-left:3px solid #c8c4be;color:#5d5b54}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #e5e3df;padding:6px 12px;text-align:left}th{background:#fafaf9}
img{max-width:100%}.heading-anchor{display:none}.code-lang{display:none}hr{border:0;border-top:1px solid #e5e3df}
.contains-task-list{list-style:none;padding-left:1em}
blockquote.callout{border-left-color:#5645d4;background:#f4f2fc;color:#1a1a1a;border-radius:0 8px 8px 0;padding:.6em 1em}.callout-title{display:block;font-weight:600}
`;

/** Standalone HTML (sanitized, no scripts) that opens anywhere. */
export async function documentHtml(title: string, markdown: string): Promise<string> {
  // Loaded on demand: the renderer is large and only needed for exports and the preview.
  const { renderMarkdown } = await import('@/lib/markdown/render');
  // Headings carry data-heading in the app; real ids make anchors work in the exported file.
  const html = renderMarkdown(markdown).html.replace(/ data-heading="/g, ' id="');
  const safeTitle = title.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.css">
<style>${HTML_STYLES}</style></head>
<body><main>${html}</main></body></html>`;
}

export async function exportHtml(ws: Workspace, id: EntryId) {
  const e = ws.get(id);
  if (!e) return;
  const text = await ws.readText(id);
  const html = isMarkdownName(e.name)
    ? await documentHtml(baseName(e.name), text)
    : await documentHtml(e.name, '~~~~~~~~\n' + text + '\n~~~~~~~~');
  downloadBlob(new Blob([html], { type: 'text/html' }), `${baseName(e.name)}.html`);
}

/** Plain text: Markdown syntax is dropped so the words read cleanly anywhere. */
export async function exportText(ws: Workspace, id: EntryId) {
  const e = ws.get(id);
  if (!e) return;
  const text = await ws.readText(id);
  const plain = isMarkdownName(e.name) ? markdownToPlainText(text) : text;
  downloadBlob(new Blob([plain], { type: 'text/plain;charset=utf-8' }), `${baseName(e.name)}.txt`);
}
