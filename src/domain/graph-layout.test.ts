import { describe, expect, it } from 'vitest';
import { ForceLayout } from './graph-layout';

describe('graph layout', () => {
  it('settles, keeps linked nodes closer than unlinked ones, and stays finite', () => {
    const layout = new ForceLayout(30, [
      [0, 1],
      [1, 2],
      [2, 0],
    ]);
    let ticks = 0;
    while (!layout.settled && ticks < 1000) {
      layout.step();
      ticks++;
    }
    expect(layout.settled).toBe(true);
    const d = (a: number, b: number) =>
      Math.hypot(layout.nodes[a]!.x - layout.nodes[b]!.x, layout.nodes[a]!.y - layout.nodes[b]!.y);
    expect(d(0, 1)).toBeLessThan(d(0, 29));
    for (const n of layout.nodes) expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
  });
});
