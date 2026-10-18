# Editor upgrade plan (October 2026)

This is the plan for the "one coherent workspace" upgrade: editing modes, scroll sync, rich editing,
contextual toolbars, format conversion and the knowledge graph. It records what was found, what was
decided and how each part is accepted.

## What the inspection found

| Area             | State before this work                                                                                                   | Decision                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Storage          | `Workspace` is the only writer, atomic `ChangeSet` commits, versions, recovery drafts, single-owner tab lock.            | Keep. Add a schema stamp and migration hook; let versions hold binary files (spreadsheets).       |
| Editor           | CodeMirror 6 with a per-document `EditorState` cache inside the `Editor` component.                                      | Replace the cache with a document model (below). It had a data-loss bug (see "Foundations").      |
| Preview          | markdown-it + DOMPurify, `data-line` on top-level blocks only, one-way scroll by nearest line.                           | Extend: source ranges on every block, block-mapped two-way scroll sync, rich editing on blocks.   |
| Modes            | Edit, Split, Preview, plus Focus and Reading.                                                                            | Source, Split, Rich, Read, plus a Sheet view when a document has tables.                          |
| Toolbar          | One Markdown formatting bar.                                                                                             | A ribbon that adapts to the format and the selection, sharing commands with shortcuts/palette.    |
| Conversion       | Export: original, zip, HTML, PDF, txt. Import: any file stored as-is; `.docx`/`.xlsx` were opaque binaries.              | Add a document AST, DOCX/XLSX/CSV/TSV/HTML/TXT adapters, a capability matrix and conversion UI.   |
| Graph            | Canvas force layout, whole/local graph, folder/tag/depth filters, click opens.                                           | Extend: search, type filter, selection card, unresolved and suggested links, duplicate titles.    |
| Links            | Wiki and Markdown links, backlinks, link rewriting on rename/move (same commit), `[[` autocomplete.                      | Keep; add heading completion, unambiguous completion for duplicate names, cached link resolution. |
| Platforms        | Tauri 2 desktop and Capacitor Android/iOS shells around the same web build; `src/platform/` handles saving and printing. | Keep one codebase. New features live in `src/`; platform code only for file saving.               |
| Sync and sharing | None (no backend).                                                                                                       | Out of scope. Stated in the capability matrix.                                                    |

## Architecture decisions

1. **One source of truth per open document.** A document model (`src/app/doc-model.ts`) owns a
   CodeMirror `EditorState` for every open text document, whether or not an editor is on screen.
   Source editing, rich editing in the preview, sheet edits of Markdown tables, toolbar commands and
   task toggles are all transactions on that state. Undo and redo therefore cover every mode, and
   there is no second copy of the text to drift. The visible editor attaches to the model's state
   instead of keeping its own cache.
2. **Markdown stays the file format.** Block identity inside a document is positional (source line
   ranges from markdown-it, mapped through edits); nothing is written into the file to track it, so
   files stay portable.
3. **Rich editing edits blocks, not HTML.** Each rendered block knows the exact source range of its
   inline content. Editing a heading, paragraph, list item or table cell replaces only that range,
   keeping the block prefix (`## `, `- [ ] `, `1. `, `> `, the table row). Inline content is
   serialized from a small allowlist (text, bold, italic, strikethrough, code, links, wiki links,
   images, math, breaks). A block whose rendered form does not serialize back to equivalent
   Markdown opens as source in place instead, so unsupported syntax is never stripped.
4. **Text documents share one AST.** `src/lib/convert/doc-ast.ts` is the intermediate model for
   Markdown, DOCX, HTML and plain text. Spreadsheets use their own model (`Workbook`: sheets, typed
   cells, formulas with cached values, number formats), because rows and cells are not prose.
5. **No large conversion dependencies.** DOCX and XLSX are zip files of XML. `fflate` is already in
   the bundle; a small XML reader and writer cover the subset we support, which keeps control over
   fidelity (formulas with cached values, leading zeros, dates) and works inside a Web Worker.
   `pdfjs-dist` is the one new dependency: the mobile web views cannot show PDFs, and the PDF view
   needs search, page navigation and zoom. It loads only when a PDF is opened.
