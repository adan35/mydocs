import { Rows3 } from 'lucide-react';
import { ROW_LINES, useSettings, type RowHeight } from '@/app/settings-store';
import { openMenuAt, type MenuEntry } from './components/Menu';

/** The row heights, as the menus and Settings name them. */
export const ROW_HEIGHTS: { id: RowHeight; label: string; menu: string }[] = [
  { id: 'default', label: 'Default', menu: 'Default · one line' },
  { id: 'normal', label: 'Normal', menu: 'Normal · up to 3 lines' },
  { id: 'medium', label: 'Medium', menu: 'Medium · up to 6 lines' },
  { id: 'full', label: 'Full', menu: 'Full height · everything' },
];

export function rowHeightMenu(): MenuEntry[] {
  const current = useSettings.getState().tableRowHeight;
  return ROW_HEIGHTS.map((h) => ({
    label: h.menu,
    checked: h.id === current,
    onSelect: () => useSettings.getState().update({ tableRowHeight: h.id }),
  }));
}

export function openRowHeightMenu(el: HTMLElement) {
  openMenuAt(el, rowHeightMenu(), 'Row height');
}

const labelOf = (id: RowHeight) => ROW_HEIGHTS.find((h) => h.id === id)!.label;

/** Toolbar button for spreadsheets: shows the row height and changes it. */
export function RowHeightButton() {
  const value = useSettings((s) => s.tableRowHeight);
  return (
    <button
      type="button"
      className="btn btn-ghost h-8 shrink-0 gap-1.5 px-2 text-caption text-steel"
      aria-haspopup="menu"
      aria-label={`Row height: ${labelOf(value)}`}
      title="Row height"
      data-testid="row-height"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => openRowHeightMenu(e.currentTarget)}
    >
      <Rows3 size={15} aria-hidden />
      <span>{labelOf(value)}</span>
    </button>
  );
}

const CLIP = 'cell-clip';
const BUTTON = 'table-rows-btn';

/**
 * Gives the tables in rendered Markdown a row height. Each cell's content goes into a
 * clipping box (cells themselves can't be line-clamped), the full text shows on hover,
 * and clicking a row opens it to full height. Each table gets a small "Rows" button.
 * Idempotent: it runs again over the same DOM after every render. With `height` null
 * (rich editing, where cells are edited in place) the boxes are removed again.
 */
export function applyRowHeight(root: HTMLElement, height: RowHeight | null) {
  if (height === null) {
    root.removeAttribute('data-rows');
    for (const clip of root.querySelectorAll<HTMLElement>(`.${CLIP}`))
      clip.replaceWith(...clip.childNodes);
    for (const btn of root.querySelectorAll(`.${BUTTON}`)) btn.remove();
    for (const tr of root.querySelectorAll('tr.row-open')) tr.classList.remove('row-open');
    return;
  }
  root.dataset.rows = height;
  const clipped = ROW_LINES[height] !== Infinity;
  for (const cell of root.querySelectorAll<HTMLTableCellElement>(
    '.table-wrap td, .table-wrap th',
  )) {
    let clip = cell.firstElementChild?.classList.contains(CLIP)
      ? (cell.firstElementChild as HTMLElement)
      : null;
    if (!clip) {
      clip = document.createElement('div');
      clip.className = CLIP;
      clip.append(...cell.childNodes);
      cell.append(clip);
    }
    const text = clip.textContent?.trim() ?? '';
    if (clipped && text.length > 24)
      cell.title = text.length > 600 ? text.slice(0, 600) + '…' : text;
    else cell.removeAttribute('title');
  }
  for (const wrap of root.querySelectorAll<HTMLElement>('.table-wrap')) {
    if (!wrap.querySelector(`:scope > .${BUTTON}`)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = BUTTON;
      btn.setAttribute('aria-haspopup', 'menu');
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openRowHeightMenu(btn);
      });
      wrap.prepend(btn);
    }
    const btn = wrap.querySelector<HTMLButtonElement>(`:scope > .${BUTTON}`)!;
    btn.textContent = `Rows: ${labelOf(height)}`;
    btn.title = clipped ? 'Row height. Click a row to see all of it.' : 'Row height';
    btn.setAttribute('aria-label', `Row height: ${labelOf(height)}`);
  }
}

/**
 * Clicking a clipped row opens it to full height (and closes it again). Returns whether
 * the click was used. Clicks on links, buttons, checkboxes or with text selected aren't.
 */
export function toggleRowAt(target: HTMLElement): boolean {
  const root = target.closest<HTMLElement>('[data-rows]');
  if (!root || root.dataset.rows === 'full') return false;
  if (target.closest('a, button, input, summary, .table-rows-btn')) return false;
  if (getSelection()?.toString()) return false;
  const tr = target.closest('.table-wrap tr');
  if (!tr) return false;
  tr.classList.toggle('row-open');
  return true;
}
