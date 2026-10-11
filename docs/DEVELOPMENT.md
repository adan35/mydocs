# Development

## Setup

Requires Node.js 22 or later.

```bash
npm install
npm run dev
```

The dev server runs at http://localhost:5173. Data is stored in the browser's IndexedDB, so use a private window or clear site data for a fresh first-run experience.

## Scripts

| Command                | What it does                                                          |
| ---------------------- | --------------------------------------------------------------------- |
| `npm run dev`          | Vite dev server with hot reload.                                      |
| `npm run build`        | Type-checks, then builds to `dist/` with the Content-Security-Policy. |
| `npm run preview`      | Serves the production build.                                          |
| `npm run typecheck`    | `tsc -b --noEmit`.                                                    |
| `npm run lint`         | ESLint.                                                               |
| `npm run format`       | Formats everything with Prettier.                                     |
| `npm run format:check` | Checks formatting (used in CI).                                       |
| `npm test`             | Unit and integration tests (Vitest, jsdom, fake-indexeddb).           |
| `npm run test:e2e`     | End-to-end tests (Playwright).                                        |

## Tests

**Unit and integration** (`src/**/*.test.ts`):

- `domain/domain.test.ts`: names, paths, links, tags, outline, diff and tree rules.
- `app/workspace.test.ts`: the workspace against both the memory store and IndexedDB, including failed writes, trash, versions, link rewriting, import (with path traversal and zip-slip attempts) and export.
- `lib/markdown/render.test.ts`: rendering features and XSS payloads.
- `app/perf.test.ts`: a 5,000-document performance budget. It is skipped by default; run it with `PERF=1 npx vitest run src/app/perf.test.ts`.

**End to end** (`e2e/`), against the dev server on port 4174:

- `journey.spec.ts`: create, edit, autosave, reload, rename with link rewriting, search, trash and restore, recovery, tabs, wiki links.
- `import.spec.ts`: zip import and conflict handling.
- `security.spec.ts`: malicious Markdown in a real browser.
- `mobile.spec.ts`: phone layout on a Pixel 7 profile.
- `responsive.spec.ts`: no horizontal overflow at 11 widths from 320px to 2560px.

Install the browser once with `npx playwright install chromium`. If Chromium is already installed elsewhere, point to it with `PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome`.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`. The `check` job runs lint, format check, typecheck, unit tests and build. The `e2e` job runs Playwright and uploads traces when a test fails. `.github/workflows/apps.yml` builds the desktop and mobile apps; see [APPS.md](APPS.md).

## Conventions

- Keep the layers in [ARCHITECTURE.md](ARCHITECTURE.md): `ui/` never imports `storage/`, and `domain/` stays pure.
- All writes go through `Workspace`, and every user command goes through `app/actions.ts`.
- Treat document content as untrusted. Rendered HTML must go through `sanitizeHtml()`.
- Keyboard shortcuts are defined once in `app/shortcuts.ts`.
- Use design tokens from `styles.css` rather than raw colors.
- New features need tests: a unit test for logic, and an e2e test for a user-visible flow.
