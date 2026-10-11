import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { openUrl } from '@tauri-apps/plugin-opener';
import { getCurrentWindow } from '@tauri-apps/api/window';

/** Desktop (Tauri) implementations behind `platform/index.ts`. */

export async function saveFile(blob: Blob, filename: string): Promise<boolean> {
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.') + 1) : '';
  const path = await save({
    defaultPath: filename,
    filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined,
  });
  if (!path) return false;
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  return true;
}

export function openExternal(url: string): Promise<void> {
  return openUrl(url);
}

/** Lets `save` finish before the window closes. Returns an unlisten function. */
export function onCloseRequested(save: () => Promise<void> | void): Promise<() => void> {
  return getCurrentWindow().onCloseRequested(async () => {
    try {
      await save();
    } catch {
      // Never trap the user in a window they can't close; recovery drafts still exist.
    }
  });
}
