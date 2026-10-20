import { afterEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  close: vi.fn(),
  write: vi.fn().mockResolvedValue({ uri: 'file:///cache/export' }),
  share: vi.fn().mockResolvedValue({}),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onCloseRequested: native.close }),
}));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: { writeFile: native.write },
}));
vi.mock('@capacitor/share', () => ({ Share: { share: native.share } }));

afterEach(() => vi.clearAllMocks());

describe('native document safety', () => {
  it('keeps the desktop window open when saving fails', async () => {
    const { onCloseRequested } = await import('./desktop');
    await onCloseRequested(async () => {
      throw new Error('Storage full');
    });
    const event = { preventDefault: vi.fn() };
    await native.close.mock.calls[0]![0](event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it('allows desktop close after a successful asynchronous save', async () => {
    const { onCloseRequested } = await import('./desktop');
    const save = vi.fn().mockResolvedValue(undefined);
    await onCloseRequested(save);
    const event = { preventDefault: vi.fn() };
    await native.close.mock.calls[0]![0](event);
    expect(save).toHaveBeenCalledOnce();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('gives each mobile export a separate cache file, preserving the filename', async () => {
    const { saveFile } = await import('./mobile');
    await saveFile(new Blob(['First']), 'Notes.md');
    await saveFile(new Blob(['Second']), 'Notes.md');
    const paths = native.write.mock.calls.map(([options]) => options.path as string);
    expect(paths[0]).not.toBe(paths[1]);
    expect(paths.every((p) => /^exports\/[^/]+\/Notes\.md$/.test(p))).toBe(true);
    expect(native.write.mock.calls[0]![0].data).toBe('First');
    expect(native.write.mock.calls[1]![0].data).toBe('Second');
  });

  it('keeps workspace names with path separators inside the mobile export directory', async () => {
    const { saveFile } = await import('./mobile');
    await saveFile(new Blob(['backup']), '../../outside.zip');
    expect(native.write.mock.calls[0]![0].path).toMatch(/^exports\/[^/]+\/outside\.zip$/);
  });

  it('handles Capacitor cancellation objects without reporting a failed export', async () => {
    const { saveFile } = await import('./mobile');
    native.share.mockRejectedValueOnce({ message: 'Share canceled' });
    await expect(saveFile(new Blob(['x']), 'Notes.md')).resolves.toBe(false);
  });
});
