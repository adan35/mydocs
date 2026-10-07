import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Network, Plus, RotateCcw } from 'lucide-react';
import type { EntryId } from '@/domain/types';
import { ForceLayout } from '@/domain/graph-layout';
import { session } from '@/app/app-store';
import { buildGraph, type GraphData } from '@/app/graph';
import { openEntry } from '@/app/actions';
import { navigate } from '@/app/router';
import { useEditor } from '@/app/editor-store';
import { Page } from '../components/Page';
import { useIndexVersion, useResolvedTheme, useTree } from '../hooks';

/** Above this many documents only the best-connected ones are drawn. */
const MAX_NODES = 2000;

interface View {
  x: number;
  y: number;
  k: number;
}

/**
 * Optional map of how documents link to each other. Zoom with the wheel or the
 * buttons, drag to pan or move a node, click a node to open it.
 */
export function GraphView({ focusId }: { focusId?: string }) {
  const tree = useTree()!;
  const indexVersion = useIndexVersion();
  const theme = useResolvedTheme();
  const activeId = useEditor((s) => s.activeId);
  const [folderId, setFolderId] = useState('');
  const [tag, setTag] = useState('');
  const [depth, setDepth] = useState(1);
  const [orphans, setOrphans] = useState(false);
  const local = !!focusId && !!tree.get(focusId);

  const graph = useMemo<GraphData & { truncated: boolean }>(() => {
    const g = buildGraph(tree, session().knowledge, {
      folderId: folderId || undefined,
      tag: tag || undefined,
      focusId: local ? focusId : undefined,
      depth,
      orphans,
    });
    if (g.ids.length <= MAX_NODES) return { ...g, truncated: false };
    // Keep the best-connected documents.
    const keep = g.ids
      .map((_, i) => i)
      .sort((a, b) => g.degree[b]! - g.degree[a]!)
      .slice(0, MAX_NODES);
    const map = new Map(keep.map((old, i) => [old, i]));
    return {
      ids: keep.map((i) => g.ids[i]!),
      labels: keep.map((i) => g.labels[i]!),
      degree: keep.map((i) => g.degree[i]!),
      edges: g.edges
        .filter(([a, b]) => map.has(a) && map.has(b))
        .map(([a, b]) => [map.get(a)!, map.get(b)!] as [number, number]),
      truncated: true,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, indexVersion, folderId, tag, depth, orphans, focusId, local]);

  const tags = useMemo(
    () => session().knowledge.allTags(tree),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tree, indexVersion],
  );
  const folders = useMemo(
    () =>
      tree
        .liveEntries()
        .filter((e) => e.kind === 'folder')
        .map((e) => ({ id: e.id, path: tree.pathOf(e.id) }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    [tree],
  );

  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ x: 0, y: 0, k: 1 });
  const hover = useRef<number>(-1);
  const draw = useRef<() => void>(() => {});
  const fitView = useRef<() => void>(() => {});
  /** Tells the canvas effect the user zoomed, so auto-fit stops. */
  const zoomed = useRef<() => void>(() => {});
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext('2d')!;
    const layout = new ForceLayout(graph.ids.length, graph.edges);
    const neighbours = graph.ids.map(() => new Set<number>());
    for (const [a, b] of graph.edges) {
      neighbours[a]!.add(b);
      neighbours[b]!.add(a);
    }
    const focusIndex = local ? graph.ids.indexOf(focusId!) : -1;
    const css = getComputedStyle(document.documentElement);
    const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const colors = {
      node: color('--steel', '#787774'),
      focus: color('--primary', '#5645d4'),
      edge: color('--hairline-strong', '#d3d1cb'),
      label: color('--charcoal', '#37352f'),
      bg: color('--canvas', '#ffffff'),
    };
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let width = 0;
    let height = 0;

    const radius = (i: number) => 3.5 + Math.min(9, Math.sqrt(graph.degree[i]!) * 1.6);
    const toScreen = (x: number, y: number): [number, number] => {
      const v = view.current;
      return [width / 2 + (x + v.x) * v.k, height / 2 + (y + v.y) * v.k];
    };
    const toWorld = (sx: number, sy: number): [number, number] => {
      const v = view.current;
      return [(sx - width / 2) / v.k - v.x, (sy - height / 2) / v.k - v.y];
    };
    const nodeAt = (sx: number, sy: number) => {
      const [wx, wy] = toWorld(sx, sy);
      let best = -1;
      let bestD = Infinity;
      layout.nodes.forEach((n, i) => {
        const d = Math.hypot(n.x - wx, n.y - wy);
        if (d < Math.max(radius(i) + 4, 10 / view.current.k) && d < bestD) {
          best = i;
          bestD = d;
        }
      });
      return best;
    };

    const render = () => {
      const dpr = devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, width, height);
      const h = hover.current;
      const lit = h >= 0 ? neighbours[h]! : null;
      ctx.lineWidth = 1;
      for (const [a, b] of graph.edges) {
        const on = h >= 0 && (a === h || b === h);
        ctx.strokeStyle = on ? colors.focus : colors.edge;
        ctx.globalAlpha = h >= 0 && !on ? 0.35 : 1;
        const [x1, y1] = toScreen(layout.nodes[a]!.x, layout.nodes[a]!.y);
        const [x2, y2] = toScreen(layout.nodes[b]!.x, layout.nodes[b]!.y);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      const k = view.current.k;
      ctx.font = '12px Inter Variable, Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      layout.nodes.forEach((n, i) => {
        const [x, y] = toScreen(n.x, n.y);
        if (x < -40 || y < -40 || x > width + 40 || y > height + 40) return;
        const dim = h >= 0 && i !== h && !lit!.has(i);
        ctx.globalAlpha = dim ? 0.3 : 1;
        ctx.fillStyle = i === h || i === focusIndex ? colors.focus : colors.node;
        ctx.beginPath();
        ctx.arc(x, y, radius(i) * Math.min(1.6, Math.max(0.7, k)), 0, Math.PI * 2);
        ctx.fill();
        const showLabel =
          i === h ||
          i === focusIndex ||
          (lit?.has(i) ?? false) ||
          k > 1.1 ||
          graph.ids.length <= 60 ||
          graph.degree[i]! > 6;
        if (showLabel && !dim) {
          ctx.fillStyle = colors.label;
          ctx.fillText(graph.labels[i]!, x, y + radius(i) * Math.max(0.7, k) + 13);
        }
      });
      ctx.globalAlpha = 1;
    };
    draw.current = render;

    const resize = () => {
      const rect = el.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = devicePixelRatio || 1;
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
      render();
    };
    let interacted = false;
    /** Zooms so the whole graph fits, unless the user already moved the view. */
    const fit = () => {
      if (interacted || !layout.nodes.length || !width) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const n of layout.nodes) {
        minX = Math.min(minX, n.x);
        maxX = Math.max(maxX, n.x);
        minY = Math.min(minY, n.y);
        maxY = Math.max(maxY, n.y);
      }
      const fitK = Math.min(
        (width - 120) / (maxX - minX || 1),
        (height - 100) / (maxY - minY || 1),
      );
      const k = Math.min(2.2, Math.max(0.15, fitK));
      view.current = { x: -(minX + maxX) / 2, y: -(minY + maxY) / 2, k };
    };
    zoomed.current = () => (interacted = true);
    fitView.current = () => {
      interacted = false;
      fit();
      render();
    };
    const tick = () => {
      // Several ticks per frame: the graph settles quickly, then rendering stops.
      for (let i = 0; i < (reduceMotion ? 40 : 3) && !layout.settled; i++) layout.step();
      fit();
      render();
      if (!layout.settled) raf = requestAnimationFrame(tick);
    };
    if (reduceMotion) while (!layout.settled) layout.step();
    view.current = { x: 0, y: 0, k: graph.ids.length > 400 ? 0.5 : 1 };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    raf = requestAnimationFrame(tick);

    // Pointer: drag a node, pan the canvas, click to open.
    let drag: {
      node: number;
      sx: number;
      sy: number;
      vx: number;
      vy: number;
      moved: boolean;
    } | null = null;
    const pos = (e: PointerEvent): [number, number] => {
      const r = el.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const onDown = (e: PointerEvent) => {
      const [sx, sy] = pos(e);
      const node = nodeAt(sx, sy);
      drag = { node, sx, sy, vx: view.current.x, vy: view.current.y, moved: false };
      interacted = true;
      if (node >= 0) layout.nodes[node]!.fixed = true;
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const [sx, sy] = pos(e);
      if (!drag) {
        const node = nodeAt(sx, sy);
        if (node !== hover.current) {
          hover.current = node;
          setHoverLabel(node >= 0 ? graph.labels[node]! : null);
          el.style.cursor = node >= 0 ? 'pointer' : 'grab';
          render();
        }
        return;
      }
      if (Math.hypot(sx - drag.sx, sy - drag.sy) > 3) drag.moved = true;
      if (drag.node >= 0) {
        const [wx, wy] = toWorld(sx, sy);
        const n = layout.nodes[drag.node]!;
        n.x = wx;
        n.y = wy;
        layout.reheat(0.2);
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(tick);
      } else {
        view.current.x = drag.vx + (sx - drag.sx) / view.current.k;
        view.current.y = drag.vy + (sy - drag.sy) / view.current.k;
        render();
      }
    };
    const onUp = () => {
      if (!drag) return;
      if (drag.node >= 0) {
        layout.nodes[drag.node]!.fixed = false;
        if (!drag.moved) void openEntry(graph.ids[drag.node]!);
      }
      drag = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      interacted = true;
      const [sx, sy] = (() => {
        const r = el.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
      })();
      const [wx, wy] = toWorld(sx, sy);
      const k = Math.min(4, Math.max(0.15, view.current.k * Math.exp(-e.deltaY * 0.0015)));
      view.current.k = k;
      // Keep the point under the cursor in place.
      view.current.x = (sx - width / 2) / k - wx;
      view.current.y = (sy - height / 2) / k - wy;
      render();
    };
    const onLeave = () => {
      if (hover.current !== -1) {
        hover.current = -1;
        setHoverLabel(null);
        render();
      }
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('wheel', onWheel);
    };
  }, [graph, theme, local, focusId]);

  const zoom = (factor: number) => {
    zoomed.current();
    view.current.k = Math.min(4, Math.max(0.15, view.current.k * factor));
    draw.current();
  };
  const reset = () => fitView.current();
  const localTarget = focusId ?? activeId;

  return (
    <Page
      title={local ? `Graph · ${tree.get(focusId!)!.name}` : 'Graph'}
      icon={<Network />}
      subtitle={`${graph.ids.length} document${graph.ids.length === 1 ? '' : 's'} · ${graph.edges.length} link${graph.edges.length === 1 ? '' : 's'}${graph.truncated ? ` · showing the ${MAX_NODES} best-connected` : ''}`}
    >
      <div
        className="mb-3 flex flex-wrap items-center gap-1.5"
        role="group"
        aria-label="Graph options"
      >
        <div
          className="flex rounded-full border border-hairline p-0.5"
          role="group"
          aria-label="Scope"
        >
          <button
            type="button"
            aria-pressed={!local}
            className={`h-6 rounded-full px-3 text-caption ${!local ? 'bg-ink text-canvas' : 'text-steel hover:bg-hover'}`}
            onClick={() => navigate({ name: 'graph' }, { replace: true })}
          >
            Whole workspace
          </button>
          <button
            type="button"
            aria-pressed={local}
            disabled={!localTarget || !tree.get(localTarget)}
            title={localTarget ? undefined : 'Open a document first'}
            className={`h-6 rounded-full px-3 text-caption disabled:opacity-40 ${local ? 'bg-ink text-canvas' : 'text-steel hover:bg-hover'}`}
            onClick={() =>
              localTarget && navigate({ name: 'graph', id: localTarget }, { replace: true })
            }
          >
            Local
          </button>
        </div>
        {local && (
          <select
            className="input h-7 w-auto rounded-full py-0 text-caption"
            aria-label="Link depth"
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
          >
            <option value={1}>1 link away</option>
            <option value={2}>2 links away</option>
            <option value={3}>3 links away</option>
          </select>
        )}
        <select
          className="input h-7 w-auto max-w-[200px] rounded-full py-0 text-caption"
          aria-label="Filter by folder"
          value={folderId}
          onChange={(e) => setFolderId(e.target.value)}
        >
          <option value="">All folders</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.path}
            </option>
          ))}
        </select>
        <select
          className="input h-7 w-auto max-w-[160px] rounded-full py-0 text-caption"
          aria-label="Filter by tag"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
        >
          <option value="">Any tag</option>
          {tags.map((t) => (
            <option key={t.tag} value={t.tag}>
              #{t.tag}
            </option>
          ))}
        </select>
        <label className="flex h-7 items-center gap-1.5 px-2 text-caption text-steel">
          <input type="checkbox" checked={orphans} onChange={(e) => setOrphans(e.target.checked)} />
          Unlinked documents
        </label>
      </div>
      <div className="relative overflow-hidden rounded-lg border border-hairline">
        <canvas
          ref={canvas}
          className="block h-[min(70vh,720px)] w-full touch-none"
          role="img"
          aria-label={`Graph of ${graph.ids.length} linked documents. The list below has the same documents.`}
        />
        <div
          className="absolute right-2 bottom-2 flex gap-0.5 rounded-lg border border-hairline bg-canvas p-0.5"
          role="group"
          aria-label="Zoom"
        >
          <button
            type="button"
            className="icon-btn"
            aria-label="Zoom out"
            onClick={() => zoom(1 / 1.3)}
          >
            <Minus size={16} />
          </button>
          <button type="button" className="icon-btn" aria-label="Zoom in" onClick={() => zoom(1.3)}>
            <Plus size={16} />
          </button>
          <button type="button" className="icon-btn" aria-label="Fit to screen" onClick={reset}>
            <RotateCcw size={15} />
          </button>
        </div>
        {hoverLabel && (
          <div className="pointer-events-none absolute top-2 left-2 rounded-md bg-canvas px-2 py-1 text-caption text-ink shadow-1">
            {hoverLabel}
          </div>
        )}
        {!graph.ids.length && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-[14px] text-steel">
            {orphans || folderId || tag
              ? 'No documents match these filters.'
              : 'Link documents with [[Name]] or [text](./file.md) and they appear here.'}
          </div>
        )}
      </div>
      <details className="mt-4">
        <summary className="cursor-pointer text-caption text-steel">
          Documents in this graph ({graph.ids.length})
        </summary>
        <ul className="mt-2 columns-1 gap-6 text-[13px] sm:columns-2">
          {graph.ids.map((id: EntryId, i) => (
            <li key={id}>
              <button
                type="button"
                className="rounded px-1 py-0.5 text-left text-charcoal hover:bg-hover"
                onClick={() => void openEntry(id)}
              >
                {graph.labels[i]} <span className="text-stone">· {graph.degree[i]} links</span>
              </button>
            </li>
          ))}
        </ul>
      </details>
    </Page>
  );
}
