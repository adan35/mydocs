# Architecture

My Doc is a single-page app with no server. It is built with Vite, React 19, strict TypeScript, Tailwind CSS v4 and Zustand. Code is layered by folder, and each layer only depends on the layers below it.

```
src/
  domain/         Pure types and rules. No browser APIs, no React.
  storage/        The WorkspaceStore interface and its implementations.
  lib/markdown/   Markdown rendering, sanitizing and Mermaid.
  app/            Application services and state: workspace, indexes, stores, actions.
  ui/             React components. Talks to app/, never to storage/.
```

## Domain (`src/domain`)

Pure functions with unit tests in `domain.test.ts`.

| Module             | Responsibility                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `types.ts`         | `Entry` (file or folder), `Version`, `WorkspaceInfo`, `FileContent`.                                              |
| `tree.ts`          | `Tree`, an immutable indexed snapshot of all entries: children, paths, trash state, move rules. Paths are cached. |
| `names.ts`         | Name validation and sanitizing, unique names (`a (2).md`), file types, MIME types.                                |
| `paths.ts`         | Relative path resolution and normalizing (rejects `..` that escapes the root), href encoding.                     |
| `links.ts`         | Finds Markdown links, image links and wiki links with their source offsets, and rewrites them.                    |
| `tags.ts`          | Reads `#tags` and front-matter tags; adds, removes and renames them in text.                                      |
| `outline.ts`       | Headings and GitHub-style slugs.                                                                                  |
| `markdown-scan.ts` | Line scanner that skips code fences and inline code, shared by links, tags and outline.                           |
| `frontmatter.ts`   | YAML front matter parsing.                                                                                        |
| `templates.ts`     | Document templates.                                                                                               |
| `diff.ts`          | Line diff for version history.                                                                                    |
| `tasks.ts`         | Task checkbox toggling and word counts.                                                                           |
| `table.ts`         | GFM table parsing, editing operations and padded serializing for the table editor.                                |
| `query.ts`         | Search query parsing: free text, `"phrases"`, `-exclusions`, `tag:`, `folder:`, `type:`, date ranges.             |
| `mentions.ts`      | Plain-text mentions of a document name outside code and links, and linking the first one.                         |
| `graph-layout.ts`  | A small force-directed layout (springs, grid-based repulsion) for the graph view.                                 |

Every entry has a stable random id. Names and paths can change; ids never do. Tabs, favorites, recents, versions and links all refer to ids.

## Storage (`src/storage`)

`WorkspaceProvider` lists, creates, renames and deletes workspaces. `WorkspaceStore` reads and writes one workspace. All writes go through one method:

```ts
commit(changes: ChangeSet): Promise<void>
```

A `ChangeSet` holds entry puts and deletes, content puts and version puts and deletes. Each commit is one transaction, so it applies completely or not at all.

There are two implementations:

- `indexeddb.ts`: one IndexedDB database per workspace (`mydoc-ws-<id>`) with `entries`, `contents`, `versions` and `meta` stores, plus a `mydoc-registry` database listing workspaces. Metadata and content are stored separately, so the tree loads without reading file bodies.
- `memory.ts`: an in-memory store for tests. `failNextCommit()` simulates write failures.

A future store (real folders on disk, or a server) only has to implement these two interfaces.

## Application layer (`src/app`)

**`Workspace`** (`workspace.ts`) is the only writer. It keeps entries and text in memory and exposes operations such as `createFile`, `createFiles`, `saveText`, `rename`, `move`, `duplicate`, `trash`, `restore`, `deletePermanently`, versions and tag edits.

- Mutations run one at a time through a promise queue, so they never interleave.
- In-memory state changes only after the store commit succeeds. A failed write leaves the app showing what is actually saved.
- Each mutation emits a `tree` or `content` event.
- Rename and move rewrite relative links and wiki links in other documents, in the same commit.
- Trash sets `trashedAt` on the top entry only. Descendants count as trashed through `Tree.isTrashed`, so restoring the folder restores everything inside it as it was.
- Versions snapshot the previous text when a save comes more than 5 minutes after the last snapshot, keeping at most 50 per document. Import replacements and restores always snapshot first.

**Tab ownership** (`ownership.ts`): every tab keeps the workspace in memory and writes whole entry records, so only one tab may own the data. The owner holds an exclusive Web Lock (`mydoc-owner`). Other tabs show "open in another tab"; **Use here** posts a hand-over request on a `BroadcastChannel`, the owner flushes saves and recovery drafts, clears its buffers and releases the lock, and the new owner reloads from storage. `Workspace` also refuses commits while the tab isn't the owner.

