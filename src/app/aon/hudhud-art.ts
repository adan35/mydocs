import type { HudhudState } from './hudhud';
import idle from './sprites/idle.webp';
import listening from './sprites/listening.webp';
import searching from './sprites/searching.webp';
import sleeping from './sprites/sleeping.webp';
import success from './sprites/success.webp';
import thinking from './sprites/thinking.webp';

export const HUDHUD_ART: Record<HudhudState, string> = {
  idle,
  listening,
  thinking,
  searching,
  success,
  sleeping,
};

/** Plain DOM version for places React doesn't render, such as editor widgets. Styled by `.hudhud`. */
export function hudhudElement(state: HudhudState): HTMLElement {
  const el = document.createElement('span');
  el.className = 'hudhud';
  el.dataset.state = state;
  el.setAttribute('aria-hidden', 'true');
  const img = document.createElement('img');
  img.src = HUDHUD_ART[state];
  img.alt = '';
  img.draggable = false;
  el.append(img);
  return el;
}
