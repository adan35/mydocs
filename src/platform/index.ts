/**
 * The one seam between the web app and the native shells (Tauri on desktop,
 * Capacitor on Android and iOS). Everything else in My Doc is identical on every
 * platform; only saving files, opening links, printing and quitting differ.
 *
 * Native code is loaded on demand, so the web build never downloads it.
 */

export type PlatformKind = 'web' | 'desktop' | 'android' | 'ios';

interface NativeGlobals {
  __TAURI_INTERNALS__?: unknown;
  Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
}

function detect(): PlatformKind {
  if (typeof window === 'undefined') return 'web';
  const w = window as unknown as NativeGlobals;
  if (w.__TAURI_INTERNALS__) return 'desktop';
  if (w.Capacitor?.isNativePlatform?.())
    return w.Capacitor.getPlatform?.() === 'ios' ? 'ios' : 'android';
  return 'web';
}

export const platform: PlatformKind = detect();
export const isNativeApp = platform !== 'web';
export const isMobileApp = platform === 'android' || platform === 'ios';

/** Whether `window.print()` produces a print dialog (and so "Export as PDF" works). */
export const canPrint = !isMobileApp;

/**
 * Saves a file the user exported. Returns false when the user cancelled.
 * Web: a browser download. Desktop: a native Save dialog. Mobile: the share sheet,
 * so the file can go to Files, Drive, email or another app.
 */
export async function saveFile(blob: Blob, filename: string): Promise<boolean> {
  if (platform === 'desktop') return (await import('./desktop')).saveFile(blob, filename);
  if (isMobileApp) return (await import('./mobile')).saveFile(blob, filename);
  downloadInBrowser(blob, filename);
  return true;
}

function downloadInBrowser(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Opens an http(s) or mailto link outside the app. */
export async function openExternal(url: string): Promise<void> {
  if (platform === 'desktop') return (await import('./desktop')).openExternal(url);
  // Capacitor hands any navigation away from the app's own host to the system browser.
  if (isMobileApp) return void location.assign(url);
  window.open(url, '_blank', 'noopener');
}

/**
 * Runs `save` before a desktop window closes, so pending edits reach storage
 * first. Browsers and mobile apps already fire `pagehide`/`visibilitychange`.
 */
export function onBeforeQuit(save: () => Promise<void> | void): () => void {
  if (platform !== 'desktop') return () => {};
  let off: (() => void) | undefined;
  let cancelled = false;
  void import('./desktop').then(async (d) => {
    const unlisten = await d.onCloseRequested(save);
    if (cancelled) unlisten();
    else off = unlisten;
  });
  return () => {
    cancelled = true;
    off?.();
  };
}

const EXTERNAL = /^(https?:|mailto:)/i;

/**
 * Native shells don't open new browser windows, so `target="_blank"` links in
 * documents would do nothing. Route them to the system browser instead.
 */
export function installNativeLinkHandler(): () => void {
  if (!isNativeApp) return () => {};
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button > 1) return;
    const target = e.target instanceof Node ? e.target : null;
    const el = target instanceof Element ? target : target?.parentElement;
    const a = el?.closest('a[href]');
    const href = a?.getAttribute('href') ?? '';
    if (!EXTERNAL.test(href)) return;
    e.preventDefault();
    void openExternal(href);
  };
  document.addEventListener('click', onClick);
  document.addEventListener('auxclick', onClick);
  return () => {
    document.removeEventListener('click', onClick);
    document.removeEventListener('auxclick', onClick);
  };
}
