import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, ChevronRight } from 'lucide-react';
import { create } from 'zustand';
import { formatShortcut, useLayout } from '../hooks';
import { restoreFocus } from '../focus';
import { lockBackground } from '../modal';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Small second line, e.g. why the item is disabled. */
  hint?: string;
  /** Shows the item as a choice in a group, ticked when true. */
  checked?: boolean;
  onSelect?: () => void;
  submenu?: MenuEntry[];
}

export type MenuEntry = MenuItem | 'separator';

export interface MenuRequest {
  items: MenuEntry[];
  /** Point (context menu) or anchor rect (dropdown). */
  at: { x: number; y: number } | DOMRect;
  label?: string;
  returnFocus?: HTMLElement | null;
  /** Left/Right on a top-level item that opens no submenu (the menu bar moves to its neighbour). */
  onNavigate?: (dir: -1 | 1) => void;
  id?: number;
}

const useMenuStore = create<{ menu: MenuRequest | null }>(() => ({ menu: null }));
let menuSeq = 0;

export function openMenu(req: MenuRequest) {
  useMenuStore.setState({
    menu: { returnFocus: document.activeElement as HTMLElement, ...req, id: ++menuSeq },
  });
}

export function closeMenu() {
  const m = useMenuStore.getState().menu;
  useMenuStore.setState({ menu: null });
  if (m?.returnFocus) restoreFocus(m.returnFocus);
}

/** True while a menu (a popover, or a bottom sheet on phones) is open. */
export const useMenuOpen = () => useMenuStore((s) => !!s.menu);

/** Opens a menu below an element (for "…" buttons); using the element again closes it. */
export function openMenuAt(
  el: HTMLElement,
  items: MenuEntry[],
  label?: string,
  extra?: Partial<MenuRequest>,
) {
  if (useMenuStore.getState().menu?.returnFocus === el) return closeMenu();
  openMenu({ items, at: el.getBoundingClientRect(), label, returnFocus: el, ...extra });
}

export function MenuHost() {
  const menu = useMenuStore((s) => s.menu);
  const { phone } = useLayout();
  if (!menu) return null;
  return createPortal(
    phone ? <MenuSheet key={menu.id} menu={menu} /> : <MenuPopover key={menu.id} menu={menu} />,
    document.body,
  );
}

interface KeyboardHandlers {
  onEscape: () => void;
  /** ArrowLeft */
  onLeft?: () => void;
  /** ArrowRight on an item that opens no submenu */
  onRight?: () => void;
}

function useMenuKeyboard(
  listRef: React.RefObject<HTMLDivElement | null>,
  { onEscape, onLeft, onRight }: KeyboardHandlers,
  /** Focus moves to the first item again whenever this changes (a submenu replaced the items). */
  focusKey: unknown,
  autoFocus = true,
) {
  useEffect(() => {
    if (autoFocus)
      listRef.current
        ?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not([disabled])')
        ?.focus();
  }, [listRef, focusKey, autoFocus]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const enabled = () => [
      ...list.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not([disabled])'),
    ];
    const onKey = (e: KeyboardEvent) => {
      const all = enabled();
      const i = all.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        all[(i + 1) % all.length]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        all[i < 0 ? all.length - 1 : (i - 1 + all.length) % all.length]?.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        all[0]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        all[all.length - 1]?.focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onEscape();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onLeft?.();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const active = document.activeElement as HTMLButtonElement | null;
        // A keyboard click (detail 0) opens the submenu and moves focus into it.
        if (active?.getAttribute('aria-haspopup') && list.contains(active)) active.click();
        else onRight?.();
      } else if (e.key === 'Tab') {
        e.preventDefault();
      } else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey) {
        const next = [...all.slice(i + 1), ...all.slice(0, i + 1)].find((b) =>
          b.textContent?.trim().toLowerCase().startsWith(e.key.toLowerCase()),
        );
        next?.focus();
      }
    };
    list.addEventListener('keydown', onKey);
    return () => list.removeEventListener('keydown', onKey);
  }, [listRef, onEscape, onLeft, onRight]);
}

