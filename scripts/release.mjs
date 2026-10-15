#!/usr/bin/env node
// Release helpers used by .github/workflows/apps.yml.
//
//   node scripts/release.mjs set-version v1.2.3
//       Stamps 1.2.3 into src-tauri/tauri.conf.json so the installed app knows its version.
//   node scripts/release.mjs publish <tag> <repo> <inDir> <outDir>
//       Gives the downloaded build artifacts stable names in <outDir> and writes latest.json,
//       the manifest the desktop app's updater reads.

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  copyFileSync,
  mkdirSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Names the Download page links to (`releases/latest/download/<name>`). */
export const ASSET_NAMES = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'release-assets.json'), 'utf8'),
);

/** Installer to republish under its stable name, and the updater bundle (with a .sig beside it). */
const RULES = [
  { name: ASSET_NAMES.windows, match: /-setup\.exe$/i, updater: ['windows-x86_64'] },
  { name: ASSET_NAMES.macos, match: /\.dmg$/i },
  {
    name: 'My-Doc-macos-universal.app.tar.gz',
    match: /\.app\.tar\.gz$/i,
    updater: ['darwin-aarch64', 'darwin-x86_64'],
  },
  { name: ASSET_NAMES.linuxAppImage, match: /\.AppImage$/i, updater: ['linux-x86_64'] },
  { name: ASSET_NAMES.linuxDeb, match: /\.deb$/i },
  { name: ASSET_NAMES.linuxRpm, match: /\.rpm$/i },
];

export function versionFromTag(tag) {
  const m = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag);
  if (!m) throw new Error(`"${tag}" is not a version tag like v1.2.3`);
  return m[1];
}

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Builds the updater manifest. `signatures` maps stable file name to its .sig text. */
export function buildManifest({ version, tag, repo, notes, signatures, now = new Date() }) {
  const platforms = {};
  for (const rule of RULES) {
    for (const key of rule.updater ?? []) {
      const signature = signatures[rule.name];
      if (!signature) continue;
      platforms[key] = {
        signature,
        url: `https://github.com/${repo}/releases/download/${tag}/${rule.name}`,
      };
    }
  }
  return { version, notes, pub_date: now.toISOString(), platforms };
}

function setVersion(tag) {
  const version = versionFromTag(tag);
  const path = 'src-tauri/tauri.conf.json';
  const conf = JSON.parse(readFileSync(path, 'utf8'));
  conf.version = version;
  writeFileSync(path, `${JSON.stringify(conf, null, 2)}\n`);
  console.log(`Desktop app version set to ${version}`);
}

function publish(tag, repo, inDir, outDir) {
  const version = versionFromTag(tag);
  mkdirSync(outDir, { recursive: true });
  const files = walk(inDir);
  const signatures = {};
  const missing = [];
  for (const rule of RULES) {
    const src = files.find((f) => rule.match.test(f));
    if (!src) {
      missing.push(rule.name);
      continue;
    }
    copyFileSync(src, join(outDir, rule.name));
    if (rule.updater) {
      if (files.includes(`${src}.sig`)) {
        signatures[rule.name] = readFileSync(`${src}.sig`, 'utf8').trim();
        // Keep the .sig beside the file so it can be audited.
        copyFileSync(`${src}.sig`, join(outDir, `${rule.name}.sig`));
      }
    }
  }
  // Release APK when signing secrets exist; otherwise the debug APK.
  const apks = files.filter((f) => f.endsWith('.apk'));
  const apk = apks.find((f) => /release/i.test(f)) ?? apks[0];
  if (apk) copyFileSync(apk, join(outDir, ASSET_NAMES.android));
  else missing.push(ASSET_NAMES.android);
  const aab = files.find((f) => f.endsWith('.aab'));
  if (aab) copyFileSync(aab, join(outDir, 'My-Doc-android.aab'));
  const ios = files.find((f) => /ios-simulator\.zip$/.test(f));
  if (ios) copyFileSync(ios, join(outDir, 'My-Doc-ios-simulator.zip'));

  const desktopMissing = missing.filter((n) => n !== ASSET_NAMES.android);
  if (desktopMissing.length)
    throw new Error(`Missing desktop build output: ${desktopMissing.join(', ')}`);

  if (Object.keys(signatures).length) {
    const manifest = buildManifest({
      version,
      tag,
      repo,
      notes: `My Doc ${version}`,
      signatures,
    });
    writeFileSync(join(outDir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`latest.json covers: ${Object.keys(manifest.platforms).join(', ')}`);
  } else {
    console.log('No update signatures found: latest.json not written (see docs/APPS.md).');
  }
  if (missing.length) console.log(`Not built: ${missing.join(', ')}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'set-version' && args.length === 1) setVersion(args[0]);
  else if (cmd === 'publish' && args.length === 4) publish(...args);
  else {
    console.error('usage: release.mjs set-version <tag> | publish <tag> <repo> <inDir> <outDir>');
    process.exit(2);
  }
}
