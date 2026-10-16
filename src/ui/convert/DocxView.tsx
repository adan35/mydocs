import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, FileOutput } from 'lucide-react';
import type { Entry } from '@/domain/types';
import { ws } from '@/app/app-store';
import { exportEntry } from '@/app/actions';
import { convert } from '@/lib/convert/client';
import { MEDIA_SRC } from '@/lib/convert/docx';
import type { ReportData } from '@/lib/convert/doc-ast';
import { StaticMarkdown, type MediaItem } from './StaticMarkdown';
import { ReportList } from './ReportList';
import { publishOutline } from '@/app/outline-store';
import { textOutline } from '../document/text-outline';

/**
 * A Word document shown formatted, read-only. Editing means converting to Markdown,
 * which creates a new document and leaves the .docx untouched.
 */
export function DocxView({ entry, onConvert }: { entry: Entry; onConvert(): void }) {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'ready'; markdown: string; media: Record<string, MediaItem>; report: ReportData }
  >({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    void (async () => {
      try {
        const blob = await ws().readBlob(entry.id);
        if (!blob) throw new Error('The file could not be read.');
        const out = await convert('docxToMarkdown', {
          data: new Uint8Array(await blob.arrayBuffer()),
        });
        const media: Record<string, MediaItem> = {};
        for (const m of out.media)
          media[MEDIA_SRC + m.name] = {
            blob: new Blob([m.data as BlobPart], { type: m.mime }),
            width: m.width,
          };
        if (!cancelled)
          setState({ kind: 'ready', markdown: out.markdown, media, report: out.report });
      } catch (e) {
        if (!cancelled)
          setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry.id, entry.updatedAt]);

  // Outline: the Word file's headings, tracked as you scroll.
  const scroller = useRef<HTMLDivElement>(null);
  const markdown = state.kind === 'ready' ? state.markdown : '';
  const outline = useMemo(() => textOutline(markdown, 'document.md'), [markdown]);
  const [active, setActive] = useState(-1);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !outline.items.length) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const top = el.getBoundingClientRect().top + 60;
        let i = -1;
        for (const [k, line] of outline.lines.entries()) {
          const h = el.querySelector(`[data-line="${line}"]`);
          if (h && h.getBoundingClientRect().top <= top) i = k;
          else if (h) break;
        }
        setActive(i);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [outline]);
  useEffect(() => {
    if (state.kind !== 'ready') return;
    publishOutline(entry.id, {
      items: outline.items,
      active,
      noun: 'headings',
      summary: outline.summary,
      empty: 'This Word document has no headings. Headings (Heading 1, Heading 2…) appear here.',
      jump: (i) => {
        const line = outline.lines[i];
        const h = scroller.current?.querySelector(`[data-line="${line}"]`);
        h?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        setActive(i);
      },
    });
  }, [entry.id, state.kind, outline, active]);
  useEffect(() => () => publishOutline(entry.id, null), [entry.id]);

  const hidden =
    state.kind === 'ready'
      ? {
          ...state.report,
          notes: state.report.notes.filter((n) => n.severity === 'warning'),
        }
      : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline-soft px-3 py-2 text-caption text-steel no-print">
        <span className="min-w-[min(100%,16rem)] flex-1">
          Word document · read only. Convert it to Markdown to edit; the original stays as it is.
        </span>
        <button
          type="button"
          className="btn btn-secondary h-8"
          onClick={() => void exportEntry(entry.id, 'file')}
        >
          <Download size={14} aria-hidden /> Download
        </button>
        <button type="button" className="btn btn-primary h-8" onClick={onConvert}>
          <FileOutput size={14} aria-hidden /> Convert or export…
        </button>
      </div>
      <div ref={scroller} className="scroll-area min-h-0 flex-1">
        <div className="mx-auto max-w-[840px] px-5 pt-8 pb-24 sm:px-10">
          {state.kind === 'loading' && (
            <div className="skeleton h-60" aria-busy="true" aria-label="Loading document" />
          )}
          {state.kind === 'error' && (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <AlertTriangle className="text-warning" size={28} aria-hidden />
              <p className="font-medium text-ink">This Word document could not be opened</p>
              <p className="max-w-md text-caption text-steel">{state.message}</p>
            </div>
          )}
          {state.kind === 'ready' && (
            <>
              {/* Notes about what Markdown can't hold don't apply to this view. */}
              {hidden!.notes.length > 0 && (
                <details className="card mb-6 p-3 text-caption">
                  <summary className="cursor-pointer text-charcoal">
                    Some parts of this file are not shown ({hidden!.notes.length})
                  </summary>
                  <ReportList report={hidden!} />
                </details>
              )}
              <StaticMarkdown text={state.markdown} media={state.media} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