**`WorkspaceSession`** (`session.ts`) owns the derived indexes and keeps them current from workspace events:

- `KnowledgeIndex` (`knowledge.ts`): tags and links per document, backlinks, broken links. Nothing here is stored; it is rebuilt from the files on open.
- `SearchIndex` (`search.ts`): MiniSearch over name, path, tags and content with prefix and fuzzy matching, field boosts, filters and snippets. Queries go through `parseQuery`; operators filter the ranked results (or, with no free text, list matching documents newest first).
- `KnowledgeIndex` also answers related documents (links, shared tags and link targets, folder) and unlinked mentions, computed on demand when the Links panel is open. `graph.ts` builds the link graph for the lazily loaded graph view.

**Stores** (Zustand):

- `app-store.ts`: the open workspace and session, the workspace list, first-run seeding, persistent-storage request.
- `editor-store.ts`: open tabs and their buffers, autosave with retry backoff, recovery drafts, session restore, external content changes.
- `settings-store.ts`, `ui-store.ts`: user settings and layout, saved to `localStorage`.
- `router.ts`: hash routes (`#/doc/<id>`, `#/folder/<id>`, `#/search`, …).
- `dialog-store.ts`, `toast-store.ts`: promise-based dialogs and toasts.

**`actions.ts`** holds every user command (open, create, rename, move, trash with undo, export…) so the sidebar, menus, palette and shortcuts share one implementation and one error handling path.

**Import and export**: `importer.ts` reads picked files, dropped folders and zips, validates every path, skips ignored folders, applies size limits, asks about conflicts and creates new files in batches of 250 per commit. `exporter.ts` builds zips with fflate and standalone HTML documents. `attachments.ts` saves pasted and dropped images.

## Markdown (`src/lib/markdown`)

`renderMarkdown()` uses markdown-it with footnotes, task lists, KaTeX and highlight.js, plus custom rules for wiki links, source line numbers (`data-line`, used for scroll sync and task toggling), heading slugs (`data-heading`) and Mermaid placeholders. The output always passes through `sanitizeHtml()` (DOMPurify) before it reaches the DOM. Mermaid is loaded only when a document contains a diagram, and renders with `securityLevel: 'strict'`.

## UI (`src/ui`)

- `layout/`: `AppShell` (responsive frame, drawer, file drop target), `Sidebar`, `FileTree` (virtualized ARIA tree), `TabBar`, `Palette` (command palette and quick open), `MobileNav`, global shortcuts.
- `document/`: `DocumentView` (edit, split and preview modes), `Preview`, `RightPanel` (outline, links, info), `SaveStatus`, `BinaryView`.
- `editor/`: the CodeMirror setup and the formatting toolbar. One `EditorState` is cached per open document, so switching tabs keeps undo history, selection and scroll.
- `views/`: Home, Folder, Search, Favorites, Recent, Tags, Trash, Settings.
- `components/` and `dialogs/`: menus (popover on desktop, bottom sheet on phones), dialogs, toasts, empty states, version history, shortcuts help.

Layout tiers: phone below 768px (bottom navigation, full-screen views), tablet from 768px to 1099px (sidebar as a drawer), desktop from 1100px, and wide from 1280px (right panel shown beside the document).

`DocumentView` and the Markdown renderer are split into a lazily loaded chunk, as are Mermaid and KaTeX.

## Offline (`src/pwa`)

A small Vite plugin in `vite.config.ts` emits `sw.js` from `src/pwa/sw-template.js` with the exact list of built files, so the whole app, lazy chunks included, is cached on first visit. Navigations are network-first with the cached shell as the offline fallback; other same-origin files are cache-first. The cache name is a hash of the file list, and old caches are removed on activation. Updates wait until the user accepts the "new version" toast, which saves open documents first. Documents never pass through the service worker; they live in IndexedDB. Registration runs only in production builds over HTTPS or on localhost.

## Theming

Design tokens are CSS variables in `src/styles.css`, taken from the Notion design reference for light mode, with a matching dark palette. Tailwind reads them through `@theme inline`. `public/theme-init.js` sets `data-theme` before first paint to avoid a flash of the wrong theme.

## Performance

Measured with a generated workspace of 5,000 Markdown documents (`PERF=1 npx vitest run src/app/perf.test.ts`, and the same workspace imported in Chromium):

| Operation                              | Time        |
| -------------------------------------- | ----------- |
| Import 5,000 files (in memory)         | about 1 s   |
| Import a 5,000-file zip in the browser | about 5 s   |
| Reopen and rebuild all indexes         | about 0.5 s |
| Full-text search                       | under 20 ms |
| Rename a folder (with link rewriting)  | about 0.1 s |
