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

afterEach(() => vi.resetAllMocks());

it('subscribes before consuming cold-start files and keeps later requests serialized', async () => {
  mocks.listen.mockResolvedValue(mocks.off);
  mocks.runImport.mockResolvedValue(undefined);
  mocks.invoke
    .mockResolvedValueOnce({ name: 'first.txt', bytes: [65], error: null })
    .mockResolvedValueOnce(null);
  const stop = watchDesktopFiles();
  await vi.waitFor(() => expect(mocks.runImport).toHaveBeenCalledTimes(1));
  expect(mocks.listen.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.invoke.mock.invocationCallOrder[0]!,
  );
  const imported = mocks.runImport.mock.calls[0]![0][0];
  expect(imported.path).toBe('first.txt');
  expect(imported.file.size).toBe(1);
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
  mocks.invoke
    .mockResolvedValueOnce({ name: 'missing.txt', bytes: [], error: 'Not found' })
    .mockResolvedValueOnce({ name: 'next.txt', bytes: [66], error: null })
    .mockResolvedValue(null);
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
