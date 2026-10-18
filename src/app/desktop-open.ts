import { platform } from '@/platform';
import { mimeOf } from '@/domain/names';
import { runImport } from './actions';
import { toast, toastError } from './toast-store';

interface OpenedFile {
  name: string;
  bytes: number[];
  error: string | null;
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
            const file = await invoke<OpenedFile | null>('take_open_file');
            if (!file) break;
            if (file.error) {
              toast({ message: `Unable to open ${file.name}.`, detail: file.error, tone: 'error' });
              continue;
            }
            await runImport(
              [
                {
                  path: file.name,
                  file: new File([new Uint8Array(file.bytes)], file.name, {
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
