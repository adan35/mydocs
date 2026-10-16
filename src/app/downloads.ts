import ASSET_NAMES from '../../scripts/release-assets.json';

/** Where releases are published. The Download page links to the newest one per file name. */
export const REPO = 'adan35/my-doc';
export const RELEASES_URL = `https://github.com/${REPO}/releases`;

export type DownloadOs = 'windows' | 'macos' | 'linux' | 'android';

export interface DownloadOption {
  label: string;
  file: string;
  /** Short note shown under the label. */
  note?: string;
}

export interface DownloadTarget {
  os: DownloadOs;
  title: string;
  options: DownloadOption[];
}

export const latestUrl = (file: string) => `${RELEASES_URL}/latest/download/${file}`;

/** What the Android app reads to learn whether a newer APK exists. */
export const ANDROID_MANIFEST_URL = latestUrl(ASSET_NAMES.androidManifest);

export const DOWNLOADS: DownloadTarget[] = [
  {
    os: 'windows',
    title: 'Windows',
    options: [
      { label: 'Installer (.exe)', file: ASSET_NAMES.windows, note: 'Windows 10 and 11, 64-bit' },
    ],
  },
  {
    os: 'macos',
    title: 'macOS',
    options: [
      { label: 'Disk image (.dmg)', file: ASSET_NAMES.macos, note: 'Apple silicon and Intel' },
    ],
  },
  {
    os: 'linux',
    title: 'Linux',
    options: [
      { label: 'AppImage', file: ASSET_NAMES.linuxAppImage, note: 'Runs on most distributions' },
      { label: 'Debian / Ubuntu (.deb)', file: ASSET_NAMES.linuxDeb },
      { label: 'Fedora / openSUSE (.rpm)', file: ASSET_NAMES.linuxRpm },
    ],
  },
  {
    os: 'android',
    title: 'Android',
    options: [
      { label: 'APK', file: ASSET_NAMES.android, note: 'Allow "Install unknown apps" first' },
    ],
  },
];

/** Best guess at the visitor's system, so its card can be highlighted. */
export function detectOs(ua: string = navigator.userAgent): DownloadOs | null {
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return null;
  if (/windows/i.test(ua)) return 'windows';
  if (/mac os x|macintosh/i.test(ua)) return 'macos';
  if (/linux|x11|cros/i.test(ua)) return 'linux';
  return null;
}
