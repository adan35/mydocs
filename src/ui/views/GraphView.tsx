import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FilePlus2, Minus, Network, Plus, RotateCcw, Search, X } from 'lucide-react';
import type { EntryId } from '@/domain/types';
import { ForceLayout } from '@/domain/graph-layout';
import { session } from '@/app/app-store';
import { buildGraph, isGhost, SUGGEST_LIMIT, type GraphData } from '@/app/graph';
import { createLinkedDocument, openEntry } from '@/app/actions';
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
 * Where each node was last drawn, so the graph keeps its shape when a filter changes,
 * a document is added or the view is opened again. Lives for the session only.
 */
const positions = new Map<string, { x: number; y: number }>();

type Graph = GraphData & { truncated: boolean };

function truncate(g: GraphData): Graph {
  if (g.ids.length <= MAX_NODES) return { ...g, truncated: false };
  // Keep the best-connected documents.
  const keep = g.ids
    .map((_, i) => i)
    .sort((a, b) => g.degree[b]! - g.degree[a]!)
    .slice(0, MAX_NODES);
  const map = new Map(keep.map((old, i) => [old, i]));
  const pairs = (list: [number, number][]) =>
    list
      .filter(([a, b]) => map.has(a) && map.has(b))
      .map(([a, b]) => [map.get(a)!, map.get(b)!] as [number, number]);
  return {
    ...g,
    ids: keep.map((i) => g.ids[i]!),
    kinds: keep.map((i) => g.kinds[i]!),
    labels: keep.map((i) => g.labels[i]!),
    details: keep.map((i) => g.details[i]!),
    degree: keep.map((i) => g.degree[i]!),
    edges: pairs(g.edges),
    suggested: pairs(g.suggested),
    truncated: true,
  };
}

