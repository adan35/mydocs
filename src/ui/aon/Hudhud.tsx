import type { HudhudState } from '@/app/aon/hudhud';
import { HUDHUD_ART } from '@/app/aon/hudhud-art';

/**
 * AON's mascot. Decorative: what AON is doing is always also said in words nearby.
 * The animation lives in CSS (`.hudhud`) and stops under reduced motion.
 */
export function Hudhud({ state, size = 32 }: { state: HudhudState; size?: number }) {
  return (
    <span
      className="hudhud"
      data-state={state}
      data-testid="hudhud"
      aria-hidden="true"
      style={{ '--hudhud-size': `${size}px` } as React.CSSProperties}
    >
      <img key={state} src={HUDHUD_ART[state]} alt="" draggable={false} />
      {state === 'thinking' && (
        <span className="hudhud-dots">
          <i />
          <i />
          <i />
        </span>
      )}
      {state === 'sleeping' && <span className="hudhud-z">z</span>}
    </span>
  );
}
