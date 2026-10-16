import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { CapacitorHttp } from '@capacitor/core';
import { ANDROID_MANIFEST_URL, RELEASES_URL } from '@/app/downloads';
import { isNewerVersion } from './version';
import type { PendingUpdate } from './desktop';

/** Android and iOS (Capacitor) implementations behind `platform/index.ts`. */

/** Writes the file to the app cache, then opens the share sheet for it. */
export async function saveFile(blob: Blob, filename: string): Promise<boolean> {
  const isText = blob.type.startsWith('text/') || /\.(md|markdown|txt|html?)$/i.test(filename);
  const { uri } = await Filesystem.writeFile({
    path: `exports/${filename}`,
    directory: Directory.Cache,
    recursive: true,
    ...(isText
      ? { data: await blob.text(), encoding: Encoding.UTF8 }
      : { data: await toBase64(blob) }),
  });
  try {
    await Share.share({ title: filename, files: [uri] });
    return true;
  } catch (err) {
    // Closing the share sheet without picking a target rejects with "Share canceled".
    if (err instanceof Error && /cancel/i.test(err.message)) return false;
    throw err;
  }
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Android has no store here, so the release publishes `android.json` beside the APK.
 * The request goes through the native HTTP client, which is not limited by the page's CSP.
 */
export async function checkForUpdate(): Promise<PendingUpdate | null> {
  const res = await CapacitorHttp.get({ url: ANDROID_MANIFEST_URL });
  const data = res.data as { version?: unknown; url?: unknown } | undefined;
  if (res.status !== 200 || typeof data?.version !== 'string' || typeof data.url !== 'string')
    throw new Error('The update information could not be read.');
  // Only ever hand the user a file from this project's releases.
  if (!data.url.startsWith(`${RELEASES_URL}/`)) throw new Error('Unexpected update location.');
  if (!isNewerVersion(data.version, __APP_VERSION__)) return null;
  const { version, url } = data;
  return {
    version,
    kind: 'download',
    // Opens the APK in the browser's downloader; the user taps it to install.
    install: async () => void location.assign(url),
  };
}
