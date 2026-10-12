import type { EditorView } from '@codemirror/view';

/**
 * Two-way scroll sync between the source editor and the preview in split view.
 *
 * Positions are matched by source blocks, not by scroll percentage: each rendered
 * element with `data-line` is an anchor whose position is known on both sides
 * (CodeMirror's line heights and the element's offset), and positions between anchors
 * are interpolated. Different wrapping, tall images, code blocks and tables therefore
 * line up block by block.
 *
 * The pane the user is interacting with is authoritative: only it drives the other,
 * scroll events caused by syncing are ignored, and layout changes (images loading,
 * edits, resizing) re-align the other pane without moving the active one.
 */
export type Pane = 'editor' | 'preview';

interface Anchor {
  e: number;
  p: number;
}

export class ScrollSync {
  enabled = true;
  /** The pane the user last touched; it drives the other one. */
  authority: Pane = 'editor';
  private previewAnchors: { line: number; endLine: number; top: number; bottom: number }[] | null =
    null;
  private expected: Record<Pane, number | null> = { editor: null, preview: null };
  private raf = 0;
  private observers: (ResizeObserver | MutationObserver)[] = [];
  private cleanups: (() => void)[] = [];

  constructor(
    private getEditor: () => EditorView | null,
    private getPreview: () => { root: HTMLElement; scroller: HTMLElement } | null,
  ) {}