6. **Conversions run in a worker** and every conversion returns a report of what could not be kept.
   Converting always creates a new document; the original is never replaced.

## Phases, dependencies and acceptance criteria

| Phase                     | Depends on | Acceptance criteria                                                                                                                                                                                                                         |
| ------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Document foundations   | none       | Every edit path goes through the document model; switching tabs, modes and routes never writes one document's text into another; undo works across modes; schema stamp and migration hook.                                                  |
| 2. Editing and sync       | 1          | Split view scrolls both ways by block mapping, stable under edits, resizes and image loads, with a remembered toggle. Rich mode edits headings, paragraphs, list items, cells, links and code keeping type, position and attributes.        |
| 3. Contextual controls    | 1, 2       | Ribbon groups change with format (Markdown, plain text, sheet, PDF) and selection; every control produces a valid change for that format; compact on phones; same commands in palette and shortcuts.                                        |
| 4. Conversion             | 1          | Capability matrix in the UI and docs; DOCX, XLSX, CSV, TSV, HTML, TXT, PDF export (a real file, written by MyDocs); DOCX, XLSX, CSV, TSV, HTML import; table picker; conversion summary; original always kept; exports open in LibreOffice. |
| 5. Knowledge graph        | 1          | Search, folder/tag/type/depth filters, selection with neighbours highlighted, unresolved and suggested links shown distinctly, duplicate titles disambiguated, rename/move/delete handled, positions kept across updates.                   |
| 6. Platform polish, tests | all        | Resizable panels remembered; mobile ribbon stays above the keyboard; e2e for the ten workflows in the brief; screenshots at phone, tablet, laptop and desktop sizes.                                                                        |

## Status (October 12, 2026)

All six phases are implemented. Phase 3 (contextual controls) shipped with phase 2.

| Requirement                           | Where                                                                                | Verified by                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| One document model, undo across modes | `src/app/doc-model.ts`                                                               | `e2e/document-model.spec.ts`, `rich-editing.spec.ts`           |
| Rich editing keeps block identity     | `src/ui/document/rich-editing.ts`                                                    | `e2e/rich-editing.spec.ts` (H2, lists, cells, links, code)     |
| Split-view scroll sync                | `src/ui/document/scroll-sync.ts`                                                     | `scroll-sync.test.ts`, `e2e/scroll-sync.spec.ts`               |
| Contextual ribbon                     | `src/ui/editor/Ribbon.tsx`, `tools.tsx`, `src/ui/sheet/SheetRibbon.tsx`, PDF toolbar | `e2e/workflows.spec.ts` (controls per format)                  |
| Conversion and capability matrix      | `src/lib/convert/`, `src/app/convert.ts`, `docs/FORMATS.md`                          | `docx.test.ts`, `sheet.test.ts`, `e2e/formats.spec.ts`         |
| Exports open in other apps            | DOCX in python-docx and LibreOffice; XLSX in openpyxl and LibreOffice                | Checked by hand during development (fixtures in `fixtures/`)   |
| Knowledge graph                       | `src/app/graph.ts`, `knowledge.ts`, `src/ui/views/GraphView.tsx`                     | `graph.test.ts`, `e2e/knowledge.spec.ts`, `workflows.spec.ts`  |
| Layout at four sizes                  | Phone 390×844, tablet 820×1180, laptop 1366×768, desktop 1920×1080                   | Screenshots; `e2e/responsive.spec.ts` (no horizontal overflow) |

Known limits:

- Word documents are read-only in place; editing means converting to Markdown. Equations, comments,
  tracked changes and page layout are reported, not converted (see `docs/FORMATS.md`).
- The formula engine covers common functions; others keep their saved value and are marked.
- MyDocs has no accounts or shared workspaces, so there are no document permissions to respect in
  the graph, search or previews: everything shown is the user's own local data.
- Sync and sharing are out of scope.
