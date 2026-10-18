import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PALETTES } from './themes';

const css = (file: string) =>
  readFileSync(resolve(process.cwd(), 'src', file), 'utf8').replace(/\r\n/g, '\n');
const base = css('styles.css');
const palettes = css('themes.css');

/** The custom properties declared in the first rule whose selector contains `selector`. */
function tokens(source: string, selector: string): Record<string, string> {
  const at = source.indexOf(selector);
  if (at < 0) return {};
  const body = source.slice(source.indexOf('{', at) + 1, source.indexOf('}', at));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1]!, m[2]!]),
  );
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

const variants = PALETTES.flatMap((p) =>
  (['light', 'dark'] as const).map((mode) => {
    const classic = tokens(
      base,
      mode === 'light' ? ":root,\n[data-theme='light']" : "[data-theme='dark'] {",
    );
    const own =
      p.id === 'classic' ? {} : tokens(palettes, `[data-palette='${p.id}'][data-theme='${mode}']`);
    return { name: `${p.label} ${mode}`, id: p.id, own, t: { ...classic, ...own } };
  }),
);

describe('palettes', () => {
  it('every palette defines both variants', () => {
    for (const v of variants) if (v.id !== 'classic') expect(v.own.canvas, v.name).toBeDefined();
  });

  it.each(variants)('$name keeps text readable', ({ t }) => {
    const pairs: [string, string, number][] = [
      ['ink', 'canvas', 7],
      ['ink', 'sidebar', 7],
      ['charcoal', 'canvas', 4.5],
      ['slate', 'canvas', 4.5],
      ['steel', 'canvas', 4.5],
      ['steel', 'sidebar', 4.5],
      ['steel', 'surface', 4],
      ['link', 'canvas', 4.5],
      ['primary', 'canvas', 4.5],
      ['on-primary', 'primary-solid', 4.5],
      ['primary-soft-ink', 'primary-soft', 4.5],
      ['focus', 'canvas', 3],
    ];
    for (const [fg, bg, min] of pairs)
      expect(contrast(t[fg]!, t[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
  });
});
