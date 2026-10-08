import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Clock } from 'lucide-react';
import type { FileType } from '@/domain/names';
import { session } from '@/app/app-store';
import { navigate } from '@/app/router';
import { openEntry } from '@/app/actions';
import { prefs } from '@/app/prefs';
import { useUi } from '@/app/ui-store';
import { editorActions } from '@/app/editor-store';
import type { SearchHit } from '@/app/search';
import { Page } from '../components/Page';
import { FileIcon } from '../components/FileIcon';
import { Highlight } from '../components/Highlight';
import { useDebounced, useIndexVersion, useTree } from '../hooks';

const RECENT_KEY = 'mydoc:recent-searches';
const DAY = 86_400_000;
const DATE_FILTERS: { label: string; days: number }[] = [
  { label: 'Today', days: 1 },
  { label: 'Past week', days: 7 },
  { label: 'Past month', days: 30 },
  { label: 'Past year', days: 365 },
];
const OPERATORS: [string, string][] = [
  ['"exact phrase"', 'Exact words in order'],
  ['-word', 'Leave out documents with a word'],
  ['tag:idea or #idea', 'Documents with a tag'],
  ['folder:Projects', 'Inside a folder'],
  ['type:md', 'md, txt, code, data, image or pdf'],
  ['modified:week', 'today, week, month, 7d, 2026-10, >2026-09-01'],
  ['created:2026', 'Same values as modified'],
];
const TYPE_FILTERS: { label: string; types: FileType[] }[] = [
  { label: 'Markdown', types: ['markdown'] },
  { label: 'Text & code', types: ['text', 'code', 'data'] },
  { label: 'Images', types: ['image'] },
  { label: 'Other', types: ['pdf', 'binary'] },
];

/** Opens a result and, for content matches, jumps to the first match. */
function openHit(hit: SearchHit) {
  if (hit.fields.includes('content')) editorActions.requestFocus(hit.id, { find: hit.terms });
  void openEntry(hit.id);
}

