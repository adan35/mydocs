import { platform } from '@/platform';
import { mimeOf } from '@/domain/names';
import { runImport } from './actions';
import { toast, toastError } from './toast-store';

interface OpenedFile {
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
  error: string | null;
}

/** Native replies are a u32 header length, a JSON header, then the file bytes; empty means none. */
export function decodeOpenedFile(reply: ArrayBuffer): OpenedFile | null {
  if (reply.byteLength < 4) return null;
  const length = new DataView(reply).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(reply, 4, length))) as {
    name: string;
    error: string | null;
  };
  return { ...header, bytes: new Uint8Array(reply, 4 + length) };
}

/** Subscribe before draining so cold starts and subsequent Explorer opens cannot race. */
export function watchDesktopFiles(): () => void {
  if (platform !== 'desktop') return () => {};
  let cancelled = false;
  let off: (() => void) | undefined;
  let chain = Promise.resolve();
  void (async () => {
    const [{ invoke }, { listen }] = await Promise.all([
      import('@tauri-apps/api/core'),
      import('@tauri-apps/api/event'),
    ]);
    if (cancelled) return;
    const drain = () => {
      chain = chain
        .then(async () => {
          while (!cancelled) {
            const file = decodeOpenedFile(await invoke<ArrayBuffer>('take_open_file'));
            if (!file) break;
            if (file.error) {
              toast({ message: `Unable to open ${file.name}.`, detail: file.error, tone: 'error' });
              continue;
            }
            await runImport(
              [
                {
                  path: file.name,
                  file: new File([file.bytes], file.name, {
                    type: mimeOf(file.name),
                  }),
                },
              ],
              null,
            );
          }
        })
        .catch((error: unknown) => {
          toastError('Unable to open the requested files.', error);
        });
    };
    const unlisten = await listen('mydoc:open-files', drain);
    if (cancelled) {
      unlisten();
      return;
    }
    off = unlisten;
    drain();
  })().catch((error: unknown) => toastError('Unable to listen for opened files.', error));
  return () => {
    cancelled = true;
    off?.();
  };
}
