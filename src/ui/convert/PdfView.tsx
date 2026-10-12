import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Download,
  Minus,
  Plus,
  Printer,
  Search,
} from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Entry } from '@/domain/types';
import { ws } from '@/app/app-store';
import { exportEntry } from '@/app/actions';
import { canPrint } from '@/platform';
import { loadPdfJs, pdfAssets } from './pdfjs';

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/**
 * PDFs in a page viewer that works the same on every platform (mobile web views can't
 * show PDFs themselves): pages render lazily, text is selectable and searchable, and
 * zoom, page navigation, download and print are in the toolbar.
 */
export function PdfView({ entry }: { entry: Entry }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<number[]>([]);
  const [hit, setHit] = useState(0);
  const texts = useRef<string[] | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const url = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let task: { destroy(): Promise<void> } | null = null;
    setDoc(null);
    setError(null);
    texts.current = null;
    void (async () => {
      try {
        const blob = await ws().readBlob(entry.id);
        if (!blob) throw new Error('The file could not be read.');
        const lib = await loadPdfJs();
        const data = new Uint8Array(await blob.arrayBuffer());
        const loading = lib.getDocument({ data, enableXfa: false, ...pdfAssets() });
        task = loading;
        const loaded = await loading.promise;
        if (cancelled) return;
        // On narrow screens start at the page width instead of cutting the page off.
        const first = (await loaded.getPage(1)).getViewport({ scale: 96 / 72 });
        const room = (scroller.current?.clientWidth ?? 0) - 32;
        if (cancelled) return;
        setZoom(room > 0 && first.width > room ? Math.max(0.25, room / first.width) : 1);
        setDoc(loaded);
        setPage(1);
      } catch (e) {
        if (cancelled) return;
        const name = (e as { name?: string }).name;
        setError(
          name === 'PasswordException'
            ? 'This PDF is password protected. Download it and open it in an app that can unlock it.'
            : name === 'InvalidPDFException'
              ? 'This file is damaged or is not a PDF.'
              : e instanceof Error
                ? e.message
                : String(e),
        );
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [entry.id, entry.updatedAt]);

  // Track the page at the top of the view.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !doc) return;
    const onScroll = () => {
      const pages = el.querySelectorAll<HTMLElement>('[data-page]');
      const top = el.getBoundingClientRect().top + 80;
      let current = 1;
      for (const p of pages)
        if (p.getBoundingClientRect().top <= top) current = Number(p.dataset.page);
      setPage(current);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [doc]);

  const goTo = useCallback((n: number) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-page="${n}"]`);
    el?.scrollIntoView({ block: 'start' });
    setPage(n);
  }, []);

  const runSearch = async (q: string) => {
    setQuery(q);
    if (!doc || !q.trim()) {
      setHits([]);
      return;
    }
    if (!texts.current) {
      const all: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i);
        const tc = await p.getTextContent();
        all.push(tc.items.map((it) => ('str' in it ? it.str : '')).join(' '));
      }
      texts.current = all;
    }
    const needle = q.trim().toLowerCase();
    const found = texts.current.flatMap((t, i) =>
      t.toLowerCase().includes(needle) ? [i + 1] : [],
    );
    setHits(found);
    setHit(0);
    if (found[0]) goTo(found[0]);
  };

  const download = () => void exportEntry(entry.id, 'file');
  const print = async () => {
    const blob = await ws().readBlob(entry.id);
    if (!blob) return;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    // The system PDF viewer prints the exact file; a new window is the portable way in.
    window.open(url.current, '_blank', 'noopener');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="toolbar"
        aria-label="PDF"
        data-testid="pdf-toolbar"
        className="ribbon flex min-h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-hairline-soft px-2 py-1 [scrollbar-width:none] no-print"
      >
        <span className="shrink-0 px-1 text-caption text-steel" aria-live="polite">
          {doc ? `Page ${page} of ${doc.numPages}` : 'PDF'}
        </span>
        <button
          type="button"
          className="icon-btn size-8"
          aria-label="Previous page"
          disabled={!doc || page <= 1}
          onClick={() => goTo(page - 1)}
        >
          <ChevronUp size={16} />
        </button>
        <button
          type="button"
          className="icon-btn size-8"
          aria-label="Next page"
          disabled={!doc || page >= doc.numPages}
          onClick={() => goTo(page + 1)}
        >
          <ChevronDown size={16} />
        </button>
        <span className="mx-1 h-5 w-px bg-hairline" aria-hidden />
        <button
          type="button"
          className="icon-btn size-8"
          aria-label="Zoom out"
          disabled={zoom <= ZOOMS[0]!}
          onClick={() => setZoom([...ZOOMS].reverse().find((z) => z < zoom - 0.001) ?? ZOOMS[0]!)}
        >
          <Minus size={16} />
        </button>
        <span className="w-12 shrink-0 text-center text-caption text-steel">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          className="icon-btn size-8"
          aria-label="Zoom in"
          disabled={zoom >= ZOOMS[ZOOMS.length - 1]!}
          onClick={() => setZoom(ZOOMS.find((z) => z > zoom + 0.001) ?? ZOOMS[ZOOMS.length - 1]!)}
        >
          <Plus size={16} />
        </button>
        <span className="mx-1 h-5 w-px bg-hairline" aria-hidden />
        <label className="relative flex shrink-0 items-center">
          <Search
            size={14}
            className="pointer-events-none absolute left-2 text-stone"
            aria-hidden
          />
          <input
            className="input h-8 w-40 py-0 pl-7 text-caption"
            placeholder="Find in PDF"
            aria-label="Find in PDF"
            value={query}
            disabled={!doc}
            onChange={(e) => void runSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hits.length) {
                const next = (hit + (e.shiftKey ? -1 : 1) + hits.length) % hits.length;
                setHit(next);
                goTo(hits[next]!);
              }
            }}
          />
        </label>
        {query.trim() && (
          <span className="shrink-0 text-caption text-steel" aria-live="polite">
            {hits.length ? `${hit + 1} of ${hits.length} pages` : 'No matches'}
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          className="icon-btn size-8"
          aria-label="Download"
          title="Download"
          onClick={download}
        >
          <Download size={16} />
        </button>
        {canPrint && (
          <button
            type="button"
            className="icon-btn size-8"
            aria-label="Open to print"
            title="Open in the system viewer to print"
            onClick={() => void print()}
          >
            <Printer size={16} />
          </button>
        )}
      </div>
      <div ref={scroller} className="scroll-area min-h-0 flex-1 bg-surface" data-testid="pdf-pages">
        {error && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <AlertTriangle className="text-warning" size={28} aria-hidden />
            <p className="font-medium text-ink">This PDF could not be shown</p>
            <p className="max-w-md text-caption text-steel">{error}</p>
            <button type="button" className="btn btn-secondary" onClick={download}>
              <Download size={15} aria-hidden /> Download
            </button>
          </div>
        )}
        {!doc && !error && (
          <div
            className="skeleton mx-auto my-6 h-[70vh] max-w-[680px]"
            aria-busy="true"
            aria-label="Loading PDF"
          />
        )}
        {doc && (
          // w-max + min-w-full: a page wider than the view scrolls from its left edge.
          <div className="flex w-max min-w-full flex-col items-center gap-4 p-4">
            {Array.from({ length: doc.numPages }, (_, i) => (
              <PdfPage key={`${i}-${zoom}`} doc={doc} n={i + 1} zoom={zoom} query={query.trim()} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function PdfPage({
  doc,
  n,
  zoom,
  query,
}: {
  doc: PDFDocumentProxy;
  n: number;
  zoom: number;
  query: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textLayer = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [visible, setVisible] = useState(n <= 2);
  // Bumped when the text layer has been drawn, so search highlights can be applied to it.
  const [layerReady, setLayerReady] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void doc.getPage(n).then((p) => {
      if (cancelled) return;
      const v = p.getViewport({ scale: zoom * (96 / 72) });
      setSize({ w: v.width, h: v.height });
    });
    return () => {
      cancelled = true;
    };
  }, [doc, n, zoom]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (e) => e.some((x) => x.isIntersecting) && setVisible(true),
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !size) return;
    let cancelled = false;
    let task: { cancel(): void } | null = null;
    void (async () => {
      const lib = await loadPdfJs();
      const p = await doc.getPage(n);
      if (cancelled || !canvas.current || !textLayer.current) return;
      const viewport = p.getViewport({ scale: zoom * (96 / 72) });
      const ratio = window.devicePixelRatio || 1;
      const c = canvas.current;
      c.width = Math.floor(viewport.width * ratio);
      c.height = Math.floor(viewport.height * ratio);
      const render = p.render({
        canvas: c,
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
      });
      task = render;
      await render.promise.catch(() => undefined);
      if (cancelled) return;
      textLayer.current.replaceChildren();
      textLayer.current.style.setProperty('--scale-factor', String(viewport.scale));
      textLayer.current.style.setProperty('--total-scale-factor', String(viewport.scale));
      const tl = new lib.TextLayer({
        textContentSource: p.streamTextContent(),
        container: textLayer.current,
        viewport,
      });
      await tl.render().catch(() => undefined);
      if (!cancelled) setLayerReady((v) => v + 1);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, size, doc, n, zoom]);

  // Highlight search matches in this page's text layer, also when it finishes after the search.
  useEffect(() => {
    const el = textLayer.current;
    if (!el) return;
    const needle = query.toLowerCase();
    for (const span of el.querySelectorAll('span'))
      span.classList.toggle(
        'pdf-hit',
        !!needle && (span.textContent ?? '').toLowerCase().includes(needle),
      );
  }, [query, layerReady]);

  return (
    <div
      ref={box}
      data-page={n}
      className="relative shrink-0 bg-white shadow-1"
      style={
        size
          ? { width: size.w, height: size.h }
          : { width: 612 * zoom * (96 / 72), height: 792 * zoom * (96 / 72) }
      }
      aria-label={`Page ${n}`}
      role="img"
    >
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden />
      <div ref={textLayer} className="pdf-text-layer" />
    </div>
  );
}
