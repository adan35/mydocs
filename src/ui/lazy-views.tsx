/**
 * Format views and conversion dialogs load on first use, so opening the app doesn't
 * pay for the spreadsheet engine, the Office adapters or the PDF viewer.
 */
import { lazy, Suspense, type ComponentProps, type ComponentType } from 'react';

function deferred<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  const Lazy = lazy(async () => ({ default: await load() }));
  return function Deferred(props: P) {
    return (
      <Suspense fallback={<div className="h-full" aria-busy="true" />}>
        <Lazy {...(props as ComponentProps<typeof Lazy>)} />
      </Suspense>
    );
  };
}

export const TextSheetView = deferred(() =>
  import('./sheet/TextSheetView').then((m) => m.TextSheetView),
);
export const XlsxView = deferred(() => import('./sheet/XlsxView').then((m) => m.XlsxView));
export const DocxView = deferred(() => import('./convert/DocxView').then((m) => m.DocxView));
export const PdfView = deferred(() => import('./convert/PdfView').then((m) => m.PdfView));
export const ConvertDialog = deferred(() =>
  import('./convert/ConvertDialog').then((m) => m.ConvertDialog),
);
export const FormatsDialog = deferred(() =>
  import('./convert/FormatsDialog').then((m) => m.FormatsDialog),
);
