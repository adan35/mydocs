import type { ReactNode } from 'react';
import { ArrowLeft, Menu } from 'lucide-react';
import { useUi } from '@/app/ui-store';
import { useLayout } from '../hooks';

/** Consistent page chrome for non-document views. */
export function Page({
  title,
  icon,
  actions,
  children,
  back,
  subtitle,
}: {
  title: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  back?: () => void;
  subtitle?: ReactNode;
}) {
  const { phone, tablet } = useLayout();
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  return (
    <div className="scroll-area h-full">
      <div className="mx-auto w-full max-w-[960px] px-4 pt-4 pb-24 sm:px-8 sm:pt-10">
        <header className="mb-6 flex flex-wrap items-start gap-2">
          {back ? (
            <button
              type="button"
              className="icon-btn mt-0.5 -ml-2"
              aria-label="Back"
              onClick={back}
            >
              <ArrowLeft size={18} />
            </button>
          ) : (
            (tablet || (!phone && !sidebarOpen)) && (
              <button
                type="button"
                className="icon-btn mt-0.5 -ml-2"
                aria-label="Open sidebar"
                onClick={() =>
                  tablet ? useUi.getState().setDrawer(true) : useUi.getState().setSidebar(true)
                }
              >
                <Menu size={18} />
              </button>
            )
          )}
          {/* Actions drop to their own row before the title gets squeezed. */}
          <div className="min-w-0 flex-[1_1_14rem]">
            <h1 className="flex items-center gap-2.5 text-[26px] leading-tight font-semibold tracking-[-0.01em] text-ink sm:text-[30px]">
              {icon && <span className="text-stone [&>svg]:size-6">{icon}</span>}
              <span className="min-w-0 break-words">{title}</span>
            </h1>
            {subtitle && <div className="mt-1 text-[14px] text-steel">{subtitle}</div>}
          </div>
          {actions && (
            <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              {actions}
            </div>
          )}
        </header>
        {children}
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  actions,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-hairline-strong px-6 py-14 text-center">
      <div className="mb-3 text-stone [&>svg]:size-8">{icon}</div>
      <h2 className="text-[16px] font-semibold text-ink">{title}</h2>
      {children && <div className="mt-1 max-w-md text-[14px] text-steel">{children}</div>}
      {actions && <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}
