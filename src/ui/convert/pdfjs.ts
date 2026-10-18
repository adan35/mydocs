import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';

type PdfJs = typeof import('pdfjs-dist');
let pdfjs: Promise<PdfJs> | null = null;

/**
 * Loaded only when a PDF is opened or previewed; the worker is served from this app (CSP 'self').
 * The legacy build carries polyfills the modern one assumes (e.g. Map.getOrInsertComputed),
 * which older Chromium, Android WebViews and Safari/WKWebView don't have yet.
 */
export function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib as unknown as PdfJs;
  });
  return pdfjs;
}

/**
 * Where pdf.js finds the files it needs for PDFs that rely on them: character maps (Chinese,
 * Japanese, Korean and other non-Latin text), the standard fonts, JPEG 2000 and color
 * profiles. They are part of this app's build.
 */
export function pdfAssets(): Pick<
  DocumentInitParameters,
  'cMapUrl' | 'cMapPacked' | 'standardFontDataUrl' | 'wasmUrl' | 'iccUrl'
> {
  const base = new URL(`${import.meta.env.BASE_URL}pdfjs/`, location.href).href;
  return {
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    iccUrl: `${base}iccs/`,
  };
}