/**
 * Map of how documents link to each other, built from the links actually written in
 * them. Zoom with the wheel or the buttons, drag to pan or move a node, click a node
 * to select it (its neighbours light up), double-click to open it.
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
  const [unresolved, setUnresolved] = useState(false);
  const [suggested, setSuggested] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const local = !!focusId && !!tree.get(focusId);

  const graph = useMemo<Graph>(
    () =>
      truncate(
        buildGraph(tree, session().knowledge, {
          folderId: folderId || undefined,
          tag: tag || undefined,
          focusId: local ? focusId : undefined,
          depth,
          orphans,
          unresolved,
          suggested: suggested ? session().workspace.allTexts() : undefined,
        }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tree, indexVersion, folderId, tag, depth, orphans, unresolved, suggested, focusId, local],
  );

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

  const needle = query.trim().toLocaleLowerCase();
  const matches = useMemo(
    () =>
      needle
        ? graph.ids.flatMap((_, i) =>
            graph.labels[i]!.toLocaleLowerCase().includes(needle) ? [i] : [],
          )
        : [],
    [graph, needle],
  );
  const selected = selectedId ? graph.ids.indexOf(selectedId) : -1;

  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ x: 0, y: 0, k: 1 });
  const hover = useRef<number>(-1);
  /** What the canvas effect reads on every frame without being rebuilt. */
  const live = useRef({ selected, matches: new Set<number>(), searching: false });
  live.current = { selected, matches: new Set(matches), searching: !!needle };
  const draw = useRef<() => void>(() => {});
  const fitView = useRef<() => void>(() => {});
  const centerOn = useRef<(i: number) => void>(() => {});
  /** Tells the canvas effect the user zoomed, so auto-fit stops. */
  const zoomed = useRef<() => void>(() => {});
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);

  useEffect(() => draw.current(), [selected, matches]);

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext('2d')!;
    const layout = new ForceLayout(
      graph.ids.length,
      [...graph.edges, ...graph.suggested],
      1,
      graph.ids.map((id) => positions.get(id)),
    );
    const neighbours = graph.ids.map(() => new Set<number>());
    for (const [a, b] of [...graph.edges, ...graph.suggested]) {
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
      match: color('--warning', '#d9730d'),
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

    const savePositions = () =>
      layout.nodes.forEach((n, i) => positions.set(graph.ids[i]!, { x: n.x, y: n.y }));

    const render = () => {
      const dpr = devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, width, height);
      const { selected: sel, matches: found, searching } = live.current;
      // Hover wins over the selection for lighting up neighbours.
      const h = hover.current >= 0 ? hover.current : sel;
      const lit = h >= 0 ? neighbours[h]! : null;
      const line = (a: number, b: number) => {
        const [x1, y1] = toScreen(layout.nodes[a]!.x, layout.nodes[a]!.y);
        const [x2, y2] = toScreen(layout.nodes[b]!.x, layout.nodes[b]!.y);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      };
      ctx.lineWidth = 1;
      for (const [a, b] of graph.edges) {
        const on = h >= 0 && (a === h || b === h);
        ctx.strokeStyle = on ? colors.focus : colors.edge;
        ctx.globalAlpha = (h >= 0 && !on) || searching ? 0.3 : 1;
        line(a, b);
      }
      // Suggested links: dashed, never as strong as a real link.
      ctx.setLineDash([4, 4]);
      for (const [a, b] of graph.suggested) {
        const on = h >= 0 && (a === h || b === h);
        ctx.strokeStyle = on ? colors.focus : colors.node;
        ctx.globalAlpha = on ? 0.8 : h >= 0 || searching ? 0.15 : 0.4;
        line(a, b);
      }
      ctx.setLineDash([]);
      const k = view.current.k;
      ctx.font = '12px Inter Variable, Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      layout.nodes.forEach((n, i) => {
        const [x, y] = toScreen(n.x, n.y);
        if (x < -40 || y < -40 || x > width + 40 || y > height + 40) return;
        const isMatch = found.has(i);
        const dim = searching ? !isMatch && i !== h : h >= 0 && i !== h && !lit!.has(i);
        ctx.globalAlpha = dim ? 0.25 : 1;
        const r = radius(i) * Math.min(1.6, Math.max(0.7, k));
        const strong = i === h || i === focusIndex || i === sel;
        const fill = strong ? colors.focus : isMatch ? colors.match : colors.node;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        if (graph.kinds[i] === 'ghost') {
          // Not created yet: a hollow, dashed ring.
          ctx.fillStyle = colors.bg;
          ctx.fill();
          ctx.setLineDash([2, 2]);
          ctx.strokeStyle = fill;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.lineWidth = 1;
        } else {
          ctx.fillStyle = fill;
          ctx.fill();
        }
        if (i === sel) {
          ctx.beginPath();
          ctx.arc(x, y, r + 3.5, 0, Math.PI * 2);
          ctx.strokeStyle = colors.focus;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.lineWidth = 1;
        }
        const showLabel =
          strong ||
          isMatch ||
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
    centerOn.current = (i: number) => {
      const n = layout.nodes[i];
      if (!n) return;
      interacted = true;
      view.current = { x: -n.x, y: -n.y, k: Math.max(view.current.k, 1.2) };
      render();
    };
    const tick = () => {
      // Several ticks per frame: the graph settles quickly, then rendering stops.
      for (let i = 0; i < (reduceMotion ? 40 : 3) && !layout.settled; i++) layout.step();
      fit();
      render();
      if (!layout.settled) raf = requestAnimationFrame(tick);
      else savePositions();
    };
    if (reduceMotion) while (!layout.settled) layout.step();
    view.current = { x: 0, y: 0, k: graph.ids.length > 400 ? 0.5 : 1 };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    raf = requestAnimationFrame(tick);

    // Pointer: drag a node, pan the canvas, click to select, double-click to open.
    let drag: {
      node: number;
      sx: number;
      sy: number;
      vx: number;
      vy: number;
      moved: boolean;
    } | null = null;
    let lastClick = { node: -1, at: 0 };
    const pos = (e: PointerEvent): [number, number] => {
      const r = el.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const onDown = (e: PointerEvent) => {
      const [sx, sy] = pos(e);
      const node = nodeAt(sx, sy);
      drag = { node, sx, sy, vx: view.current.x, vy: view.current.y, moved: false };
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
      if (Math.hypot(sx - drag.sx, sy - drag.sy) > 3) {
        drag.moved = true;
        interacted = true;
      }
      if (!drag.moved) return;
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
      const { node, moved } = drag;
      drag = null;
      if (node >= 0) layout.nodes[node]!.fixed = false;
      if (moved) {
        savePositions();
        return;
      }
      const now = performance.now();
      const double = node >= 0 && lastClick.node === node && now - lastClick.at < 400;
      lastClick = { node, at: now };
      if (node < 0) setSelectedId(null);
      else if (double && graph.kinds[node] === 'doc') void openEntry(graph.ids[node] as EntryId);
      else setSelectedId(graph.ids[node]!);
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
      savePositions();
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
  const select = (i: number) => {
    setSelectedId(graph.ids[i]!);
    centerOn.current(i);
  };
  const docCount = graph.kinds.filter((k) => k === 'doc').length;
  const ghostCount = graph.ids.length - docCount;

  return (
    <Page
      title={local ? `Graph · ${tree.get(focusId!)!.name}` : 'Graph'}
      icon={<Network />}
      subtitle={[
        `${docCount} document${docCount === 1 ? '' : 's'}`,
        `${graph.edges.length} link${graph.edges.length === 1 ? '' : 's'}`,
        ghostCount ? `${ghostCount} not created yet` : '',
        suggested && !graph.suggestSkipped ? `${graph.suggested.length} suggested` : '',
        graph.truncated ? `showing the ${MAX_NODES} best-connected` : '',
      ]
        .filter(Boolean)
        .join(' · ')}
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
        <label className="flex h-7 items-center gap-1.5 px-2 text-caption text-steel">
          <input
            type="checkbox"
            checked={unresolved}
            onChange={(e) => setUnresolved(e.target.checked)}
          />
          Missing documents
        </label>
        <label
          className="flex h-7 items-center gap-1.5 px-2 text-caption text-steel"
          title="Documents that name another one in their text without linking to it"
        >
          <input
            type="checkbox"
            checked={suggested}
            onChange={(e) => setSuggested(e.target.checked)}
          />
          Suggested links
        </label>
      </div>
      <div className="relative overflow-hidden rounded-lg border border-hairline">
        <canvas
          ref={canvas}
          className="block h-[min(70vh,720px)] w-full touch-none"
          role="img"
          aria-label={`Graph of ${graph.ids.length} linked documents. The list below has the same documents.`}
        />
        <div className="absolute top-2 right-2 flex w-[min(260px,calc(100%-1rem))] items-center gap-1 rounded-lg border border-hairline bg-canvas px-2 shadow-1">
          <Search size={14} className="shrink-0 text-steel" aria-hidden />
          <input
            className="h-8 min-w-0 flex-1 bg-transparent text-[13px] outline-none"
            placeholder="Find in graph"
            aria-label="Find in graph"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches.length) {
                e.preventDefault();
                const at = matches.indexOf(selected);
                select(matches[(at + 1) % matches.length]!);
              } else if (e.key === 'Escape') setQuery('');
            }}
          />
          {needle && (
            <span className="shrink-0 text-xs text-stone" data-testid="graph-matches">
              {matches.length ? `${matches.length} found` : 'None'}
            </span>
          )}
        </div>
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
        {selected >= 0 ? (
          <SelectionCard graph={graph} index={selected} onClose={() => setSelectedId(null)} />
        ) : (
          hoverLabel && (
            <div className="pointer-events-none absolute top-2 left-2 rounded-md bg-canvas px-2 py-1 text-caption text-ink shadow-1">
              {hoverLabel}
            </div>
          )
        )}
        {(unresolved || suggested) && graph.ids.length > 0 && (
          <div
            className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-canvas/90 px-2 py-1 text-xs text-steel"
            aria-hidden
          >
            <span>● document</span>
            {unresolved && <span>◌ not created yet</span>}
            {suggested && <span>┄ mentioned, not linked</span>}
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
      {suggested && graph.suggestSkipped && (
        <p className="mt-2 text-caption text-steel">
          Suggested links are shown for up to {SUGGEST_LIMIT} documents. Filter by folder or tag, or
          use the local graph, to see them.
        </p>
      )}
      <details className="mt-4">
        <summary className="cursor-pointer text-caption text-steel">
          Documents in this graph ({graph.ids.length})
        </summary>
        <ul className="mt-2 columns-1 gap-6 text-[13px] sm:columns-2">
          {graph.ids.map((id, i) => (
            <li key={id}>
              <button
                type="button"
                className="rounded px-1 py-0.5 text-left text-charcoal hover:bg-hover"
                onClick={() =>
                  graph.kinds[i] === 'doc' ? void openEntry(id as EntryId) : select(i)
                }
              >
                {graph.labels[i]}{' '}
                <span className="text-stone">
                  · {graph.kinds[i] === 'ghost' ? 'not created yet' : `${graph.degree[i]} links`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </details>
    </Page>
  );
}

/** Details for the selected node, with what can be done with it. */
function SelectionCard({
  graph,
  index,
  onClose,
}: {
  graph: Graph;
  index: number;
  onClose(): void;
}) {
  const tree = useTree()!;
  const id = graph.ids[index]!;
  const ghost = isGhost(id);
  const k = session().knowledge;
  const neighbours = new Set<number>();
  let suggestedCount = 0;
  for (const [a, b] of graph.edges) {
    if (a === index) neighbours.add(b);
    if (b === index) neighbours.add(a);
  }
  for (const [a, b] of graph.suggested) if (a === index || b === index) suggestedCount++;
  const linkedFrom = graph.edges
    .filter(([a, b]) => a === index || b === index)
    .map(([a, b]) => (a === index ? b : a));
  const backlinks = ghost ? linkedFrom.length : k.backlinks(tree, id as EntryId).length;
  const outgoing = ghost
    ? 0
    : new Set(
        k
          .outgoing(tree, id as EntryId)
          .filter((o) => o.link.kind !== 'image' && o.targetId)
          .map((o) => o.targetId),
      ).size;
  const ambiguous = ghost ? [] : k.ambiguousLinks(tree, id as EntryId);
  const source = graph.ghosts.get(id);
  return (
    <div
      className="absolute top-2 left-2 w-[min(280px,calc(100%-1rem))] rounded-lg border border-hairline bg-canvas p-3 text-[13px] shadow-2 max-sm:top-12"
      role="region"
      aria-label="Selected document"
      data-testid="graph-selection"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-ink">{graph.labels[index]}</div>
          <div className="truncate text-xs text-steel">
            {ghost ? 'Not created yet' : graph.details[index] || 'Workspace root'}
          </div>
        </div>
        <button
          type="button"
          className="icon-btn -m-1"
          aria-label="Clear selection"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>
      <p className="mt-2 text-xs text-slate">
        {ghost
          ? `Linked from ${backlinks} document${backlinks === 1 ? '' : 's'}`
          : `${outgoing} link${outgoing === 1 ? '' : 's'} out · ${backlinks} backlink${backlinks === 1 ? '' : 's'}`}
        {suggestedCount ? ` · ${suggestedCount} suggested` : ''}
      </p>
      {ambiguous.length > 0 && (
        <p className="mt-2 flex gap-1 text-xs text-warning">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {ambiguous.map((a) => `[[${a.link.target}]]`).join(', ')} match
            {ambiguous.length === 1 ? 'es' : ''} several documents. Link by path to choose one.
          </span>
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {ghost ? (
          source && (
            <button
              type="button"
              className="btn btn-primary h-7 px-2.5 text-xs"
              onClick={() => void createLinkedDocument(source.from, source)}
            >
              <FilePlus2 size={13} aria-hidden /> Create document
            </button>
          )
        ) : (
          <>
            <button
              type="button"
              className="btn btn-primary h-7 px-2.5 text-xs"
              onClick={() => void openEntry(id as EntryId)}
            >
              Open
            </button>
            <button
              type="button"
              className="btn btn-secondary h-7 px-2.5 text-xs"
              onClick={() => navigate({ name: 'graph', id }, { replace: true })}
            >
              Local graph
            </button>
          </>
        )}
      </div>
    </div>
  );
}
