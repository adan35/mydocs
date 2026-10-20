# Document safety, sheets and usability validation

This pass prioritizes retaining the latest document content and making local saves and backups clear.

## Changes

- Sheet view fills the workspace with spare cells, readable Markdown values, frozen table
  headers, resizable columns, address navigation, range selection, quoted multi-cell clipboard
  operations, bulk clear, undo, selection totals and a wrapping control.
- Excel supports persisted number formats and column widths, plus sheet rename, duplicate and
  delete menus on desktop and touch screens. Renaming follows formula references.
- New file creation supports Markdown, text, CSV, TSV, Excel, JSON, HTML and custom text/code
  extensions, including dotfiles. Excel files are encoded workbooks, not renamed text files.
- External file drops import throughout the app, including editors, tabs, menus and sheets.
  Folder rows/cards route the destination. Alt-drop into Markdown explicitly attaches files;
  normal drops preserve editor content and internal tab/tree dragging still works.
- Pending workbook edits participate in save guards. File/ZIP exports and conversions use
  the latest draft after storage failures; accepting a disk update preserves previous binary
  bytes in version history. Workbook writes are serialized so older conversions cannot win.
- Failed saves pause workspace changes, folder trash/duplicate operations, import replacement,
  version restoration, tab handover, desktop close, and application updates/restarts.
- Exports include current editor text even when local saving fails, including empty documents.
- Recovery copies survive failed reads and writes and remain available for retry or export.
- Failed writes no longer suppress the previous version on retry or clear cached text prematurely.
- Mobile exports use separate cache files and handle cancelled native share sheets.
- Phone headers show readable save state and document modes. Menus have a Back action;
  modals isolate keyboard shortcuts and background controls. Settings support keyboard radio
  navigation and larger touch controls.
- Home has a direct backup action and unsaved-work guidance. Storage copy distinguishes
  on-device storage from a separate exported backup and accounts for native app storage.
- The service worker can load precached scripts offline when the server uses `Vary: Origin`.
  CI now tests the actual production build offline.

## Verified

| Check                          | Result                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------- |
| TypeScript, ESLint, Prettier   | Passed                                                                       |
| Unit/integration tests         | 279 passed, 3 optional performance tests skipped                             |
| Chromium end-to-end suite      | 107 passed; one startup timeout passed 3/3 on isolated rerun (108 scenarios) |
| Production service-worker test | Passed: offline reload, edits, save, and second reload                       |
| Earlier layout audit           | 100 route/viewport/theme combinations, no horizontal overflow or page errors |
| New file/sheet layout audit    | 22 viewport/theme states; no page overflow or errors                         |
| Document modes                 | Source, Split, Rich and Read rendered at 320, 390, 768 and 1440px            |
| Android                        | Debug APK built; APK signature verified                                      |
| iOS assets                     | Production web assets copied successfully                                    |

The layout audit covered Home, Settings, Search, Files, Recent, Favorites, Tags, Graph,
Trash and Download in light and dark themes on small phone, phone, tablet, landscape and
desktop viewports. The end-to-end suite also checks responsive widths through 2560px,
editing, conversion, imports, history, search, links, security, recovery and exports.

## Native coverage and limits

The native adapter regression tests mock Tauri and Capacitor APIs. They verify close protection,
mobile export isolation, export path handling and cancellation; they do not establish that every
OS dialog, keyboard, codec or device behavior works.

Workbook recovery after a failed save is kept in memory when changing views within the current
session. Unlike text recovery drafts, it does not survive a browser crash or forced process exit.
The app warns before unloading with unsaved changes and can export those edits without writing
to local storage. Unsupported Excel features still require explicit approval before editing;
this editor does not implement the full Google Sheets feature set or cloud collaboration.

The desktop build was attempted but this machine lacks Cargo/Rust and WebKitGTK development
libraries. iOS compilation and simulator testing require macOS and Xcode. Android was compiled
with SDK 36 and Java 21. The Android 36 software emulator reached ADB but did not finish booting
after 12 minutes without hardware acceleration; installation was rejected while it was booting.
It was stopped. Android device UI, keyboards and native dialogs still need a physical device or
an accelerated emulator check.

## Repeat the checks

From the repository root, with Node.js 22+ and dependencies installed:

```bash
npm run lint
npm run format:check
npm run typecheck
npm test -- --maxWorkers=2
npm run build
PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e -- --workers=2
PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium npm run test:pwa
```

Omit the browser override when using Playwright's installed Chromium. `test:pwa` builds and
starts its own production preview on port 4175. For native builds, follow [APPS.md](APPS.md).
The Android debug APK is generated at `android/app/build/outputs/apk/debug/app-debug.apk`.
