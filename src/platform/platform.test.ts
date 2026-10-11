import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  delete (window as { Capacitor?: unknown }).Capacitor;
});

describe('platform detection', () => {
  it('is the web in a plain browser', async () => {
    const p = await import('./index');
    expect(p.platform).toBe('web');
    expect(p.isNativeApp).toBe(false);
    expect(p.canPrint).toBe(true);
  });

  it('recognizes the desktop shell', async () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const p = await import('./index');
    expect(p.platform).toBe('desktop');
    expect(p.canPrint).toBe(true);
  });

  it('recognizes Android and iOS, where printing is unavailable', async () => {
    for (const os of ['android', 'ios'] as const) {
      vi.resetModules();
      (window as { Capacitor?: unknown }).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => os,
      };
      const p = await import('./index');
      expect(p.platform).toBe(os);
      expect(p.isMobileApp).toBe(true);
      expect(p.canPrint).toBe(false);
    }
  });

  it('treats Capacitor running on the web as the web', async () => {
    (window as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => false,
      getPlatform: () => 'web',
    };
    expect((await import('./index')).platform).toBe('web');
  });
});

describe('saveFile on the web', () => {
  it('downloads the blob under the given name', async () => {
    URL.createObjectURL ??= () => '';
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toBe('Notes.md');
      expect(this.href).toBe('blob:test');
    });
    const { saveFile } = await import('./index');
    await expect(saveFile(new Blob(['# hi']), 'Notes.md')).resolves.toBe(true);
    expect(click).toHaveBeenCalledOnce();
  });
});

describe('native link handler', () => {
  it('does nothing on the web', async () => {
    const { installNativeLinkHandler } = await import('./index');
    const off = installNativeLinkHandler();
    const a = document.createElement('a');
    a.href = 'https://example.com';
    document.body.append(a);
    let preventedByHandler: boolean | undefined;
    const observe = (e: Event) => {
      preventedByHandler = e.defaultPrevented;
      e.preventDefault(); // jsdom can't navigate
    };
    document.addEventListener('click', observe);
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(preventedByHandler).toBe(false);
    document.removeEventListener('click', observe);
    off();
    a.remove();
  });

  it('sends external links to the system browser in the desktop app', async () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const openExternal = vi.fn().mockResolvedValue(undefined);
    vi.doMock('./desktop', () => ({ openExternal }));
    const { installNativeLinkHandler } = await import('./index');
    const off = installNativeLinkHandler();
    const a = document.createElement('a');
    a.href = 'https://example.com/page';
    a.textContent = 'link';
    document.body.append(a);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.firstChild!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledWith('https://example.com/page'));
    off();
    a.remove();
    vi.doUnmock('./desktop');
  });
});
