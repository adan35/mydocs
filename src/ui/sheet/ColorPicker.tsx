import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Ban, Check } from 'lucide-react';
import { GRAYS, TONES, colorName, contrastText, normalizeColor } from '@/lib/convert/sheet-format';

const RECENT_KEY = 'mydoc:sheet-recent-colors';
const MAX_RECENT = 8;

/** Colors used lately, newest first. Kept per browser; a failing storage just means none. */
export function recentColors(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(raw)
      ? raw
          .map(normalizeColor)
          .filter((c): c is string => !!c)
          .slice(0, MAX_RECENT)
      : [];
  } catch {
    return [];
  }
}

export function rememberColor(color: string) {
  const next = [color, ...recentColors().filter((c) => c !== color)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage is blocked or full: the color is still applied, just not remembered.
  }
}

export interface ColorScope<T extends string> {
  value: T;
  label: string;
}

interface ColorButtonProps<T extends string> {
  /** Accessible name of the button and the popover, e.g. "Fill color". */
  label: string;
  icon: ReactNode;
  /** Label of the "no color" choice, e.g. "No fill". */
  noneLabel: string;
  /** The color last applied with this button; shown under the icon. */
  last?: string | null;
  disabled?: boolean;
  /** Called with a `#rrggbb` color, or null for "none". */
  onPick(color: string | null): void;
  scopes?: ColorScope<T>[];
  scope?: T;
  onScope?(scope: T): void;
  /** A line of fine print at the bottom of the popover. */
  note?: string;
  testId: string;
}

/** A toolbar button that opens a palette: standard colors, recent colors, a custom color and "none". */
export function ColorButton<T extends string>(props: ColorButtonProps<T>) {
  const { label, icon, noneLabel, last, disabled, onPick, scopes, scope, onScope, note, testId } =
    props;
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = (restore = true) => {
    setOpen(false);
    if (restore) button.current?.focus({ preventScroll: true });
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        className="icon-btn relative size-8 shrink-0 [&>svg]:size-4"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        data-testid={testId}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        <span
          aria-hidden
          className="absolute inset-x-2 bottom-0.5 h-[3px] rounded-full border border-hairline"
          style={{ background: last ?? 'transparent' }}
        />
      </button>
      {open && (
        <Palette
          anchor={button.current!}
          label={label}
          noneLabel={noneLabel}
          scopes={scopes}
          scope={scope}
          onScope={onScope}
          note={note}
          onClose={close}
          onPick={(c) => {
            if (c) rememberColor(c);
            close();
            onPick(c);
          }}
        />
      )}
    </>
  );
}

