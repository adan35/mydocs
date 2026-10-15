import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { buildManifest, versionFromTag, ASSET_NAMES } from './release.mjs';
import { DOWNLOADS } from '../src/app/downloads';

describe('release helpers', () => {
  it('reads versions from tags', () => {
    expect(versionFromTag('v1.2.3')).toBe('1.2.3');
    expect(versionFromTag('v1.2.3-beta.1')).toBe('1.2.3-beta.1');
    expect(() => versionFromTag('1.2.3')).toThrow();
    expect(() => versionFromTag('v1.2')).toThrow();
  });

  it('writes a manifest the Tauri updater accepts', () => {
    const m = buildManifest({
      version: '1.2.3',
      tag: 'v1.2.3',
      repo: 'o/r',
      notes: 'n',
      signatures: {
        [ASSET_NAMES.windows]: 'sigw',
        'My-Doc-macos-universal.app.tar.gz': 'sigm',
        [ASSET_NAMES.linuxAppImage]: 'sigl',
      },
      now: new Date('2026-01-01T00:00:00Z'),
    });
    expect(Object.keys(m.platforms).sort()).toEqual([
      'darwin-aarch64',
      'darwin-x86_64',
      'linux-x86_64',
      'windows-x86_64',
    ]);
    expect(m.platforms['darwin-x86_64']).toEqual(m.platforms['darwin-aarch64']);
    expect(m.platforms['windows-x86_64'].url).toBe(
      'https://github.com/o/r/releases/download/v1.2.3/My-Doc-windows-x64-setup.exe',
    );
    expect(m.pub_date).toBe('2026-01-01T00:00:00.000Z');
  });

  it('skips platforms that were not signed', () => {
    const m = buildManifest({
      version: '1.0.0',
      tag: 'v1.0.0',
      repo: 'o/r',
      notes: '',
      signatures: { [ASSET_NAMES.linuxAppImage]: 's' },
    });
    expect(Object.keys(m.platforms)).toEqual(['linux-x86_64']);
  });

  it('download page only links to files the release job publishes', () => {
    const published = new Set(Object.values(ASSET_NAMES));
    for (const t of DOWNLOADS) for (const o of t.options) expect(published.has(o.file)).toBe(true);
  });
});
