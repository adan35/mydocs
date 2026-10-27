# Security

My Doc runs entirely in the browser and has no server, accounts or network sync. The main risk is untrusted content: Markdown, HTML, SVG, file names and archives that a user imports from elsewhere. Every document is treated as untrusted.

## Rendering

- Markdown is rendered with markdown-it, then sanitized with DOMPurify before it is inserted into the page (`src/lib/markdown/sanitize.ts`).
- Scripts, event handlers, `style`, `iframe`, `object`, `embed`, `form`, `base`, `meta` and `link` elements are removed, as are `javascript:` and other unsafe URL schemes.
- Inline styles that could position or overlay content over the app's UI (`position`, `z-index`, `url()` and similar) are removed.
- `id` attributes are not used for headings (`data-heading` is used instead) so documents cannot clobber DOM globals.
- External links open in a new tab with `rel="noopener noreferrer nofollow"`.
- KaTeX runs with `trust: false`. Mermaid runs with `securityLevel: 'strict'`, which sanitizes diagram labels and disables click handlers in diagrams.
- Code and text files are escaped and highlighted, never rendered as HTML.

## Content Security Policy

Production builds include this policy as a meta tag (`vite.config.ts`):

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://api.anthropic.com https://api.openai.com
http://localhost:* http://127.0.0.1:* http://[::1]:*;
object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'
```

`connect-src` lists the AI providers (used only with a key the user adds) and this computer's own addresses, which Private mode uses to reach a local model server such as Ollama. No inline or third-party script can run even if sanitizing were bypassed. `'wasm-unsafe-eval'` allows WebAssembly only (not `eval()` of text); the PDF viewer needs it for its JPEG 2000 and color-profile decoders, which ship in this app's build, as do its fonts and character maps. Inline styles are allowed because CodeMirror, KaTeX and Mermaid need them. Remote `https:` images are allowed so documents can embed images by URL; this means opening a document can make a request to the image's host.

## Files and import

- Names are validated: `/`, `\` and control characters are rejected, as are the names `.` and `..`.
- Import paths, including paths inside zip archives, are normalized. Any path that would escape the import folder is skipped (path traversal and zip-slip).
- Import limits: 100 MB per file and 1 GB per import. Text documents over 20 MB are stored as binary files.
- Text and binary files are told apart by content, not only by extension.

## Data

Data stays in IndexedDB in the user's browser profile. It is not encrypted by My Doc; it is protected by the operating system account and the browser. Recovery drafts of unsaved edits are kept in `localStorage` until they are restored.

## Tests

XSS payloads are covered by `src/lib/markdown/render.test.ts` and, in a real browser, by `e2e/security.spec.ts`. Path traversal and zip-slip are covered by `src/app/workspace.test.ts`.

## Reporting a vulnerability

Please report security issues privately through GitHub's **Report a vulnerability** option on this repository, rather than in a public issue.
