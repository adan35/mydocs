# Desktop and mobile apps

My Doc ships as one web app in four shells. Every feature lives in `src/`, so anything added to the web app appears in the desktop and mobile apps on their next build.

| Platform              | Shell                                | Output                                           | Folder       |
| --------------------- | ------------------------------------ | ------------------------------------------------ | ------------ |
| Web                   | Any browser                          | `dist/` (Cloudflare Pages)                       | `src/`       |
| Windows, macOS, Linux | [Tauri 2](https://tauri.app)         | `.msi`/`.exe`, `.dmg`, `.deb`/`.rpm`/`.AppImage` | `src-tauri/` |
| Android               | [Capacitor](https://capacitorjs.com) | `.apk` (and `.aab` for Play)                     | `android/`   |
| iOS, iPadOS           | Capacitor                            | Xcode project                                    | `ios/`       |

## How it fits together

- The shells load the same production build (`dist/`). Routing is hash based, so no server is needed.
- Data is stored in IndexedDB, exactly as on the web. Each app keeps its own copy on the device: the desktop app in its app-data folder, the mobile apps in their sandbox. Moving a workspace between devices works through **Export workspace** and **Import** (a zip of plain `.md` files).
- `src/platform/` is the only code that knows which shell it runs in. It covers the few things a web view can't do by itself:
  - **Saving exports**: a browser download on the web, a native Save dialog on desktop, the share sheet on Android and iOS (save to Files, Drive, email, and so on).
  - **External links**: opened in the system browser instead of a dead `target="_blank"`.
  - **Closing the window** (desktop): pending edits are saved before the window closes.
  - **PDF export**: uses the print dialog on web and desktop. Mobile web views have no print dialog, so the mobile apps share a print-ready HTML file instead.
- The desktop window turns off Tauri's own file-drop handling so drag-and-drop import works exactly as in the browser.
- The desktop Content-Security-Policy adds only Tauri's IPC endpoints to `connect-src` (see `vite.config.ts`).

## Building locally

```bash
npm install

# Desktop (needs Rust: https://rustup.rs, plus the OS prerequisites at https://tauri.app/start/prerequisites/)
npm run desktop:dev      # app window with hot reload
npm run desktop:build    # installers in src-tauri/target/release/bundle/

# Mobile (Android Studio for Android, Xcode on a Mac for iOS)
npm run mobile:sync      # build the web app and copy it into android/ and ios/
npm run android          # open in Android Studio, then Run
npm run ios              # open in Xcode, then Run
```

Run `npm run mobile:sync` after every web change before building a mobile app.

## Continuous integration

`.github/workflows/apps.yml` builds every shell on pull requests that touch them, on demand (**Actions → Apps → Run workflow**), and on version tags:

- **Desktop**: installers for Linux, Windows and macOS (universal: Apple silicon and Intel).
- **Android**: a debug APK that installs on any device with "Install unknown apps" allowed. With signing secrets set, also a signed release APK and a Play Store bundle.
- **iOS**: a Simulator build, which proves the app compiles. Device builds need signing (below).

Each run's files are under **Artifacts** on the run's page. Pushing a tag such as `v0.2.0` also creates a draft GitHub Release with all of them attached.

## What needs the owner's accounts

These steps can't be done from the repository; they need your accounts and keys. The apps build and run without them, with the limits noted.

| Step                                                                                                                                                                                                                                                                                                                                                                                                     | Why                                                         | Without it                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------- |
| **Android signing key**: create one with `keytool -genkeypair -v -keystore release.keystore -alias mydoc -keyalg RSA -keysize 2048 -validity 10000`, then add the repository secrets `ANDROID_KEYSTORE_BASE64` (`base64 -w0 release.keystore`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`. Keep the keystore safe: Play only accepts updates signed with the same key. | Release APK and Play bundle                                 | Debug APK only                    |
| **Google Play developer account** ($25 one-time) and a store listing.                                                                                                                                                                                                                                                                                                                                    | Distribution through Play                                   | Install the APK directly          |
| **Apple Developer Program** ($99/year), then set your Team in Xcode (**App → Signing & Capabilities**).                                                                                                                                                                                                                                                                                                  | Running on a real iPhone/iPad, TestFlight and the App Store | Simulator only                    |
| **Apple Developer ID certificate and notarization** for the macOS app ([Tauri guide](https://tauri.app/distribute/sign/macos/)).                                                                                                                                                                                                                                                                         | Opening without a Gatekeeper warning                        | Right-click → Open the first time |
| **Windows code-signing certificate** ([Tauri guide](https://tauri.app/distribute/sign/windows/)).                                                                                                                                                                                                                                                                                                        | No SmartScreen "unknown publisher" warning                  | Click **More info → Run anyway**  |

## Not in the apps yet

- Editing a real folder on disk (the desktop app still stores documents in its own database, like the browser). The storage layer is ready for it: a folder-backed `WorkspaceProvider` in `src/storage/` would plug in without UI changes.
- Automatic updates for the desktop app (Tauri's updater needs a signing key and an update server).
- Sync between devices.
