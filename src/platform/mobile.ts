import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

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