/** Phone sheet: a submenu replaces the items, with a Back row, instead of flying out. */
function useMenuPages(menu: MenuRequest) {
  const [pages, setPages] = useState([{ items: menu.items, label: menu.label }]);
  const back = useCallback(() => setPages((p) => p.slice(0, -1)), []);
  const open = (item: MenuItem) => {
    if (item.submenu) setPages((p) => [...p, { items: item.submenu!, label: item.label }]);
  };
  return { ...pages[pages.length - 1]!, back: pages.length > 1 ? back : undefined, open };
}

function MenuBack({ onBack }: { onBack: () => void }) {
  return (
    <>
      <button type="button" role="menuitem" className="menu-item" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden /> Back
      </button>
      <div role="separator" className="my-1 h-px bg-hairline" />
    </>
  );
}

function MenuItems({
  items,
  onPick,
  onHover,
  activeIndex,
}: {
  items: MenuEntry[];
  /** `byKeyboard` is true for Enter/Space/ArrowRight, so a submenu can take focus. */
  onPick: (item: MenuItem, el: HTMLElement, index: number, byKeyboard: boolean) => void;
  onHover?: (item: MenuItem, el: HTMLElement, index: number) => void;
  activeIndex?: number;
}) {
  return (
    <>
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} role="separator" className="my-1 h-px bg-hairline" />
        ) : (
          <button
            key={i}
            type="button"
            role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={item.checked}
            className="menu-item"
            data-danger={item.danger || undefined}
            data-active={activeIndex === i || undefined}
            disabled={item.disabled}
            title={item.disabled ? item.hint : undefined}
            aria-haspopup={item.submenu ? 'menu' : undefined}
            aria-expanded={item.submenu ? activeIndex === i : undefined}
            onClick={(e) => onPick(item, e.currentTarget, i, e.detail === 0)}
            onPointerEnter={(e) => onHover?.(item, e.currentTarget, i)}
          >
            {item.icon && (
              <span className="flex w-4 shrink-0 justify-center text-steel [&>svg]:size-4">
                {item.icon}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{item.label}</span>
              {item.hint && item.disabled && (
                <span className="block truncate text-xs text-stone">{item.hint}</span>
              )}
            </span>
            {item.shortcut && (
              <span className="ml-4 text-xs text-stone">{formatShortcut(item.shortcut)}</span>
            )}
            {item.checked && <Check size={14} className="text-primary" aria-hidden />}
            {item.submenu && <ChevronRight size={14} className="text-stone" aria-hidden />}
          </button>
        ),
      )}
    </>
  );
}

/** Where a popover goes: below its anchor, at the pointer, or beside the item that opened it. */
function place(at: MenuRequest['at'], flyout: boolean, width: number, height: number) {
  let left: number;
  let top: number;
  if (flyout && 'width' in at) {
    // Beside the parent item; flips to its left edge when the screen's right edge is in the way.
    left = at.right + 2;
    if (left + width > innerWidth - 8) left = at.left - width - 6;
    top = at.top - 5;
    top = Math.max(8, Math.min(top, innerHeight - height - 8));
  } else {
    left = 'width' in at ? at.left : at.x;
    top = 'width' in at ? at.bottom + 4 : at.y;
    if ('width' in at && left + width > innerWidth - 8) left = at.right - width;
    if (top + height > innerHeight - 8)
      top =
        'width' in at ? Math.max(8, at.top - height - 4) : Math.max(8, innerHeight - height - 8);
  }
  left = Math.max(8, Math.min(left, innerWidth - width - 8));
  return { left, top };
}