  /** Starts listening. Call again after either pane is replaced. */
  connect() {
    this.disconnect();
    const view = this.getEditor();
    const pv = this.getPreview();
    if (!view || !pv) return;
    const take = (pane: Pane) => () => (this.authority = pane);
    const on = (el: HTMLElement, pane: Pane) => {
      const t = take(pane);
      for (const ev of ['pointerdown', 'wheel', 'touchstart', 'keydown', 'focusin'] as const)
        el.addEventListener(ev, t, { passive: true });
      const scroll = () => this.onScroll(pane);
      const scrollEl = pane === 'editor' ? view.scrollDOM : pv.scroller;
      scrollEl.addEventListener('scroll', scroll, { passive: true });
      this.cleanups.push(() => {
        for (const ev of ['pointerdown', 'wheel', 'touchstart', 'keydown', 'focusin'] as const)
          el.removeEventListener(ev, t);
        scrollEl.removeEventListener('scroll', scroll);
      });
    };
    on(view.dom, 'editor');
    on(pv.scroller, 'preview');
    // Layout changes on either side: images loading, edits, resizing, fonts.
    const relayout = () => this.invalidate();
    const ro = new ResizeObserver(relayout);
    ro.observe(pv.root);
    ro.observe(pv.scroller);
    ro.observe(view.scrollDOM);
    const mo = new MutationObserver(relayout);
    mo.observe(pv.root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'style'],
    });
    this.observers.push(ro, mo);
    const onLoad = (e: Event) => {
      if (e.target instanceof HTMLImageElement) relayout();
    };
    pv.root.addEventListener('load', onLoad, true);
    this.cleanups.push(() => pv.root.removeEventListener('load', onLoad, true));
  }

  disconnect() {
    for (const o of this.observers) o.disconnect();
    this.observers = [];
    for (const c of this.cleanups) c();
    this.cleanups = [];
    cancelAnimationFrame(this.raf);
  }

  /** The preview's layout changed: re-measure, then realign the passive pane. */
  invalidate() {
    this.previewAnchors = null;
    this.schedule(this.authority);
  }

  private onScroll(pane: Pane) {
    const top = this.scrollerOf(pane)?.scrollTop ?? 0;
    const exp = this.expected[pane];
    if (exp !== null && Math.abs(top - exp) < 2) {
      this.expected[pane] = null;
      return; // our own scroll
    }
    this.expected[pane] = null;
    if (pane !== this.authority) return;
    this.schedule(pane);
  }

  private schedule(from: Pane) {
    if (!this.enabled) return;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.sync(from));
  }

  private scrollerOf(pane: Pane): HTMLElement | null {
    return pane === 'editor'
      ? (this.getEditor()?.scrollDOM ?? null)
      : (this.getPreview()?.scroller ?? null);
  }

  /** Anchor positions (scroll offsets) on both sides, in source order. */
  anchors(): Anchor[] {
    const view = this.getEditor();
    const pv = this.getPreview();
    if (!view || !pv) return [];
    if (!this.previewAnchors) {
      const base = pv.scroller.getBoundingClientRect().top - pv.scroller.scrollTop;
      const list: { line: number; endLine: number; top: number; bottom: number }[] = [];
      for (const el of pv.root.querySelectorAll<HTMLElement>('[data-line]')) {
        const r = el.getBoundingClientRect();
        if (!r.height) continue;
        list.push({
          line: Number(el.dataset.line),
          endLine: Number(el.dataset.lineEnd ?? el.dataset.line),
          top: r.top - base,
          bottom: r.bottom - base,
        });
      }
      this.previewAnchors = list;
    }
    const doc = view.state.doc;
    const editorTopOf = (line: number) => {
      const l = doc.line(Math.min(Math.max(1, line + 1), doc.lines));
      return view.lineBlockAt(l.from).top;
    };
    const editorBottomOf = (line: number) => {
      const l = doc.line(Math.min(Math.max(1, line), doc.lines));
      return view.lineBlockAt(l.to).bottom;
    };
    // Offset of the document inside the editor's scroller (padding).
    const pad =
      view.documentTop - view.scrollDOM.getBoundingClientRect().top + view.scrollDOM.scrollTop;
    const out: Anchor[] = [{ e: 0, p: 0 }];
    const push = (e: number, p: number) => {
      const last = out[out.length - 1]!;
      // Keep both sides strictly increasing so interpolation is well defined.
      if (e > last.e && p > last.p) out.push({ e, p });
    };
    for (const a of this.previewAnchors) {
      if (a.line >= doc.lines) continue;
      push(editorTopOf(a.line) + pad, a.top);
      // Tall blocks (code, tables, images) also align at their end.
      if (a.endLine - a.line > 2 && a.endLine <= doc.lines)
        push(editorBottomOf(a.endLine) + pad, a.bottom);
    }
    const eMax = view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight;
    const pMax = pv.scroller.scrollHeight - pv.scroller.clientHeight;
    // The ends of both documents meet, so scrolling to the bottom shows both endings.
    while (out.length > 1 && (out[out.length - 1]!.e >= eMax || out[out.length - 1]!.p >= pMax))
      out.pop();
    out.push({
      e: Math.max(eMax, out[out.length - 1]!.e + 1),
      p: Math.max(pMax, out[out.length - 1]!.p + 1),
    });
    return out;
  }

  /** Moves the other pane to match `from`. */
  sync(from: Pane) {
    if (!this.enabled) return;
    const src = this.scrollerOf(from);
    const dst = this.scrollerOf(from === 'editor' ? 'preview' : 'editor');
    if (!src || !dst) return;
    const target = mapPosition(this.anchors(), src.scrollTop, from === 'editor' ? 'e' : 'p');
    const max = dst.scrollHeight - dst.clientHeight;
    const next = Math.round(Math.min(Math.max(0, target), Math.max(0, max)));
    if (Math.abs(dst.scrollTop - next) < 1) return;
    this.expected[from === 'editor' ? 'preview' : 'editor'] = next;
    dst.scrollTop = next;
  }
}

/** Interpolates a scroll position from one side's anchors to the other's. */
export function mapPosition(anchors: Anchor[], y: number, from: 'e' | 'p'): number {
  const to = from === 'e' ? 'p' : 'e';
  if (!anchors.length) return 0;
  if (y <= anchors[0]![from]) return anchors[0]![to];
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1]!;
    const b = anchors[i]!;
    if (y <= b[from]) {
      const t = (y - a[from]) / (b[from] - a[from] || 1);
      return a[to] + t * (b[to] - a[to]);
    }
  }
  return anchors[anchors.length - 1]![to];
}
