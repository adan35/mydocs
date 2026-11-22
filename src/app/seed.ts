import type { Workspace } from './workspace';

const WELCOME = `# Welcome to My Doc

My Doc is one place for every document. Your files stay plain Markdown and text, so they're always yours to take anywhere.

## Start here

- **Create** a document with **Alt + N**, or use **New document** in the sidebar.
- **Import** an existing folder: drag it onto the sidebar, or use *Import* from the command palette (**Ctrl/Cmd + K**).
- **Find anything** with **Alt + S** (open a document) or **Ctrl/Cmd + Shift + F** (search everything).
- **Organize** with folders, favorites and #tags.

Everything saves automatically while you type.

## Linking documents

Link to another document with a normal Markdown link, like the [Markdown guide](./Guides/Markdown%20guide.md), or with a wiki link: [[Keyboard shortcuts]]. When you rename or move a document, My Doc updates the links that point to it.

Documents that link here appear under **Backlinks** in the side panel.

## Your data

Documents are stored in this browser on this device. Export a document, a folder or the whole workspace as Markdown or a .zip at any time.

#welcome
`;

const MARKDOWN_GUIDE = `---
tags: [guide, markdown]
---

# Markdown guide

A quick tour of what My Doc renders.

## Text

**Bold**, *italic*, ~~strikethrough~~, \`inline code\` and [links](https://commonmark.org).

> Blockquotes are great for callouts and citations.

## Lists

1. Ordered
2. Lists
   - with nesting

- [x] Task lists
- [ ] Click a checkbox in the preview to toggle it

## Code

\`\`\`ts
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

## Tables

| Feature | Supported |
| --- | :---: |
| Tables | Yes |
| Footnotes | Yes[^1] |

## Math

Inline $E = mc^2$ and display math:

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$

## Diagrams

\`\`\`mermaid
flowchart LR
  Import --> Organize --> Write --> Search --> Export
\`\`\`

[^1]: Footnotes appear at the end of the document.
`;

const SHORTCUTS = `# Keyboard shortcuts

Press **Ctrl/Cmd + /** anywhere to see and search every shortcut. None of them clash with your browser's own keys, so they work the same in a browser tab and in the installed apps.

| Action | Shortcut |
| --- | --- |
| Show all shortcuts | Ctrl/Cmd + / |
| Command palette | Ctrl/Cmd + K |
| Search files by name | Alt + S |
| Search everything | Ctrl/Cmd + Shift + F |
| New document | Alt + N |
| New from template | Alt + T |
| Ask AON | Alt + A |
| Open the next / previous file in Files | Ctrl + Alt + Down / Up |
| Next / previous tab | Alt + . / Alt + , |
| Close tab / reopen closed tab | Alt + W / Alt + Shift + W |
| Switch source / read | Ctrl/Cmd + Alt + S |
| Reading mode | Alt + R |
| Save now | Ctrl/Cmd + S |
| Find in document | Ctrl/Cmd + F |
| Bold / Italic | Ctrl/Cmd + B / I |
| Insert link | Ctrl/Cmd + Shift + K |
| Toggle sidebar | Ctrl/Cmd + \\\\ |
| Close overlays | Esc |

Back to [[Welcome to My Doc]].
`;

/** Creates starter content in a brand-new workspace. */
export async function seedWorkspace(ws: Workspace) {
  const welcome = await ws.createFile(null, 'Welcome to My Doc.md', WELCOME);
  const guides = await ws.createFolder(null, 'Guides');
  await ws.createFile(guides.id, 'Markdown guide.md', MARKDOWN_GUIDE);
  await ws.createFile(guides.id, 'Keyboard shortcuts.md', SHORTCUTS);
  return welcome;
}
