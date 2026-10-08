/**
 * A small force-directed layout: springs along edges, short-range repulsion
 * through a spatial grid (so it stays fast with thousands of nodes) and a weak
 * pull to the center. Pure and deterministic for a given seed.
 */
export interface LayoutNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Pinned while dragged. */
  fixed?: boolean;
}

export class ForceLayout {
  readonly nodes: LayoutNode[];
  alpha = 1;
  private readonly cell = 90;

  constructor(
    count: number,
    readonly edges: [number, number][],
    seed = 1,
  ) {
    let s = seed;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
    // Start on a spiral so the first frames already look orderly.
    this.nodes = Array.from({ length: count }, (_, i) => {
      const r = 12 * Math.sqrt(i + 1);
      const a = i * 2.39996;
      return { x: Math.cos(a) * r + rand(), y: Math.sin(a) * r + rand(), vx: 0, vy: 0 };
    });
  }

  get settled(): boolean {
    return this.alpha < 0.005;
  }

  /** Advances the simulation one tick. */
  step() {
    const { nodes, edges, cell } = this;
    const alpha = this.alpha;
    // Springs.
    for (const [a, b] of edges) {
      const p = nodes[a]!;
      const q = nodes[b]!;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const f = ((d - 60) / d) * 0.06 * alpha;
      p.vx += dx * f;
      p.vy += dy * f;
      q.vx -= dx * f;
      q.vy -= dy * f;
    }
    // Repulsion between nodes in neighbouring grid cells.
    const grid = new Map<string, number[]>();
    nodes.forEach((n, i) => {
      const key = `${Math.floor(n.x / cell)},${Math.floor(n.y / cell)}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(i);
      else grid.set(key, [i]);
    });
    nodes.forEach((n, i) => {
      const cx = Math.floor(n.x / cell);
      const cy = Math.floor(n.y / cell);
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          for (const j of grid.get(`${gx},${gy}`) ?? []) {
            if (j <= i) continue;
            const m = nodes[j]!;
            let dx = m.x - n.x;
            let dy = m.y - n.y;
            let d2 = dx * dx + dy * dy;
            if (d2 === 0) {
              dx = (i % 7) - 3 || 1;
              dy = (j % 5) - 2 || 1;
              d2 = dx * dx + dy * dy;
            }
            if (d2 > cell * cell) continue;
            const f = (900 / d2) * alpha;
            n.vx -= dx * f * 0.05;
            n.vy -= dy * f * 0.05;
            m.vx += dx * f * 0.05;
            m.vy += dy * f * 0.05;
          }
        }
      }
    });
    // Gravity, damping, integration.
    for (const n of nodes) {
      if (n.fixed) {
        n.vx = n.vy = 0;
        continue;
      }
      n.vx -= n.x * 0.004 * alpha;
      n.vy -= n.y * 0.004 * alpha;
      n.vx *= 0.6;
      n.vy *= 0.6;
      n.x += n.vx;
      n.y += n.vy;
    }
    this.alpha *= 0.985;
  }

  /** Re-energizes the simulation (after dragging a node). */
  reheat(to = 0.3) {
    this.alpha = Math.max(this.alpha, to);
  }
}
