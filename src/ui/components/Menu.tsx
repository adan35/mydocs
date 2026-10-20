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
  /** Shows the item as a choice in a group, ticked when true. */
  checked?: boolean;
  onSelect?: () => void;
  submenu?: MenuEntry[];
}

export type MenuEntry = MenuItem | 'separator';

interface MenuRequest {
  items: MenuEntry[];
  /** Point (context menu) or anchor rect (dropdown). */
  at: { x: number; y: number } | DOMRect;
  label?: string;
  returnFocus?: HTMLElement | null;
}

const useMenuStore = create<{ menu: MenuRequest | null }>(() => ({ menu: null }));

export function openMenu(req: MenuRequest) {
  useMenuStore.setState({ menu: { returnFocus: document.activeElement as HTMLElement, ...req } });
}

export function closeMenu() {
  const m = useMenuStore.getState().menu;
  useMenuStore.setState({ menu: null });
  if (m?.returnFocus) restoreFocus(m.returnFocus);
}

/** True while a menu (a popover, or a bottom sheet on phones) is open. */
export const useMenuOpen = () => useMenuStore((s) => !!s.menu);

/** Opens a menu below an element (for "…" buttons). */
export function openMenuAt(el: HTMLElement, items: MenuEntry[], label?: string) {
  openMenu({ items, at: el.getBoundingClientRect(), label, returnFocus: el });
}

export function MenuHost() {
  const menu = useMenuStore((s) => s.menu);
  const { phone } = useLayout();
  if (!menu) return null;
  return createPortal(
    phone ? <MenuSheet menu={menu} /> : <MenuPopover menu={menu} />,
    document.body,
  );
}

function useMenuKeyboard(
  listRef: React.RefObject<HTMLDivElement | null>,
  onEscape: () => void,
  items: MenuEntry[],
  onBack?: () => void,
) {
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const items = () => [
      ...list.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not([disabled])'),
    ];
    items()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      const all = items();
      const i = all.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        all[(i + 1) % all.length]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        all[(i - 1 + all.length) % all.length]?.focus();
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
      } else if (e.key === 'ArrowLeft' && onBack) {
        e.preventDefault();
        onBack();
      } else if (e.key === 'Tab') {
        e.preventDefault();
      } else if (e.key.length === 1 && /\S/.test(e.key)) {
        const next = [...all.slice(i + 1), ...all.slice(0, i + 1)].find((b) =>
          b.textContent?.trim().toLowerCase().startsWith(e.key.toLowerCase()),
        );
        next?.focus();
      }
    };
    list.addEventListener('keydown', onKey);
    return () => list.removeEventListener('keydown', onKey);
    // Re-runs when a submenu replaces the items, so focus moves to its first item.
  }, [listRef, onEscape, items, onBack]);
}

function useMenuPages(menu: MenuRequest) {
  const [pages, setPages] = useState([{ items: menu.items, label: menu.label }]);
  useEffect(() => setPages([{ items: menu.items, label: menu.label }]), [menu]);
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
}: {
  items: MenuEntry[];
  onPick: (item: MenuItem, el: HTMLElement) => void;
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
            disabled={item.disabled}
            aria-haspopup={item.submenu ? 'menu' : undefined}
            onClick={(e) => onPick(item, e.currentTarget)}
            onKeyDown={(e) => {
              if (item.submenu && e.key === 'ArrowRight') onPick(item, e.currentTarget);
            }}
          >
            {item.icon && (
              <span className="flex w-4 shrink-0 justify-center text-steel [&>svg]:size-4">
                {item.icon}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
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

function MenuPopover({ menu }: { menu: MenuRequest }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const { items, label, back, open } = useMenuPages(menu);
  useMenuKeyboard(ref, closeMenu, items, back);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const at = menu.at;
    let left = 'width' in at ? at.left : at.x;
    let top = 'width' in at ? at.bottom + 4 : at.y;
    if ('width' in at && left + width > innerWidth - 8) left = at.right - width;
    left = Math.max(8, Math.min(left, innerWidth - width - 8));
    if (top + height > innerHeight - 8)
      top =
        'width' in at ? Math.max(8, at.top - height - 4) : Math.max(8, innerHeight - height - 8);
    setPos({ left, top });
  }, [menu, items]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeMenu();
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
  }, []);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="popover animate-in fixed z-[60] max-h-[min(480px,calc(100vh-16px))] min-w-[220px] max-w-[320px] overflow-y-auto p-1"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
      onContextMenu={(e) => e.preventDefault()}
    >
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
  );
}

function MenuSheet({ menu }: { menu: MenuRequest }) {
  const ref = useRef<HTMLDivElement>(null);
  const { items, label, back, open } = useMenuPages(menu);
  useMenuKeyboard(ref, closeMenu, items, back);
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
