import { Monitor, Moon, Palette, Sun } from 'lucide-react';
import { useSettings, type ThemePref } from '@/app/settings-store';
import { PALETTES, type PaletteId } from '@/app/themes';
import { openMenuAt, type MenuEntry } from './Menu';

/**
 * A tiny picture of a palette: page, sidebar and accent. The palette's own CSS variables
 * apply inside it, so it always shows the real colors.
 */
export function PaletteSwatch({
  palette,
  mode,
  className = 'h-4 w-6',
}: {
  palette: PaletteId;
  mode: 'light' | 'dark';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-palette={palette === 'classic' ? undefined : palette}
      data-theme={mode}
      className={`relative inline-flex shrink-0 overflow-hidden rounded-[4px] border border-[var(--hairline-strong)] bg-[var(--canvas)] ${className}`}
    >
      <span className="h-full w-1/3 bg-[var(--sidebar)]" />
      <span className="absolute top-1/2 right-[18%] size-[40%] max-h-2.5 max-w-2.5 -translate-y-1/2 rounded-full bg-[var(--primary)]" />
    </span>
  );
}

const MODES: [ThemePref, string, typeof Sun][] = [
  ['light', 'Light', Sun],
  ['dark', 'Dark', Moon],
  ['system', 'Match system', Monitor],
];

/** Light/dark/system, then every palette, as a menu. */
export function themeMenuItems(): MenuEntry[] {
  const s = useSettings.getState();
  const resolved: 'light' | 'dark' =
    s.theme === 'system'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : s.theme;
  return [
    ...MODES.map(([theme, label, Icon]) => ({
      label,
      icon: <Icon />,
      checked: s.theme === theme,
      onSelect: () => s.update({ theme }),
    })),
    'separator' as const,
    ...PALETTES.map((p) => ({
      label: p.label,
      icon: <PaletteSwatch palette={p.id} mode={resolved} className="h-3.5 w-4" />,
      checked: s.palette === p.id,
      onSelect: () => s.update({ palette: p.id }),
    })),
  ];
}

/** Quick switcher for the mode and palette. */
export function ThemeMenuButton() {
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label="Change theme"
      title="Change theme"
      aria-haspopup="menu"
      onClick={(e) => openMenuAt(e.currentTarget, themeMenuItems(), 'Theme')}
    >
      <Palette size={16} />
    </button>
  );
}

/** The palette grid in Settings: each card previews the palette in light and dark. */
export function PaletteGrid() {
  const palette = useSettings((s) => s.palette);
  const update = useSettings((s) => s.update);
  return (
    <div
      role="radiogroup"
      aria-label="Color palette"
      className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3"
    >
      {PALETTES.map((p) => {
        const selected = p.id === palette;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={selected}
            title={p.hint}
            onClick={() => update({ palette: p.id })}
            className={`tap flex items-center gap-2.5 rounded-lg border p-2 text-left transition-colors ${
              selected
                ? 'border-primary bg-primary-soft text-primary-soft-ink'
                : 'border-hairline hover:bg-hover'
            }`}
          >
            <span className="flex shrink-0 -space-x-1.5">
              <PaletteSwatch palette={p.id} mode="light" className="h-6 w-7" />
              <PaletteSwatch palette={p.id} mode="dark" className="h-6 w-7" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium">{p.label}</span>
              <span
                className={`block truncate text-micro ${selected ? 'opacity-80' : 'text-steel'}`}
              >
                {p.hint}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