/** One menu panel; a submenu item opens another panel beside it (on hover, click or →). */
function MenuPanel({
  items,
  label,
  at,
  flyout = false,
  autoFocus = true,
  keys,
  onEnter,
}: {
  items: MenuEntry[];
  label?: string;
  at: MenuRequest['at'];
  flyout?: boolean;
  autoFocus?: boolean;
  keys: KeyboardHandlers;
  onEnter?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [sub, setSub] = useState<{
    index: number;
    el: HTMLElement;
    rect: DOMRect;
    focus: boolean;
  } | null>(null);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  const closeSub = useCallback(() => {
    sub?.el.focus();
    setSub(null);
  }, [sub]);
  useMenuKeyboard(ref, keys, items, autoFocus);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos(place(at, flyout, width, height));
  }, [at, flyout, items]);

  const subItem = sub ? items[sub.index] : undefined;
  const subEntries = typeof subItem === 'object' ? subItem.submenu : undefined;

  const open = (index: number, el: HTMLElement, focus: boolean) => {
    clearTimeout(timer.current);
    setSub((s) =>
      s?.index === index && !focus ? s : { index, el, rect: el.getBoundingClientRect(), focus },
    );
  };

  return (
    <>
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        data-menu-panel
        className="popover animate-in fixed z-[60] max-h-[min(480px,calc(100vh-16px))] min-w-[220px] max-w-[320px] overflow-y-auto p-1"
        style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
        onPointerEnter={onEnter}
        onContextMenu={(e) => e.preventDefault()}
      >
        <MenuItems
          items={items}
          activeIndex={sub?.index}
          onPick={(item, el, index, byKeyboard) => {
            if (item.submenu) return open(index, el, byKeyboard);
            closeMenu();
            item.onSelect?.();
          }}
          onHover={(item, el, index) => {
            clearTimeout(timer.current);
            const opens = !!item.submenu && !item.disabled;
            if (sub?.index === index || (!opens && !sub)) return;
            // A short delay lets the pointer cross other items on its way to an open submenu.
            timer.current = window.setTimeout(
              () => (opens ? open(index, el, false) : setSub(null)),
              opens ? 60 : 250,
            );
          }}
        />
      </div>
      {sub && subEntries && (
        <MenuPanel
          key={sub.index}
          items={subEntries}
          label={typeof subItem === 'object' ? subItem.label : undefined}
          at={sub.rect}
          flyout
          autoFocus={sub.focus}
          keys={{ onEscape: closeSub, onLeft: closeSub }}
          onEnter={() => clearTimeout(timer.current)}
        />
      )}
    </>
  );
}

function MenuPopover({ menu }: { menu: MenuRequest }) {
  useEffect(() => {
    const inMenu = (t: EventTarget | null) =>
      t instanceof Element && !!t.closest('[data-menu-panel]');
    const onDown = (e: PointerEvent) => {
      // The "…" button that opened the menu closes it itself (see openMenuAt), so it isn't reopened.
      const onAnchor = 'width' in menu.at && !!menu.returnFocus?.contains(e.target as Node);
      if (!inMenu(e.target) && !onAnchor) closeMenu();
    };
    const onBlur = () => closeMenu();
    addEventListener('pointerdown', onDown, true);
    addEventListener('blur', onBlur);
    addEventListener('resize', onBlur);
    return () => {
      removeEventListener('pointerdown', onDown, true);
      removeEventListener('blur', onBlur);
      removeEventListener('resize', onBlur);
    };
  }, [menu]);

  return (
    <MenuPanel
      items={menu.items}
      label={menu.label}
      at={menu.at}
      keys={{
        onEscape: closeMenu,
        onLeft: () => menu.onNavigate?.(-1),
        onRight: () => menu.onNavigate?.(1),
      }}
    />
  );
}

function MenuSheet({ menu }: { menu: MenuRequest }) {
  const ref = useRef<HTMLDivElement>(null);
  const { items, label, back, open } = useMenuPages(menu);
  useMenuKeyboard(ref, { onEscape: closeMenu, onLeft: back }, items);
  useEffect(() => {
    const unlock = lockBackground();
    return () => {
      unlock();
      restoreFocus(menu.returnFocus ?? null);
    };
  }, [menu]);
  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end" onClick={closeMenu}>
      <div className="absolute inset-0 bg-[var(--scrim)]" aria-hidden />
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        data-menu-panel
        className="animate-sheet safe-bottom relative max-h-[80dvh] overflow-y-auto rounded-t-xl bg-canvas p-2 pb-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-hairline-strong" aria-hidden />
        {label && (
          <div className="truncate px-3 pb-2 text-caption font-medium text-steel">{label}</div>
        )}
        {back && <MenuBack onBack={back} />}
        <MenuItems
          items={items}
          onPick={(item) => {
            if (item.submenu) return open(item);
            closeMenu();
            item.onSelect?.();
          }}
        />
      </div>
    </div>
  );
}
