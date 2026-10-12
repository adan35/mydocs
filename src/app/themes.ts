/**
 * Color palettes. Each one has a light and a dark variant, defined as CSS variables in
 * `src/themes.css` under `[data-palette=…][data-theme=…]`. Classic is the base in
 * `src/styles.css` and needs no attribute.
 */
export type PaletteId =
  'classic' | 'material' | 'ocean' | 'forest' | 'sunset' | 'rose' | 'nord' | 'solarized' | 'sepia';

export const PALETTES: { id: PaletteId; label: string; hint: string }[] = [
  { id: 'classic', label: 'Classic', hint: 'Neutral greys with a violet accent' },
  { id: 'material', label: 'Material', hint: 'Material Design 3 baseline' },
  { id: 'ocean', label: 'Ocean', hint: 'Cool slate with a blue accent' },
  { id: 'forest', label: 'Forest', hint: 'Soft greens' },
  { id: 'sunset', label: 'Sunset', hint: 'Warm stone with an orange accent' },
  { id: 'rose', label: 'Rose', hint: 'Neutral greys with a pink accent' },
  { id: 'nord', label: 'Nord', hint: 'Arctic blues' },
  { id: 'solarized', label: 'Solarized', hint: 'Low-contrast cream and teal' },
  { id: 'sepia', label: 'Sepia', hint: 'Paper tones for long reading' },
];

export const isPaletteId = (v: unknown): v is PaletteId => PALETTES.some((p) => p.id === v);
