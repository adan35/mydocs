import { afterEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
vi.mock('@capacitor/core', () => ({ CapacitorHttp: { get } }));
vi.mock('@capacitor/filesystem', () => ({ Directory: {}, Encoding: {}, Filesystem: {} }));
vi.mock('@capacitor/share', () => ({ Share: {} }));

afterEach(() => get.mockReset());

const OK = 'https://github.com/adan35/my-doc/releases/download/v9.0.0/My-Doc-android.apk';

describe('Android update check', () => {
  it('offers a newer APK', async () => {
    get.mockResolvedValue({ status: 200, data: { version: '9.0.0', url: OK } });
    const { checkForUpdate } = await import('./mobile');
    const update = await checkForUpdate();
    expect(update).toMatchObject({ version: '9.0.0', kind: 'download' });
    expect(get).toHaveBeenCalledWith({
      url: 'https://github.com/adan35/my-doc/releases/latest/download/android.json',
    });
  });

  it('stays quiet when already current', async () => {
    get.mockResolvedValue({ status: 200, data: { version: '0.0.1', url: OK } });
    const { checkForUpdate } = await import('./mobile');
    expect(await checkForUpdate()).toBeNull();
  });

  it('refuses a download link outside this project', async () => {
    get.mockResolvedValue({
      status: 200,
      data: { version: '9.0.0', url: 'https://evil.example/app.apk' },
    });
    const { checkForUpdate } = await import('./mobile');
    await expect(checkForUpdate()).rejects.toThrow();
  });

  it('reports unreadable update information', async () => {
    get.mockResolvedValue({ status: 404, data: '' });
    const { checkForUpdate } = await import('./mobile');
    await expect(checkForUpdate()).rejects.toThrow();
  });
});
