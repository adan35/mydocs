import { useEffect } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { useToasts, type Toast } from '@/app/toast-store';
import { useMenuOpen } from './Menu';
import { useDialogOpen } from './Dialog';

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  // An open menu sheet sits above toasts so they never block its items.
  const menuOpen = useMenuOpen();
  // Phone dialogs are bottom sheets; toasts move to the top so they never cover them.
  const dialogOpen = useDialogOpen();
  const place = dialogOpen
    ? 'top-[calc(12px+env(safe-area-inset-top))] md:top-auto'
    : 'bottom-[calc(64px+env(safe-area-inset-bottom))]';
  return (
    <div
      aria-live="polite"
      className={`pointer-events-none fixed right-0 ${place} left-0 ${menuOpen ? 'z-[55]' : 'z-[80]'} flex flex-col items-center gap-2 px-3 md:right-4 md:bottom-4 md:left-auto md:items-end`}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToasts((s) => s.dismiss);
  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast, dismiss]);
  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className="popover animate-in pointer-events-auto flex w-full max-w-[420px] items-start gap-3 bg-ink py-2.5 pr-2 pl-3.5 text-[14px] text-canvas"
    >
      {toast.tone === 'error' && (
        <AlertCircle size={16} className="mt-0.5 shrink-0 text-[#ff8a80]" aria-hidden />
      )}
      {toast.tone === 'success' && (
        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[#6fdc8c]" aria-hidden />
      )}
      <div className="min-w-0 flex-1 py-0.5">
        <p className="leading-snug">{toast.message}</p>
        {toast.detail && (
          <p className="mt-0.5 text-caption leading-snug break-words opacity-70">{toast.detail}</p>
        )}
      </div>
      {toast.action && (
        <button
          type="button"
          className="tap h-7 shrink-0 rounded-md px-2 text-[13px] font-semibold text-[#b8adff] hover:bg-white/10 dark:text-primary"
          onClick={() => {
            toast.action!.run();
            dismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        className="tap flex size-7 shrink-0 items-center justify-center rounded-md opacity-60 hover:bg-white/10 hover:opacity-100"
        onClick={() => dismiss(toast.id)}
      >
        <X size={14} />
      </button>
    </div>
  );
}