function Palette<T extends string>({
  anchor,
  label,
  noneLabel,
  scopes,
  scope,
  onScope,
  note,
  onClose,
  onPick,
}: {
  anchor: HTMLElement;
  label: string;
  noneLabel: string;
  scopes?: ColorScope<T>[];
  scope?: T;
  onScope?(s: T): void;
  note?: string;
  onClose(restore?: boolean): void;
  onPick(color: string | null): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [recent] = useState(recentColors);
  const [custom, setCustom] = useState('#3d85c6');
  const [customError, setCustomError] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    let left = a.left;
    let top = a.bottom + 4;
    if (left + width > innerWidth - 8) left = a.right - width;
    left = Math.max(8, Math.min(left, innerWidth - width - 8));
    if (top + height > innerHeight - 8) top = Math.max(8, a.top - height - 4);
    setPos({ left, top });
  }, [anchor]);

  // First palette swatch gets focus so the keyboard works right away.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-swatch]')?.focus();
  }, []);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose(false);
    };
    const away = () => onClose(false);
    addEventListener('pointerdown', down, true);
    addEventListener('resize', away);
    return () => {
      removeEventListener('pointerdown', down, true);
      removeEventListener('resize', away);
    };
  }, [anchor, onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    const swatches = [...(ref.current?.querySelectorAll<HTMLElement>('[data-swatch]') ?? [])];
    const i = swatches.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const group = (document.activeElement as HTMLElement).dataset.swatch;
    const same = swatches.filter((s) => s.dataset.swatch === group);
    const j = same.indexOf(document.activeElement as HTMLElement);
    // The palette is ten columns wide; up and down move a row.
    const step: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: group === 'palette' ? -10 : 0,
      ArrowDown: group === 'palette' ? 10 : 0,
    };
    const d = step[e.key];
    if (d === undefined || d === 0) return;
    e.preventDefault();
    same[Math.max(0, Math.min(same.length - 1, j + d))]?.focus();
  };

  const swatch = (c: string, group: 'palette' | 'recent', first = false) => (
    <button
      key={`${group}-${c}`}
      type="button"
      data-swatch={group}
      data-color={c}
      tabIndex={first ? 0 : -1}
      className="grid size-[22px] place-items-center rounded-[4px] border border-[var(--hairline-strong)] hover:scale-110 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-focus"
      style={{ background: c, color: contrastText(c) }}
      aria-label={colorName(c)}
      title={colorName(c)}
      onClick={() => onPick(c)}
    />
  );

  const applyCustom = () => {
    const c = normalizeColor(custom);
    if (!c) return setCustomError(true);
    onPick(c);
  };

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      data-testid="color-palette"
      className="popover animate-in fixed z-[60] w-[268px] max-w-[calc(100vw-16px)] p-2.5"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        className="menu-item mb-2 border border-hairline"
        onClick={() => onPick(null)}
        data-testid="color-none"
      >
        <Ban size={15} className="text-steel" aria-hidden />
        {noneLabel}
      </button>
      <div className="grid grid-cols-10 gap-[3px]" role="group" aria-label="Colors">
        {GRAYS.map((c, k) => swatch(c, 'palette', k === 0))}
        <div className="col-span-10 h-1" aria-hidden />
        {TONES.flatMap((t) => t.colors).map((c) => swatch(c, 'palette'))}
      </div>
      {recent.length > 0 && (
        <div className="mt-2.5" role="group" aria-label="Recent colors">
          <div className="mb-1 text-xs text-steel">Recent</div>
          <div className="flex flex-wrap gap-[3px]">{recent.map((c) => swatch(c, 'recent'))}</div>
        </div>
      )}
      <form
        className="mt-2.5 flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          applyCustom();
        }}
      >
        <input
          type="color"
          aria-label="Pick a custom color"
          className="size-8 shrink-0 cursor-pointer rounded-md border border-hairline bg-transparent p-0.5"
          value={normalizeColor(custom) ?? '#3d85c6'}
          onChange={(e) => {
            setCustom(e.target.value);
            setCustomError(false);
          }}
        />
        <input
          className="input h-8 min-w-0 flex-1 py-0 font-mono text-[13px]"
          aria-label="Custom color, hex"
          aria-invalid={customError || undefined}
          value={custom}
          spellCheck={false}
          onChange={(e) => {
            setCustom(e.target.value);
            setCustomError(false);
          }}
        />
        <button type="submit" className="btn btn-secondary h-8 px-2.5 text-caption">
          Apply
        </button>
      </form>
      {customError && (
        <p role="alert" className="mt-1 text-xs text-danger">
          Use a hex color like #f4cccc.
        </p>
      )}
      {scopes && scope && onScope && (
        <div className="mt-2.5" role="radiogroup" aria-label="Apply to">
          <div className="mb-1 text-xs text-steel">Apply to</div>
          <div className="flex flex-wrap gap-1">
            {scopes.map((s) => (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={scope === s.value}
                className={`flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs ${
                  scope === s.value
                    ? 'border-primary bg-primary-soft text-primary-soft-ink'
                    : 'border-hairline text-charcoal hover:bg-hover'
                }`}
                onClick={() => onScope(s.value)}
              >
                {scope === s.value && <Check size={12} aria-hidden />}
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {note && <p className="mt-2 text-xs text-steel">{note}</p>}
    </div>,
    document.body,
  );
}
