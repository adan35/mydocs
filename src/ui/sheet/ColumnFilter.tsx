import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Filter as FilterIcon, Search, X } from 'lucide-react';
import {
  describeColumnFilter,
  filteredColumns,
  FILTER_OPS,
  type ColumnFilter,
  type ColumnFilters,
  type FilterOp,
} from '@/lib/convert/table-sheet';

/** More choices than this are not drawn at once; searching narrows them. */
const MAX_LISTED = 300;

/**
 * The filter for one column: tick the values to keep, and/or add a condition (contains,
 * greater than…). Applying changes only what the sheet shows, never the file.
 */
export function ColumnFilterPanel({
  anchor,
  title,
  values,
  filter,
  onApply,
  onClose,
}: {
  anchor: HTMLElement;
  /** e.g. "E · Category". */
  title: string;
  /** Every text the column shows (below the header) with its row count. */
  values: { text: string; count: number }[];
  filter: ColumnFilter | undefined;
  /** Null removes the filter from this column. */
  onApply(next: ColumnFilter | null): void;
  onClose(restoreFocus?: boolean): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [selected, setSelected] = useState(
    () => new Set(filter?.include ?? values.map((v) => v.text)),
  );
  const [query, setQuery] = useState('');
  const [op, setOp] = useState<FilterOp | ''>(filter?.cond?.op ?? '');
  const [value, setValue] = useState(filter?.cond?.value ?? '');
  const needsValue = op !== '' && FILTER_OPS.find((o) => o.id === op)!.needsValue;

  const shownValues = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? values.filter((v) => (v.text || '(empty)').toLowerCase().includes(q)) : values;
  }, [values, query]);
  const allShown = shownValues.length > 0 && shownValues.every((v) => selected.has(v.text));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    let left = a.left;
    let top = a.bottom + 4;
    if (left + width > innerWidth - 8) left = a.right - width;
    left = Math.max(8, Math.min(left, innerWidth - width - 8));
    if (top + height > innerHeight - 8) top = Math.max(8, a.top - height - 4);
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => search.current?.focus(), []);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose(false);
    };
    const scrolled = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose(false);
    };
    const away = () => onClose(false);
    addEventListener('pointerdown', down, true);
    addEventListener('scroll', scrolled, true);
    addEventListener('resize', away);
    return () => {
      removeEventListener('pointerdown', down, true);
      removeEventListener('scroll', scrolled, true);
      removeEventListener('resize', away);
    };
  }, [anchor, onClose]);

  const toggleShown = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const v of shownValues) {
        if (allShown) next.delete(v.text);
        else next.add(v.text);
      }
      return next;
    });
  const toggle = (text: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(text)) next.add(text);
      return next;
    });

  const hasCond = op !== '' && (!needsValue || value.trim() !== '');
  const everyValue = values.every((v) => selected.has(v.text));
  const canApply = selected.size > 0 || values.length === 0;
  const apply = () => {
    if (!canApply) return;
    const next: ColumnFilter = {};
    if (!everyValue) next.include = values.filter((v) => selected.has(v.text)).map((v) => v.text);
    if (hasCond) next.cond = { op: op as FilterOp, value: needsValue ? value : '' };
    onApply(next.include || next.cond ? next : null);
  };

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`Filter ${title}`}
      data-testid="column-filter"
      className="popover animate-in fixed z-[60] flex max-h-[min(30rem,calc(100vh-16px))] w-[280px] max-w-[calc(100vw-16px)] flex-col gap-2 p-2.5"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose(true);
        } else if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
          e.preventDefault();
          apply();
        }
      }}
    >
      <div className="flex items-center gap-1.5 text-caption font-medium text-ink">
        <FilterIcon size={14} className="text-steel" aria-hidden />
        <span className="truncate">Filter {title}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <select
          className="input h-8 py-0 text-caption"
          aria-label="Filter condition"
          value={op}
          onChange={(e) => setOp(e.target.value as FilterOp | '')}
        >
          <option value="">No condition</option>
          {FILTER_OPS.map((o) => (
            <option key={o.id} value={o.id}>
              {`Rows where the cell ${o.label}`}
            </option>
          ))}
        </select>
        {needsValue && (
          <input
            className="input h-8 py-0 text-caption"
            aria-label="Filter value"
            placeholder="Value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
      </div>

      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-steel"
          aria-hidden
        />
        <input
          ref={search}
          className="input h-8 w-full py-0 pl-8 text-caption"
          aria-label="Search values"
          placeholder="Search values"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto rounded-[8px] border border-hairline"
        role="group"
        aria-label="Values"
        data-testid="filter-values"
      >
        {shownValues.length === 0 ? (
          <p className="px-3 py-3 text-caption text-steel">No values match.</p>
        ) : (
          <>
            <label className="flex cursor-pointer items-center gap-2 border-b border-hairline-soft px-2.5 py-1.5 text-caption font-medium">
              <input type="checkbox" checked={allShown} onChange={toggleShown} />
              {query.trim() ? 'Select all results' : 'Select all'}
              <span className="ml-auto font-normal text-steel">
                {shownValues.length.toLocaleString()}
              </span>
            </label>
            {shownValues.slice(0, MAX_LISTED).map((v) => (
              <label
                key={v.text}
                className="flex cursor-pointer items-center gap-2 px-2.5 py-1 text-caption hover:bg-surface-soft"
              >
                <input
                  type="checkbox"
                  checked={selected.has(v.text)}
                  onChange={() => toggle(v.text)}
                />
                <span className={`min-w-0 flex-1 truncate ${v.text ? '' : 'italic text-steel'}`}>
                  {v.text || '(empty)'}
                </span>
                <span className="text-steel">{v.count.toLocaleString()}</span>
              </label>
            ))}
            {shownValues.length > MAX_LISTED && (
              <p className="px-2.5 py-1.5 text-xs text-steel">
                {(shownValues.length - MAX_LISTED).toLocaleString()} more. Search to narrow the
                list.
              </p>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-ghost h-8 px-2 text-caption"
          disabled={!filter}
          onClick={() => onApply(null)}
        >
          Clear filter
        </button>
        <span className="flex-1" />
        {!canApply && <span className="text-xs text-steel">Pick a value</span>}
        <button
          type="button"
          className="btn btn-primary h-8 px-3 text-caption"
          disabled={!canApply}
          onClick={apply}
        >
          Apply
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** The filters in force, one chip each (click to change, × to remove), and how many rows pass. */
export function FilterChips({
  filters,
  labelOf,
  onEdit,
  onRemove,
  onClear,
  shown,
  total,
}: {
  filters: ColumnFilters;
  labelOf(col: number): string;
  onEdit(col: number, anchor: HTMLElement): void;
  onRemove(col: number): void;
  onClear(): void;
  shown: number;
  total: number;
}) {
  const cols = filteredColumns(filters);
  if (!cols.length) return null;
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline-soft bg-surface-soft px-2 py-1.5 text-caption"
      role="region"
      aria-label="Active filters"
      data-testid="filter-bar"
    >
      <FilterIcon size={14} className="text-steel" aria-hidden />
      {cols.map((c) => (
        <span
          key={c}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-hairline bg-canvas py-0.5 pl-1 pr-1"
          data-testid="filter-chip"
        >
          <button
            type="button"
            className="max-w-[28rem] truncate rounded-full px-1.5 hover:bg-surface-soft"
            title="Change this filter"
            onClick={(e) => onEdit(c, e.currentTarget)}
          >
            <span className="font-medium">{labelOf(c)}</span>{' '}
            <span className="text-steel">{describeColumnFilter(filters[c]!)}</span>
          </button>
          <button
            type="button"
            className="icon-btn size-5"
            aria-label={`Remove filter on ${labelOf(c)}`}
            onClick={() => onRemove(c)}
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <button type="button" className="btn btn-ghost h-7 px-2 text-caption" onClick={onClear}>
        Clear all
      </button>
      <span className="ml-auto text-steel" aria-live="polite">
        {shown.toLocaleString()} of {total.toLocaleString()} rows
      </span>
    </div>
  );
}
