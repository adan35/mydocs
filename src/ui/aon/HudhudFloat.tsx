import { toggleAon } from '@/app/aon/chat';
import { useSettings } from '@/app/settings-store';
import { useLayout } from '../hooks';
import { Hudhud } from './Hudhud';
import { useHudhud } from './useHudhud';

const LABEL = {
  thinking: 'AON is thinking. Open AON',
  searching: 'AON is searching your documents. Open AON',
  success: 'AON has an answer. Open AON',
} as const;

/** A small Hudhud for when the AON panel is closed but AON is at work or has just answered. */
export function HudhudFloat() {
  const state = useHudhud();
  const { phone } = useLayout();
  const shown = useSettings((s) => s.showHudhud);
  if (!shown || (state !== 'thinking' && state !== 'searching' && state !== 'success')) return null;
  return (
    <button
      type="button"
      data-testid="hudhud-float"
      aria-label={LABEL[state]}
      title="AON"
      onClick={toggleAon}
      className={`no-print fixed right-4 z-[40] flex h-14 w-14 items-center justify-center rounded-full border border-hairline bg-canvas shadow-3 ${
        phone ? 'bottom-20' : 'bottom-4'
      }`}
    >
      <Hudhud state={state} size={40} />
    </button>
  );
}
