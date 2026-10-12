import { describe, expect, it } from 'vitest';
import { mapPosition } from './scroll-sync';

describe('mapPosition', () => {
  const anchors = [
    { e: 0, p: 0 },
    { e: 100, p: 300 }, // a tall image in the preview
    { e: 200, p: 350 },
    { e: 1000, p: 1200 },
  ];
  it('maps anchors exactly and interpolates between them', () => {
    expect(mapPosition(anchors, 100, 'e')).toBe(300);
    expect(mapPosition(anchors, 150, 'e')).toBe(325);
    expect(mapPosition(anchors, 325, 'p')).toBe(150);
  });
  it('clamps beyond the ends', () => {
    expect(mapPosition(anchors, -5, 'e')).toBe(0);
    expect(mapPosition(anchors, 5000, 'e')).toBe(1200);
  });
  it('is its own inverse', () => {
    for (const y of [0, 37, 120, 640, 999]) {
      expect(mapPosition(anchors, mapPosition(anchors, y, 'e'), 'p')).toBeCloseTo(y, 6);
    }
  });
});
