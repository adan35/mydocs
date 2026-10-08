# My Doc

My Doc is a local-first workspace for documents and Markdown. It combines a file explorer, a Markdown editor and reader, full-text search, tabs, tags, links and backlinks, all in one calm interface with light and dark themes. It works on phones, tablets and desktops.

Your documents stay plain Markdown and text. Everything My Doc adds, like tags and links, is read from the files themselves, so exporting a workspace loses nothing.

## Features

**Files and folders**

- File tree with create, rename, move (drag and drop or dialog), duplicate, favorites and sorting by name, date, type or size.
- List and grid folder views. The tree is virtualized, so workspaces with thousands of files stay responsive.
- Trash with restore, permanent delete, and undo for destructive actions.
- Several workspaces, each stored separately.

**Writing and reading**

- A CodeMirror 6 editor with Markdown highlighting, find and replace, a formatting toolbar (headings, lists, checklists, links, tables, equations) and shortcuts, a monospace or sans-serif font, optional line numbers, word wrap and tab size.
- Type `/` for a block menu (headings, lists, checklists, callouts, tables, code, diagrams, math, a table of contents, today's date…), filtered as you type.
- A visual table editor: add, move, delete and align rows and columns; the result stays plain Markdown.
- Edit, Split and Preview modes per document, plus Focus mode, Reading mode and optional typewriter scrolling.
- The preview supports GitHub-style Markdown: tables, task lists (clickable), footnotes, KaTeX math, Mermaid diagrams, syntax-highlighted code with a copy button, and YAML front matter.
- Paste or drop an image into a document to save it in an `assets/` folder next to the document and link it.
- Plain-text and code files open in the same editor. Images show a preview. PDFs and other binary files show an info panel with download, and PDFs and images can open in a new tab.
- An outline of headings with foldable sections; words, characters, lines and reading time.
- Front matter shows as a properties table above the rendered document. Callouts (`> [!NOTE]`, `> [!WARNING]`…) render with a title.
- Click an image in the preview to zoom, open it full size, copy or download it.

**Saving and history**

- Autosave while you type (the delay is configurable), with retries if a write fails.
- Unsaved edits are kept as a recovery draft when the tab closes or crashes, and restored on the next launch.
- My Doc works in one browser tab at a time, so two tabs can never overwrite each other. A second tab offers **Use here**, which saves everything in the first tab and hands over.
- Version history: a snapshot is taken after a 5-minute pause in editing (up to 50 per document), with a line diff and one-click restore.

**Finding things**

- Quick open (Ctrl/Cmd + P) with fuzzy matching on names, paths and tags, ranking exact and prefix matches first and documents you open often or recently higher.
- Full-text search (Ctrl/Cmd + Shift + F) with typo tolerance, highlighted plain-text snippets, and filters by type, folder, tag and date modified. Opening a result jumps to the first match.
- Search operators: `"exact phrase"`, `-exclude`, `tag:idea` (or `#idea`), `folder:Projects`, `type:md`, `modified:week`, `created:2026-10`, `modified:>2026-09-01`.
- Command palette (Ctrl/Cmd + K or Ctrl/Cmd + Shift + P) for every command.
- Home screen with recent documents, favorites and quick actions.

**Knowledge**

- Relative Markdown links (`[x](./notes/a.md)`) and wiki links (`[[Name]]`, `[[Name#Section]]`, `[[Name|Label]]`) open the target document. Broken links are marked. `![[image.png]]` embeds an image found by name.
- Renaming or moving a document rewrites the links that point to it.
- Backlinks, outgoing links, broken links, related documents and unlinked mentions (with one-click **Link**) appear in the side panel.
- Hovering an internal link in the preview shows a short preview of the target.
- An optional graph view of how documents link (whole workspace or local to one document, filter by folder or tag, zoom, pan, drag, click to open).
- Daily notes: Ctrl/Cmd + Shift + D opens today's note, creating it in a configurable folder.
- Tags from `#tag` in text or `tags:` in front matter, with a tag browser. You can add, remove and rename tags across documents.
- Twelve built-in templates (meeting notes, bug report, technical design, software architecture, and others), plus your own: any Markdown file in a top-level `Templates` folder, or **Save as template** from a document.

**Import and export**

- Import files, whole folders or zip archives, by picker or drag and drop. Folder structure is kept, `.git` and `node_modules` are skipped, and name conflicts can be replaced, skipped or kept as copies.
- In Chrome and Edge, text files imported with the Files… or Folder… picker stay linked to the original file: every save is also written back to it (the browser asks once for permission). Other browsers keep the edited copy in My Doc; export it to save it back.
- Any text file opens in the editor, including dotfiles and unfamiliar extensions.
- Export a document as Markdown, plain text, standalone HTML, or PDF (through the browser's print dialog). Export a folder or the whole workspace as a zip.

**Offline and install**

- After the first visit the whole app loads without a network connection. It can be installed as an app (from the browser's install button or **Install My Doc as an app** in the command palette). When a new version is downloaded, a toast offers to reload.

**Interface**

- Tabs with pinning, drag reordering, close others / to the right, reopen closed tab, and session restore.
- A layout for each screen size: a bottom navigation bar on phones, a drawer on tablets, and resizable side panels on desktop.
- Light, dark and system themes, with a one-click toggle in the sidebar; comfortable or compact density; adjustable font size and reading width.
- Keyboard shortcuts for everything (open **Keyboard shortcuts** from the command palette for the full list).

## Where your data lives

Everything is stored in your browser's IndexedDB on this device. Nothing is uploaded, and there are no accounts or sync. My Doc asks the browser for persistent storage so data isn't evicted under storage pressure. To back up or move a workspace, export it as a zip from Settings.

## Getting started

Requires Node.js 22 or later.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve the production build
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for tests and tooling, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the code is organized.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Development](docs/DEVELOPMENT.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Engineering brief](docs/ENGINEERING_BRIEF.md): the original plan and decisions

## Not yet built

These are planned and are not in the app today: opening a folder on disk as a live workspace (new files and changes made outside My Doc), cloud storage and sync, accounts, sharing, comments and collaboration, a Typora-style live preview editing mode, two different documents side by side, configurable shortcuts, and AI features.
