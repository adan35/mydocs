import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { loadPdfJs, pdfAssets } from './pdfjs';
import { PdfPage } from './PdfView';

const SHOWN = 3;

/** The first pages of a PDF that hasn't been saved yet: the real file, rendered. */
export function PdfPreview({ blob }: { blob: Blob }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.62);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let task: { destroy(): Promise<void> } | null = null;
    setDoc(null);
    setError(null);
    void (async () => {
      try {
        const lib = await loadPdfJs();
        const data = new Uint8Array(await blob.arrayBuffer());
        const loading = lib.getDocument({ data, enableXfa: false, ...pdfAssets() });
        task = loading;
        const loaded = await loading.promise;
        // Fit the page to the dialog, however narrow it is.
        const first = (await loaded.getPage(1)).getViewport({ scale: 96 / 72 });
        const room = (box.current?.clientWidth ?? 0) - 24;
        if (cancelled) return;
        setZoom(room > 0 ? Math.min(0.75, room / first.width) : 0.62);
        setDoc(loaded);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [blob]);

  if (error) return <p className="p-4 text-caption text-danger">The preview failed: {error}</p>;
  if (!doc)
    return (
      <div ref={box} className="p-3">
        <div className="skeleton h-64" aria-busy="true" aria-label="Loading preview" />
      </div>
    );
  return (
    <div ref={box} data-testid="pdf-preview" className="bg-surface px-3 py-3">
      <div className="flex flex-col items-center gap-3">
        {Array.from({ length: Math.min(SHOWN, doc.numPages) }, (_, i) => (
          <PdfPage key={`${i}-${zoom}`} doc={doc} n={i + 1} zoom={zoom} query="" />
        ))}
      </div>
      <p className="mt-2 text-center text-caption text-steel">
        {doc.numPages > SHOWN
          ? `Showing the first ${SHOWN} of ${doc.numPages} pages`
          : `${doc.numPages} page${doc.numPages === 1 ? '' : 's'}`}
      </p>
    </div>
  );
}
