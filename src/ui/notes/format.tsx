import type { MenuEntry } from '../components/Menu';
import { NOTE_COLORS, type NoteColor, type Repeat } from '@/domain/notes';

const COLOR_NAMES: Record<NoteColor, string> = {
  default: 'Default',
  coral: 'Coral',
  peach: 'Peach',
  sand: 'Sand',
  mint: 'Mint',
  sage: 'Sage',
  fog: 'Fog',
  storm: 'Storm',
  dusk: 'Dusk',
  blossom: 'Blossom',
  clay: 'Clay',
  chalk: 'Chalk',
};
export const colorName = (c: NoteColor) => COLOR_NAMES[c];

export const REPEAT_NAMES: Record<Repeat | 'none', string> = {
  none: 'Does not repeat',
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
  yearly: 'Every year',
};

const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** "Today, 6:00 PM", "Tomorrow, 8:00 AM", "Oct 27, 9:00 AM". */
export function formatReminder(ms: number, now = new Date()): string {
  const d = new Date(ms);
  const days = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      86_400_000,
  );
  const day =
    days === 0
      ? 'Today'
      : days === 1
        ? 'Tomorrow'
        : d.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
          });
  return `${day}, ${time(d)}`;
}

/** Local `YYYY-MM-DDTHH:mm` for a datetime-local input, and back. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}
export const fromLocalInput = (v: string): number | null => {
  const ms = new Date(v).getTime();
  return Number.isFinite(ms) ? ms : null;
};

/** Quick choices for "Remind me". */
export function reminderPresets(now = new Date()): { label: string; at: number }[] {
  const at = (days: number, hour: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hour).getTime();
  const untilMonday = (8 - now.getDay()) % 7 || 7;
  return [
    ...(now.getHours() < 17 ? [{ label: 'Later today', at: at(0, 18) }] : []),
    { label: 'Tomorrow morning', at: at(1, 8) },
    { label: 'Next week', at: at(untilMonday, 8) },
  ].map((p) => ({ ...p, label: `${p.label} · ${time(new Date(p.at))}` }));
}

export function colorMenu(current: NoteColor | null, pick: (c: NoteColor) => void): MenuEntry[] {
  return NOTE_COLORS.map((c) => ({
    label: COLOR_NAMES[c],
    icon: <span className="note-swatch" data-color={c} />,
    checked: c === current,
    onSelect: () => pick(c),
  }));
}
