import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
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

/** Opens the folder holding `path` in File Explorer / Finder with the file selected. */
export function revealInFileManager(path: string): Promise<void> {
  return revealItemInDir(path);
}

/** Lets `save` finish before the window closes. Returns an unlisten function. */
export function onCloseRequested(save: () => Promise<void> | void): Promise<() => void> {
  return getCurrentWindow().onCloseRequested(async (event) => {
    try {
      await save();
    } catch {
      // Keep the window and its buffers available for retry/export when saving fails.
      event.preventDefault();
    }
  });
}

/** An update the installed desktop app can download, already checked against the signing key. */
export interface PendingUpdate {
  version: string;
  notes?: string;
  /** `in-app` installs by itself and restarts; `download` hands the user a file to install. */
  kind: 'in-app' | 'download';
  /** Downloads, verifies the signature, and installs. `onProgress` gets 0..1 when the size is known. */
  install(onProgress: (fraction: number | null) => void): Promise<void>;
}

export async function checkForUpdate(): Promise<PendingUpdate | null> {
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    notes: update.body,
    kind: 'in-app',
    async install(onProgress) {
      let total = 0;
      let done = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') total = event.data.contentLength ?? 0;
        else if (event.event === 'Progress') {
          done += event.data.chunkLength;
          onProgress(total ? Math.min(1, done / total) : null);
        }
      });
    },
  };
}

export async function relaunchApp(): Promise<void> {
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}

export async function appVersion(): Promise<string> {
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}
