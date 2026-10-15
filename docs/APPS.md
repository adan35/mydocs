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

Each run's files are under **Artifacts** on the run's page. Pushing a tag such as `v0.2.0` publishes a GitHub Release (see [Releasing](#releasing-and-updates)).

## Releasing and updates

### Cutting a release

```bash
git tag v0.2.0 && git push origin v0.2.0
```

The **Apps** workflow then builds Windows, macOS and Linux installers plus the Android APK, stamps the tag's version into the desktop app, and publishes a GitHub Release (a tag with a suffix such as `v0.2.0-beta.1` is marked pre-release and is never offered as the latest). Files get stable names so links to `releases/latest/download/<name>` always point at the newest build:

| File                                                        | For                                  |
| ----------------------------------------------------------- | ------------------------------------ |
| `My-Doc-windows-x64-setup.exe`                              | Windows                              |
| `My-Doc-macos-universal.dmg`                                | macOS (Apple silicon and Intel)      |
| `My-Doc-linux-x64.AppImage` / `.deb` / `.rpm`               | Linux                                |
| `My-Doc-android.apk`                                        | Android (release APK once signed)    |
| `latest.json`, `*.sig`, `My-Doc-macos-universal.app.tar.gz` | The desktop updater (not for people) |

The site's **Download** page (`#/download`, also in Settings and the command palette) links to these names. The tag must look like `vMAJOR.MINOR.PATCH`; the desktop app's version comes from it.

### How the desktop app updates

Installed desktop apps check `https://github.com/adan35/my-doc/releases/latest/download/latest.json` shortly after launch and every six hours. When a newer version exists, an **Update available** dialog offers **Install and restart**, **Later** or **Skip this version**. Open edits are saved first; the update package's signature is verified against the public key built into the app before anything is installed. **Settings → Updates** shows the version and has **Check for updates**. The web app updates itself through its service worker.

**Android** has no store listing here, so it cannot install updates by itself. Each release also publishes `android.json` (version and APK link). The app reads it with the same schedule and shows the same **Update available** dialog; **Download update** opens the new APK in the browser and the user taps it to install. Android only installs it over the old app if both were signed with the same keystore, so set the Android signing secrets below before the first public APK. **iPhone and iPad** have no native app without an Apple Developer account; use the web app (Share → Add to Home Screen), which updates itself.

An update is only offered when `latest.json` exists, which needs the signing key below. Installers made without it still work; they just can't update themselves.

### One-time setup for updates (required)

1. Generate the updater key pair on your computer (keep the private key out of the repository):

   ```bash
   npx tauri signer generate -w ~/.tauri/mydoc.key
   ```

   Choose a password when asked. This writes `mydoc.key` (private) and `mydoc.key.pub` (public).

2. Put the **public** key in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey` (the contents of `mydoc.key.pub`) and merge that change. This is already done for the current key.
3. In the repository's **Settings → Secrets and variables → Actions**, add:
   - `TAURI_SIGNING_PRIVATE_KEY`: the contents of `mydoc.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the password you chose
4. Tag a release (`git tag v0.1.1 && git push origin v0.1.1`). Install it once, then tag a later version to see the update prompt.

Keep a backup of `mydoc.key` and its password. If the key is lost, installed apps can never be updated again and users must reinstall by hand. If the repository is renamed, GitHub keeps redirecting the old download URLs; update `endpoints` and `REPO` in `src/app/downloads.ts` when convenient.

### Optional: clean installs without OS warnings

Updates work without these. They only remove the "unknown publisher" prompts on first install.

- **Windows**: buy a code-signing certificate and follow the [Tauri guide](https://tauri.app/distribute/sign/windows/). Without it, SmartScreen shows **More info → Run anyway**.
- **macOS**: join the Apple Developer Program ($99/year), create a Developer ID Application certificate, and add the repository secrets `APPLE_CERTIFICATE` (base64 `.p12`), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password) and `APPLE_TEAM_ID`. The workflow already passes them to the build, which signs and notarizes when they are present ([Tauri guide](https://tauri.app/distribute/sign/macos/)). Without it, right-click → Open the first time.

Linux needs nothing.

## What needs the owner's accounts

These steps can't be done from the repository; they need your accounts and keys. The apps build and run without them, with the limits noted.

| Step                                                                                                                                                                                                                                                                                                                                                                                                     | Why                                                         | Without it                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------- |
| **Android signing key**: create one with `keytool -genkeypair -v -keystore release.keystore -alias mydoc -keyalg RSA -keysize 2048 -validity 10000`, then add the repository secrets `ANDROID_KEYSTORE_BASE64` (`base64 -w0 release.keystore`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`. Keep the keystore safe: Play only accepts updates signed with the same key. | Release APK and Play bundle                                 | Debug APK only                    |
| **Google Play developer account** ($25 one-time) and a store listing.                                                                                                                                                                                                                                                                                                                                    | Distribution through Play                                   | Install the APK directly          |
| **Apple Developer Program** ($99/year), then set your Team in Xcode (**App → Signing & Capabilities**).                                                                                                                                                                                                                                                                                                  | Running on a real iPhone/iPad, TestFlight and the App Store | Simulator only                    |
| **Apple Developer ID certificate and notarization** for the macOS app ([Tauri guide](https://tauri.app/distribute/sign/macos/)).                                                                                                                                                                                                                                                                         | Opening without a Gatekeeper warning                        | Right-click → Open the first time |
| **Windows code-signing certificate** ([Tauri guide](https://tauri.app/distribute/sign/windows/)).                                                                                                                                                                                                                                                                                                        | No SmartScreen "unknown publisher" warning                  | Click **More info → Run anyway**  |

## Editor and formats in the apps

The editing modes, ribbon, conversions, sheet views, PDF viewer and graph are web code, so the
desktop and mobile apps get them unchanged. Platform differences:

- **Saving exports**: the desktop app uses the native save dialog; the mobile apps use the share
  sheet; the browser downloads (`src/platform/`).
- **PDF export** uses the print dialog, which the mobile web views don't have. The mobile apps
  share a print-ready HTML file instead and the conversion dialog says so.
- **PDF viewing** uses pdf.js's legacy build so it works in older Android WebViews and WKWebView.
- **Conversions** run in a Web Worker in every shell, with an in-thread fallback.

Verified in this repository: the web app in Chromium (unit and e2e tests, a production build with
its Content-Security-Policy, screenshots at phone, tablet, laptop and desktop sizes). The shells
are built by CI (below); running them on real devices needs the accounts listed further down.

## Not in the apps yet

- Editing a real folder on disk (the desktop app still stores documents in its own database, like the browser). The storage layer is ready for it: a folder-backed `WorkspaceProvider` in `src/storage/` would plug in without UI changes.
- Sync between devices.
