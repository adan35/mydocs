import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { create } from 'zustand';
import { restoreFocus } from '../focus';
import { lockBackground } from '../modal';

interface Props {
  title: string;
  description?: ReactNode;
  onClose(): void;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Element to focus first; defaults to the first focusable. */
  initialFocus?: React.RefObject<HTMLElement | null>;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]):not([disabled])';

const useOpenDialogs = create<{ count: number }>(() => ({ count: 0 }));
/** True while any modal dialog is open (toasts move out of its way). */
export const useDialogOpen = () => useOpenDialogs((s) => s.count > 0);

/** Accessible modal: focus trap, Esc to close, focus restored on close. */
export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
  size = 'sm',
  initialFocus,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    useOpenDialogs.setState((s) => ({ count: s.count + 1 }));
    return () => useOpenDialogs.setState((s) => ({ count: s.count - 1 }));
  }, []);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current!;
    const unlock = lockBackground();
    (initialFocus?.current ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        onCloseRef.current();
      } else if (e.key === 'Tab') {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
          (n) => n.offsetParent !== null,
        );
        if (!items.length) {
          e.preventDefault();
          el.focus();
          return;
        }
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      unlock();
      restoreFocus(previous);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const width = { sm: 'sm:max-w-[420px]', md: 'sm:max-w-[560px]', lg: 'sm:max-w-[760px]' }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-start sm:pt-[12vh]">
      <div
        className="absolute inset-0 bg-[var(--scrim)]"
        aria-hidden
        onClick={() => onCloseRef.current()}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`popover animate-in safe-bottom relative flex max-h-[90dvh] w-full flex-col rounded-b-none sm:max-h-[calc(88vh-24px)] sm:rounded-b-xl ${width} sm:mx-4`}
      >
        <div className="flex items-start gap-3 px-5 pt-5 pb-2">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[16px] font-semibold text-ink">
              {title}
            </h2>
            {description && (
              <div id={descId} className="mt-1 text-[14px] text-slate">
                {description}
              </div>
            )}
          </div>
          <button
            type="button"
            className="icon-btn -mt-1 -mr-2"
            aria-label="Close"
            onClick={() => onCloseRef.current()}
          >
            <X size={16} />
          </button>
        </div>
        {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">{children}</div>}
        {footer && <div className="flex flex-wrap justify-end gap-2 px-5 pt-3 pb-5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
