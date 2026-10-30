import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  runImport: vi.fn(),
  toast: vi.fn(),
  toastError: vi.fn(),
  off: vi.fn(),
}));
vi.mock('@/platform', () => ({ platform: 'desktop' }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('./actions', () => ({ runImport: mocks.runImport }));
vi.mock('./toast-store', () => ({ toast: mocks.toast, toastError: mocks.toastError }));
import { watchDesktopFiles } from './desktop-open';
import { sourcePaths } from './source-paths';

/** Encodes a reply the way the native take_open_file command does. */
function reply(name: string, bytes: number[], error: string | null = null): ArrayBuffer {
  const header = new TextEncoder().encode(
    JSON.stringify({ name, path: `C:\\Docs\\${name}`, error }),
  );
  const out = new Uint8Array(4 + header.length + bytes.length);
  new DataView(out.buffer).setUint32(0, header.length, true);
  out.set(header, 4);
  out.set(bytes, 4 + header.length);
  return out.buffer;
}
const none = new ArrayBuffer(0);

afterEach(() => vi.resetAllMocks());

it('subscribes before consuming cold-start files and keeps later requests serialized', async () => {
  mocks.listen.mockResolvedValue(mocks.off);
  mocks.runImport.mockResolvedValue('entry-1');
  mocks.invoke.mockResolvedValueOnce(reply('first.txt', [65])).mockResolvedValueOnce(none);
  const stop = watchDesktopFiles();
  await vi.waitFor(() => expect(mocks.runImport).toHaveBeenCalledTimes(1));
  expect(mocks.listen.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.invoke.mock.invocationCallOrder[0]!,
  );
  const imported = mocks.runImport.mock.calls[0]![0][0];
  expect(imported.path).toBe('first.txt');
  expect(imported.file.size).toBe(1);
  // "Show in File Explorer" later finds the original through this.
  expect(sourcePaths.get('entry-1')).toBe('C:\\Docs\\first.txt');
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
  mocks.invoke
    .mockResolvedValueOnce(reply('missing.txt', [], 'Not found'))
    .mockResolvedValueOnce(reply('next.txt', [66]))
    .mockResolvedValue(none);
  const notify = mocks.listen.mock.calls[0]![1];
  notify();
  notify();
  await vi.waitFor(() => expect(mocks.runImport).toHaveBeenCalledTimes(2));
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({ tone: 'error', detail: 'Not found' }),
  );
  stop();
  expect(mocks.off).toHaveBeenCalledTimes(1);
});

it('does not consume files after the listener was cancelled during startup', async () => {
  mocks.listen.mockResolvedValue(mocks.off);
  const stop = watchDesktopFiles();
  stop();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(mocks.invoke).not.toHaveBeenCalled();
});
