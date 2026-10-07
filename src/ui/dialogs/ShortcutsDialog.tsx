import { useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { SHORTCUT_GROUPS } from '@/app/shortcuts';
import { Dialog } from '../components/Dialog';
import { formatShortcut } from '../hooks';

export function ShortcutsDialog({ onClose }: { onClose(): void }) {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();
  const groups = SHORTCUT_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter(
      ([label, keys]) =>
        !q ||
        label.toLowerCase().includes(q) ||
        formatShortcut(keys).toLowerCase().includes(q) ||
        g.title.toLowerCase().includes(q),
    ),
  })).filter((g) => g.items.length);
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose} size="lg" initialFocus={input}>
      <label className="mb-4 flex h-9 items-center gap-2 rounded-lg border border-hairline px-3 focus-within:border-[var(--primary)]">
        <Search size={15} className="text-steel" aria-hidden />
        <input
          ref={input}
          type="search"
          aria-label="Search shortcuts"
          placeholder="Search shortcuts…"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-stone"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {!groups.length && (
        <p className="py-6 text-center text-[14px] text-steel">No shortcuts match "{query}".</p>
      )}
      <div className="grid gap-x-8 gap-y-6 pb-4 sm:grid-cols-2">
        {groups.map((g) => (
          <section key={g.title}>
            <h3 className="section-label mb-2">{g.title}</h3>
            <dl className="divide-y divide-hairline-soft">
              {g.items.map(([label, keys]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-4 py-1.5 text-[14px]"
                >
                  <dt className="text-charcoal">{label}</dt>
                  <dd>
                    <kbd className="kbd">{formatShortcut(keys)}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
