import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  History,
  Link2,
  ListTree,
  Info,
  Plus,
  X,
  ArrowUpRight,
  AlertTriangle,
  ExternalLink,
  Globe,
} from 'lucide-react';
import type { EntryId } from '@/domain/types';
import type { OutlineItem } from '@/domain/outline';
import type { DocOutline } from '@/app/outline-store';
import { countWords } from '@/domain/tasks';
import { extractExternalLinks } from '@/domain/links';
import { formatBytes, fileTypeOf } from '@/domain/names';
import { session } from '@/app/app-store';
import { useUi, type RightPanel as Panel } from '@/app/ui-store';
import {
  addTagTo,
  createLinkedDocument,
  linkMention,
  openEntry,
  removeTagFrom,
} from '@/app/actions';
import { editorActions } from '@/app/editor-store';
import { dialogs } from '@/app/dialog-store';
import { navigate } from '@/app/router';
import { FileIcon } from '../components/FileIcon';
import { relativeTime, useIndexVersion, useTree } from '../hooks';
import { useAonEnabled } from '@/app/aon/enabled';
import { RelatedAon } from '../aon/RelatedAon';

interface Props {
  docId: EntryId;
  /** The document's text (text documents only). */
  text?: string;
  outline: DocOutline;
  onClose?(): void;
}

const TABS: { id: Panel; label: string; icon: React.ReactNode }[] = [
  { id: 'outline', label: 'Outline', icon: <ListTree size={15} /> },
  { id: 'backlinks', label: 'Links', icon: <Link2 size={15} /> },
  { id: 'info', label: 'Info', icon: <Info size={15} /> },
];