export function SearchView({ q }: { q: string }) {
  const tree = useTree()!;
  const indexVersion = useIndexVersion();
  const [query, setQuery] = useState(q);
  const [typeIdx, setTypeIdx] = useState<number | null>(null);
  const [tag, setTag] = useState('');
  const [folderId, setFolderId] = useState('');
  const [days, setDays] = useState(0);
  const [recent, setRecent] = useState<string[]>(() => prefs.get(RECENT_KEY, []));
  const input = useRef<HTMLInputElement>(null);
  const debounced = useDebounced(query, 120);

  useEffect(() => setQuery(q), [q]);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    navigate({ name: 'search', q: debounced }, { replace: true });
    if (debounced.trim().length < 2) return;
    const t = setTimeout(() => {
      setRecent((prev) => {
        const next = [debounced.trim(), ...prev.filter((p) => p !== debounced.trim())].slice(0, 8);
        prefs.set(RECENT_KEY, next);
        return next;
      });
    }, 1500);
    return () => clearTimeout(t);
  }, [debounced]);

  // The index version invalidates data derived from the (mutable) index.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tags = useMemo(() => session().knowledge.allTags(tree), [tree, indexVersion]);
  const folders = useMemo(
    () =>
      tree
        .liveEntries()
        .filter((e) => e.kind === 'folder')
        .map((e) => ({ id: e.id, path: tree.pathOf(e.id) }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    [tree],
  );

  const results = useMemo(() => {
    const started = performance.now();
    const hits = session().search.search(
      debounced,
      tree,
      {
        types: typeIdx !== null ? TYPE_FILTERS[typeIdx]!.types : undefined,
        tag: tag || undefined,
        folderId: folderId || undefined,
        modifiedAfter: days ? new Date().setHours(0, 0, 0, 0) - (days - 1) * DAY : undefined,
      },
      100,
    );
    return { hits, ms: performance.now() - started };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, tree, indexVersion, typeIdx, tag, folderId, days]);
  const hasFilters = typeIdx !== null || !!tag || !!folderId || !!days;
  const clearFilters = () => {
    setTypeIdx(null);
    setTag('');
    setFolderId('');
    setDays(0);
  };

  return (
    <Page title="Search" icon={<Search />}>
      <div className="relative mb-3">
        <Search
          size={18}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-steel"
          aria-hidden
        />
        <input
          ref={input}
          type="search"
          className="input h-11 pr-10 pl-10 text-[16px]"
          placeholder='Search everything. Try "exact phrase", tag:idea, modified:week'
          aria-label="Search everything"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results.hits[0]) openHit(results.hits[0]);
          }}
        />
        {query && (
          <button
            type="button"
            className="icon-btn absolute top-1/2 right-2 -translate-y-1/2"
            aria-label="Clear search"
            onClick={() => setQuery('')}
          >
            <X size={16} />
          </button>
        )}
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filters">
        {TYPE_FILTERS.map((f, i) => (
          <button
            key={f.label}
            type="button"
            aria-pressed={typeIdx === i}
            className={`h-7 rounded-full border px-3 text-caption ${typeIdx === i ? 'border-ink bg-ink text-canvas' : 'border-hairline text-steel hover:bg-hover'}`}
            onClick={() => setTypeIdx(typeIdx === i ? null : i)}
          >
            {f.label}
          </button>
        ))}
        <select
          className="input h-7 w-auto max-w-[180px] rounded-full py-0 text-caption"
          aria-label="Filter by tag"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
        >
          <option value="">Any tag</option>
          {tags.map((t) => (
            <option key={t.tag} value={t.tag}>
              #{t.tag}
            </option>
          ))}
        </select>
        <select
          className="input h-7 w-auto max-w-[220px] rounded-full py-0 text-caption"
          aria-label="Filter by folder"
          value={folderId}
          onChange={(e) => setFolderId(e.target.value)}
        >
          <option value="">Everywhere</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.path}
            </option>
          ))}
        </select>
        <select
          className="input h-7 w-auto max-w-[160px] rounded-full py-0 text-caption"
          aria-label="Filter by date modified"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value={0}>Any time</option>
          {DATE_FILTERS.map((f) => (
            <option key={f.days} value={f.days}>
              Modified: {f.label.toLowerCase()}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button
            type="button"
            className="h-7 rounded-full px-2 text-caption text-steel hover:bg-hover hover:text-ink"
            onClick={clearFilters}
          >
            Clear filters
          </button>
        )}
      </div>

      {!debounced.trim() ? (
        recent.length ? (
          <section>
            <h2 className="section-label mb-2">Recent searches</h2>
            <ul className="space-y-px">
              {recent.map((r) => (
                <li key={r}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[14px] text-charcoal hover:bg-hover"
                    onClick={() => setQuery(r)}
                  >
                    <Clock size={14} className="text-stone" aria-hidden /> {r}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="mt-2 text-caption text-steel hover:underline"
              onClick={() => (setRecent([]), prefs.remove(RECENT_KEY))}
            >
              Clear recent searches
            </button>
          </section>
        ) : (
          <p className="text-[14px] text-steel">
            Search matches file names, folder paths, #tags and the full text of every document.
            Typos are forgiven.
          </p>
        )
      ) : null}
      {!debounced.trim() ? (
        <section className="mt-6">
          <h2 className="section-label mb-2">Search operators</h2>
          <dl className="grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-[auto_1fr]">
            {OPERATORS.map(([op, desc]) => (
              <div key={op} className="contents">
                <dt>
                  <button
                    type="button"
                    className="rounded bg-surface-soft px-1.5 py-0.5 font-mono text-[12px] text-charcoal hover:bg-hover"
                    onClick={() => {
                      const first = op.split(' or ')[0]!;
                      setQuery((cur) => `${cur.trim()} ${first}`.trim());
                      input.current?.focus();
                    }}
                  >
                    {op}
                  </button>
                </dt>
                <dd className="text-steel">{desc}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : (
        <section>
          <p className="mb-2 text-caption text-steel" aria-live="polite">
            {results.hits.length === 100
              ? 'Top 100 results'
              : `${results.hits.length} result${results.hits.length === 1 ? '' : 's'}`}{' '}
            · {results.ms < 1 ? '<1' : Math.round(results.ms)} ms
          </p>
          {results.hits.length === 0 ? (
            <div className="rounded-lg border border-dashed border-hairline-strong p-8 text-center text-[14px] text-steel">
              <p>No documents match "{debounced}". Try fewer words or another spelling.</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {hasFilters && (
                  <button type="button" className="btn btn-secondary h-8" onClick={clearFilters}>
                    Clear filters
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-secondary h-8"
                  onClick={() => useUi.getState().setOverlay('quickopen')}
                >
                  Open by name instead
                </button>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-hairline-soft overflow-hidden rounded-lg border border-hairline">
              {results.hits.map((hit) => {
                const e = tree.get(hit.id);
                if (!e) return null;
                const termRe = hit.terms.length
                  ? new RegExp(
                      hit.terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
                      'gi',
                    )
                  : null;
                const nameRanges: [number, number][] = termRe
                  ? [...e.name.matchAll(termRe)].map((m) => [m.index!, m.index! + m[0].length])
                  : [];
                return (
                  <li key={hit.id}>
                    <button
                      type="button"
                      className="flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-surface-soft"
                      onClick={() => openHit(hit)}
                    >
                      <FileIcon entry={e} className="mt-0.5 shrink-0 text-steel" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium text-ink">
                          <Highlight text={e.name} ranges={nameRanges} />
                        </span>
                        <span className="block truncate text-xs text-steel">
                          {tree.dirOf(hit.id).split('/').join(' / ') || 'Workspace root'}
                        </span>
                        {hit.snippet && (
                          <span className="mt-1 line-clamp-2 block text-[13px] text-slate">
                            <Highlight text={hit.snippet.text} ranges={hit.snippet.highlights} />
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </Page>
  );
}
