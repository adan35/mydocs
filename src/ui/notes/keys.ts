import { useEffect, useRef } from 'react';
import { neighborInDirection } from '@/domain/notes';
import * as A from '@/app/actions';
import { patchNotes, trashNotes, useNotesUi } from '@/app/notes';
import { toast } from '@/app/toast-store';

const ARROWS = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
} as const;
const openers = () => [...document.querySelectorAll<HTMLElement>('[data-note-open]')];

/** Typing keeps its keys; check boxes and buttons don't. */
function typing(el: Element | null) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox';
}

/**
 * Keyboard use of the Notes page: arrows move between cards, Enter opens, X selects,
 * Delete moves to Trash, E archives, C and L start a note or checklist.
 */
export function useNoteKeys({ trash, canCompose }: { trash: boolean; canCompose: boolean }) {
  const opts = useRef({ trash, canCompose });
  opts.current = { trash, canCompose };
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (typing(e.target as Element) || document.querySelector('[role="dialog"], [role="menu"]'))
        return;
      const ui = useNotesUi.getState();
      const cards = openers();
      const focused = (e.target as Element).closest('[data-note-open]') as HTMLElement | null;
      const focusedId = focused?.closest<HTMLElement>('[data-id]')?.dataset.id;
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };

      if (e.key in ARROWS) {
        if (!cards.length) return;
        const from = focused ? cards.indexOf(focused) : -1;
        if (from < 0) return run(() => cards[0]!.focus());
        const next = neighborInDirection(
          cards.map((c) => c.getBoundingClientRect()),
          from,
          ARROWS[e.key as keyof typeof ARROWS],
        );
        return run(() => {
          const el = cards[next ?? from]!;
          el.focus();
          el.scrollIntoView({ block: 'nearest' });
        });
      }
      if (e.key === 'Escape' && ui.selected.length) return run(() => ui.select([]));
      if (e.key === 'c' && opts.current.canCompose) return run(() => ui.setComposer('note'));
      if (e.key === 'l' && opts.current.canCompose) return run(() => ui.setComposer('list'));

      const ids = ui.selected.length ? ui.selected : focusedId ? [focusedId] : [];
      if (e.key === 'x' && focusedId)
        return run(() =>
          ui.select(
            ui.selected.includes(focusedId)
              ? ui.selected.filter((i) => i !== focusedId)
              : [...ui.selected, focusedId],
          ),
        );
      if (!ids.length) return;
      if (e.key === 'e' && !opts.current.trash)
        return run(() => {
          void patchNotes(ids, { archived: true, pinned: false });
          ui.select([]);
          toast({
            message: ids.length > 1 ? `${ids.length} notes archived.` : 'Note archived.',
            action: { label: 'Undo', run: () => void patchNotes(ids, { archived: false }) },
          });
        });
      if (e.key === 'Delete' || e.key === '#') {
        e.preventDefault();
        const index = focused ? cards.indexOf(focused) : -1;
        if (opts.current.trash) await A.deletePermanently(ids);
        else await trashNotes(ids);
        // Keep the keyboard where it was: on the card that took the deleted one's place.
        requestAnimationFrame(() => {
          const left = openers();
          if (index >= 0) left[Math.min(index, left.length - 1)]?.focus();
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