export function RightPanel({ docId, text, outline, onClose }: Props) {
  const stored = useUi((s) => s.rightPanel);
  const tree = useTree()!;
  const entry = tree.get(docId);
  // Links are between Markdown documents; other files have an outline and info.
  const hasLinks = !!entry && fileTypeOf(entry.name) === 'markdown';
  const tabs = TABS.filter((t) => t.id !== 'backlinks' || hasLinks);
  const panel = tabs.some((t) => t.id === stored) ? stored : 'outline';
  return (
    <aside aria-label="Document details" className="flex h-full min-h-0 w-full flex-col bg-canvas">
      <div
        role="tablist"
        aria-label="Panels"
        className="flex items-center gap-0.5 border-b border-hairline px-2 py-1.5"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={panel === t.id}
            className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-caption font-medium ${panel === t.id ? 'bg-active text-ink' : 'text-steel hover:bg-hover'}`}
            onClick={() => useUi.getState().setRightPanel(true, t.id)}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
        <span className="flex-1" />
        {onClose && (
          <button type="button" className="icon-btn" aria-label="Close panel" onClick={onClose}>
            <X size={15} />
          </button>
        )}
      </div>
      <div role="tabpanel" className="scroll-area min-h-0 flex-1 p-3">
        {panel === 'outline' && <Outline outline={outline} />}
        {panel === 'backlinks' && <Links docId={docId} text={text} />}
        {panel === 'info' && <DocInfo docId={docId} text={text} />}
      </div>
    </aside>
  );
}

/** Shows a filter box once an outline is longer than this. */
const FILTER_FROM = 15;

/**
 * The document's structure: headings (with nesting, level and size of each section), or a
 * PDF's bookmarks or pages, a workbook's sheets, the tables in the sheet view, the
 * functions of a source file. The item in view is highlighted; clicking one goes there.
 */
export function Outline({ outline }: { outline: DocOutline }) {
  const { items, active, noun } = outline;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const activeRef = useRef<HTMLButtonElement>(null);
  const minLevel = items.length ? Math.min(...items.map((h) => h.level)) : 1;
  const parents = useMemo(
    () => new Set(items.filter((h, i) => (items[i + 1]?.level ?? 0) > h.level).map((h) => h.key)),
    [items],
  );
  // The item in view, or the nearest visible heading above it when it's folded away.
  const visible: { h: OutlineItem; i: number }[] = [];
  const q = query.trim().toLocaleLowerCase();
  let shownActive = -1;
  let hideBelow = Infinity;
  for (let i = 0; i < items.length; i++) {
    const h = items[i]!;
    if (q) {
      if (h.text.toLocaleLowerCase().includes(q)) visible.push({ h, i });
      continue;
    }
    if (h.level <= hideBelow) hideBelow = Infinity;
    if (hideBelow !== Infinity) {
      if (i === active) shownActive = visible[visible.length - 1]?.i ?? -1;
      continue;
    }
    visible.push({ h, i });
    if (i === active) shownActive = i;
    if (parents.has(h.key) && collapsed.has(h.key)) hideBelow = h.level;
  }
  if (q) shownActive = active;

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [shownActive]);

  if (!items.length) {
    return (
      <p className="px-1 text-caption text-steel">
        {outline.empty ??
          'Headings you add (# Title, ## Section) appear here for quick navigation.'}
      </p>
    );
  }
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const allCollapsed = parents.size > 0 && [...parents].every((k) => collapsed.has(k));
  return (
    <nav aria-label="Outline" className="space-y-2">
      <div className="flex items-center gap-1 px-1">
        <p className="min-w-0 flex-1 truncate text-xs text-stone" data-testid="outline-summary">
          {items.length.toLocaleString()} {items.length === 1 ? noun.replace(/s$/, '') : noun}
          {outline.summary ? ` · ${outline.summary}` : ''}
        </p>
        {parents.size > 0 && !q && (
          <button
            type="button"
            className="h-6 shrink-0 rounded px-1.5 text-xs text-steel hover:bg-hover hover:text-ink"
            onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(parents))}
          >
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </button>
        )}
      </div>
      {items.length >= FILTER_FROM && (
        <input
          type="search"
          className="input h-8 w-full py-0 text-[13px]"
          placeholder={`Filter ${noun}`}
          aria-label={`Filter ${noun}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <ul className="space-y-px">
        {visible.map(({ h, i }) => {
          const isActive = i === shownActive;
          const depth = q ? 0 : h.level - minLevel;
          const parent = !q && parents.has(h.key);
          return (
            <li key={h.key} className="relative flex items-center">
              {/* Guide lines show which section an item belongs to. */}
              {Array.from({ length: depth }, (_, d) => (
                <span
                  key={d}
                  aria-hidden
                  className="absolute top-0 bottom-0 w-px bg-hairline-soft"
                  style={{ left: d * 14 + 9 }}
                />
              ))}
              <span className="shrink-0" style={{ width: depth * 14 }} />
              {parent ? (
                <button
                  type="button"
                  className="flex size-5 shrink-0 items-center justify-center rounded text-stone hover:bg-hover hover:text-ink"
                  aria-label={`${collapsed.has(h.key) ? 'Expand' : 'Collapse'} ${h.text}`}
                  aria-expanded={!collapsed.has(h.key)}
                  onClick={() => toggle(h.key)}
                >
                  <ChevronRight
                    size={12}
                    className={`transition-transform motion-reduce:transition-none ${collapsed.has(h.key) ? '' : 'rotate-90'}`}
                  />
                </button>
              ) : (
                <span className="w-5 shrink-0" />
              )}
              <button
                ref={isActive ? activeRef : undefined}
                type="button"
                aria-current={isActive ? 'location' : undefined}
                className={`relative flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1 pr-1.5 pl-1.5 text-left text-[13px] leading-snug ${isActive ? 'bg-active font-medium text-ink' : 'text-slate hover:bg-hover'}`}
                onClick={() => outline.jump(i)}
                aria-label={h.text}
                title={h.detail ? `${h.text} · ${h.detail}` : h.text}
              >
                {isActive && (
                  <span
                    aria-hidden
                    className="absolute top-1 bottom-1 left-0 w-0.5 rounded bg-primary"
                  />
                )}
                {h.badge && (
                  <span className="shrink-0 font-mono text-[10px] text-stone uppercase">
                    {h.badge}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">{h.text}</span>
                {h.detail && (
                  <span className="shrink-0 text-[11px] font-normal text-stone tabular-nums">
                    {h.detail}
                  </span>
                )}
              </button>
            </li>
          );
        })}
        {q && !visible.length && (
          <li className="px-1 text-caption text-steel">Nothing matches “{query.trim()}”.</li>
        )}
      </ul>
    </nav>
  );
}

function Links({ docId, text }: { docId: EntryId; text?: string }) {
  const aonOn = useAonEnabled();
  const tree = useTree()!;
  useIndexVersion();
  const s = session();
  const backlinks = s.knowledge.backlinks(tree, docId);
  const outgoing = s.knowledge.outgoing(tree, docId).filter((o) => o.link.kind !== 'image');
  const uniqueOut = [
    ...new Map(outgoing.filter((o) => o.targetId).map((o) => [o.targetId!, o])).values(),
  ];
  const broken = outgoing.filter((o) => !o.targetId);
  const external = useMemo(() => (text ? extractExternalLinks(text) : []), [text]);
  const total = uniqueOut.length + external.length;
  const ambiguous = s.knowledge.ambiguousLinks(tree, docId);
  const linkedIds = new Set([...backlinks, ...uniqueOut.map((o) => o.targetId!)]);
  const related = s.knowledge
    .related(tree, docId, 12)
    .filter((r) => !linkedIds.has(r))
    .slice(0, 6);
  return (
    <div className="space-y-5">
      <section>
        <h3 className="section-label mb-1.5 px-1">Backlinks · {backlinks.length}</h3>
        {backlinks.length ? (
          <EntryList ids={backlinks} />
        ) : (
          <p className="px-1 text-caption text-steel">
            No documents link here yet. Link with [text](./path.md) or [[Name]].
          </p>
        )}
      </section>
      <section>
        <h3 className="section-label mb-1.5 px-1">Links from this document · {total}</h3>
        {uniqueOut.length > 0 && (
          <EntryList ids={uniqueOut.map((o) => o.targetId!)} icon={<ArrowUpRight size={13} />} />
        )}
        {external.length > 0 && (
          <ul className="space-y-px" aria-label="Web links">
            {external.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-hover"
                >
                  <Globe size={14} aria-hidden className="shrink-0 text-steel" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">{l.label}</span>
                    <span className="block truncate text-xs text-stone">
                      {l.href.replace(/^(https?:\/\/|mailto:)/i, '')}
                    </span>
                  </span>
                  <ExternalLink size={13} aria-hidden className="text-stone" />
                </a>
              </li>
            ))}
          </ul>
        )}
        {!total && <p className="px-1 text-caption text-steel">None.</p>}
      </section>
      <UnlinkedMentions docId={docId} />
      {aonOn && <RelatedAon docId={docId} />}
      {related.length > 0 && (
        <section>
          <h3 className="section-label mb-1.5 px-1">Related · {related.length}</h3>
          <EntryList ids={related} />
        </section>
      )}
      {ambiguous.length > 0 && (
        <section>
          <h3 className="section-label mb-1.5 flex items-center gap-1 px-1 text-warning">
            <AlertTriangle size={12} aria-hidden /> Links matching several documents ·{' '}
            {ambiguous.length}
          </h3>
          <ul className="space-y-2 px-1 text-caption text-slate">
            {ambiguous.map((a) => (
              <li key={a.link.target}>
                <div className="font-mono">[[{a.link.target}]] goes to the first of:</div>
                <EntryList ids={a.candidates} />
              </li>
            ))}
          </ul>
          <p className="px-1 text-caption text-steel">
            Write the folder too, like [[Folder/Name]], to choose one.
          </p>
        </section>
      )}
      {broken.length > 0 && (
        <section>
          <h3 className="section-label mb-1.5 flex items-center gap-1 px-1 text-warning">
            <AlertTriangle size={12} aria-hidden /> Broken links · {broken.length}
          </h3>
          <ul className="space-y-1 px-1 text-caption text-slate">
            {broken.map((b, i) => (
              <li key={i} className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate font-mono" title={b.link.target}>
                  {b.link.kind === 'wiki' ? `[[${b.link.target}]]` : b.link.target}
                </span>
                {(b.link.kind === 'wiki' || !/^[a-z][a-z0-9+.-]*:/i.test(b.link.target)) && (
                  <button
                    type="button"
                    className="h-6 shrink-0 rounded px-1.5 font-sans text-xs text-steel hover:bg-hover hover:text-ink"
                    aria-label={`Create ${b.link.target}`}
                    onClick={() =>
                      void createLinkedDocument(docId, {
                        kind: b.link.kind === 'wiki' ? 'wiki' : 'markdown',
                        target: b.link.target,
                      })
                    }
                  >
                    Create
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Documents that name this one in plain text, with a one-click "Link" to connect them. */
function UnlinkedMentions({ docId }: { docId: EntryId }) {
  const tree = useTree()!;
  useIndexVersion();
  const [open, setOpen] = useState(false);
  const mentions = open
    ? session().knowledge.unlinkedMentions(tree, docId, session().workspace.allTexts())
    : [];
  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        className="section-label mb-1.5 flex items-center gap-1 px-1 hover:text-ink"
        onClick={() => setOpen(!open)}
      >
        <ChevronRight
          size={12}
          aria-hidden
          className={`transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
        />
        Unlinked mentions{open ? ` · ${mentions.length}` : ''}
      </button>
      {open &&
        (mentions.length ? (
          <ul className="space-y-px">
            {mentions.map(({ id, count }) => {
              const e = tree.get(id);
              if (!e) return null;
              return (
                <li key={id} className="flex items-center gap-1">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-hover"
                    onClick={() => {
                      const target = tree.get(docId);
                      if (target)
                        editorActions.requestFocus(id, {
                          find: [target.name.replace(/\.[^.]+$/, '')],
                        });
                      void openEntry(id);
                    }}
                  >
                    <FileIcon entry={e} className="shrink-0 text-steel" />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{e.name}</span>
                    <span className="text-xs text-stone">{count}×</span>
                  </button>
                  <button
                    type="button"
                    className="h-6 shrink-0 rounded px-1.5 text-xs text-steel hover:bg-hover hover:text-ink"
                    aria-label={`Link the mention in ${e.name}`}
                    onClick={() => void linkMention(id, docId)}
                  >
                    Link
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-1 text-caption text-steel">
            No other document mentions this one by name without linking to it.
          </p>
        ))}
    </section>
  );
}

function EntryList({ ids, icon }: { ids: EntryId[]; icon?: React.ReactNode }) {
  const tree = useTree()!;
  return (
    <ul className="space-y-px">
      {ids.map((id) => {
        const e = tree.get(id);
        if (!e) return null;
        return (
          <li key={id}>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-hover"
              onClick={() => void openEntry(id)}
            >
              <FileIcon entry={e} className="shrink-0 text-steel" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-ink">{e.name}</span>
                <span className="block truncate text-xs text-stone">
                  {tree.dirOf(id) || 'Workspace root'}
                </span>
              </span>
              {icon && <span className="text-stone">{icon}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function DocInfo({ docId, text }: { docId: EntryId; text?: string }) {
  const tree = useTree()!;
  useIndexVersion();
  const e = tree.get(docId);
  const words = useMemo(() => (text === undefined ? 0 : countWords(text)), [text]);
  if (!e) return null;
  const tags = session().knowledge.tagsOf(docId);
  const isMd = fileTypeOf(e.name) === 'markdown';
  const rows: [string, React.ReactNode][] = [
    ['Location', tree.dirOf(docId) || 'Workspace root'],
    ['Type', fileTypeOf(e.name)],
    ['Size', formatBytes(e.size)],
    ...(text === undefined
      ? []
      : ([
          ['Words', words.toLocaleString()],
          ['Characters', text.length.toLocaleString()],
          ['Lines', (text ? text.split('\n').length : 0).toLocaleString()],
          ['Reading time', `${Math.max(1, Math.round(words / 230))} min`],
        ] as [string, React.ReactNode][])),
    [
      'Modified',
      <span title={new Date(e.updatedAt).toLocaleString()}>{relativeTime(e.updatedAt)}</span>,
    ],
    [
      'Created',
      <span title={new Date(e.createdAt).toLocaleString()}>
        {new Date(e.createdAt).toLocaleDateString()}
      </span>,
    ],
  ];
  return (
    <div className="space-y-5">
      {isMd && (
        <section>
          <h3 className="section-label mb-1.5 px-1">Tags</h3>
          <div className="flex flex-wrap gap-1.5 px-1">
            {tags.map((t) => (
              <span key={t} className="tag-chip">
                <button
                  type="button"
                  className="hover:underline"
                  onClick={() => navigate({ name: 'tags', tag: t })}
                >
                  #{t}
                </button>
                <button
                  type="button"
                  aria-label={`Remove tag ${t}`}
                  className="opacity-60 hover:opacity-100"
                  onClick={() => void removeTagFrom(docId, t)}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            <button
              type="button"
              className="flex h-[22px] items-center gap-1 rounded px-1.5 text-xs text-steel hover:bg-hover"
              onClick={() => void addTagTo(docId)}
            >
              <Plus size={12} aria-hidden /> Add tag
            </button>
          </div>
        </section>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-1 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-steel">{k}</dt>
            <dd className="min-w-0 truncate text-charcoal">{v}</dd>
          </div>
        ))}
      </dl>
      {isMd && (
        <button
          type="button"
          className="btn btn-secondary w-full"
          onClick={() => void dialogs.history(docId)}
        >
          <History size={15} aria-hidden /> Version history
        </button>
      )}
    </div>
  );
}
