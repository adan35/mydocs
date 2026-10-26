import type { ReactNode } from 'react';

export function Section({
  title,
  children,
  description,
}: {
  title: string;
  children: ReactNode;
  description?: string;
}) {
  return (
    <section className="mb-10">
      <h2 className="text-[16px] font-semibold text-ink">{title}</h2>
      {description && <p className="mt-0.5 text-caption text-steel">{description}</p>}
      <div className="mt-3 divide-y divide-hairline-soft rounded-lg border border-hairline">
        {children}
      </div>
    </section>
  );
}

export function Row({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="text-[14px] text-ink">
          {label}
        </label>
        {hint && <p className="text-caption text-steel">{hint}</p>}
      </div>
      <div className="min-w-0 max-w-full sm:shrink-0">{children}</div>
    </div>
  );
}
