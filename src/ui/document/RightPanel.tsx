import { useMemo, useState } from 'react';
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
} from 'lucide-react';
import type { EntryId } from '@/domain/types';
import { extractHeadings } from '@/domain/outline';
import { countWords } from '@/domain/tasks';
import { formatBytes, fileTypeOf } from '@/domain/names';
import { session } from '@/app/app-store';
import { useUi, type RightPanel as Panel } from '@/app/ui-store';
import { addTagTo, linkMention, openEntry, removeTagFrom } from '@/app/actions';
import { editorActions } from '@/app/editor-store';
import { dialogs } from '@/app/dialog-store';
import { navigate } from '@/app/router';
import { FileIcon } from '../components/FileIcon';
import { relativeTime, useIndexVersion, useTree } from '../hooks';

interface Props {
  docId: EntryId;
  text: string;
  activeLine: number;
  onJump(line: number): void;
  onClose?(): void;
}

const TABS: { id: Panel; label: string; icon: React.ReactNode }[] = [
  { id: 'outline', label: 'Outline', icon: <ListTree size={15} /> },
  { id: 'backlinks', label: 'Links', icon: <Link2 size={15} /> },
  { id: 'info', label: 'Info', icon: <Info size={15} /> },
];

export function RightPanel({ docId, text, activeLine, onJump, onClose }: Props) {
  const panel = useUi((s) => s.rightPanel);
  return (
    <aside aria-label="Document details" className="flex h-full min-h-0 w-full flex-col bg-canvas">
      <div
        role="tablist"
        aria-label="Panels"
        className="flex items-center gap-0.5 border-b border-hairline px-2 py-1.5"
      >
        {TABS.map((t) => (
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
        {panel === 'outline' && <Outline text={text} activeLine={activeLine} onJump={onJump} />}
        {panel === 'backlinks' && <Links docId={docId} />}
        {panel === 'info' && <DocInfo docId={docId} text={text} />}
      </div>
    </aside>
  );
}

export function Outline({
  text,
  activeLine,
  onJump,
}: {
  text: string;
  activeLine: number;
  onJump(line: number): void;
}) {
  const headings = useMemo(() => extractHeadings(text), [text]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  if (!headings.length) {
    return (
      <p className="px-1 text-caption text-steel">
        Headings you add (# Title, ## Section) appear here for quick navigation.
      </p>
    );
  }
  const minLevel = Math.min(...headings.map((h) => h.level));
  let current = -1;
  for (let i = 0; i < headings.length; i++) if (headings[i]!.line <= activeLine) current = i;
  // A heading has children when the next heading is deeper; collapsed ones hide them.
  const visible: { h: (typeof headings)[number]; i: number; parent: boolean }[] = [];
  let hideBelow = Infinity;
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]!;
    if (h.level <= hideBelow) hideBelow = Infinity;
    if (hideBelow !== Infinity) continue;
    const parent = (headings[i + 1]?.level ?? 0) > h.level;
    visible.push({ h, i, parent });
    if (parent && collapsed.has(h.slug)) hideBelow = h.level;
  }
  const toggle = (slug: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(slug)) next.add(slug);
      return next;
    });
  return (
    <nav aria-label="Outline">
      <ul className="space-y-px">
        {visible.map(({ h, i, parent }) => (
          <li
            key={`${h.line}-${h.slug}`}
            className="flex items-center"
            style={{ paddingLeft: (h.level - minLevel) * 12 }}
          >
            {parent ? (
              <button
                type="button"
                className="flex size-5 shrink-0 items-center justify-center rounded text-stone hover:bg-hover hover:text-ink"
                aria-label={`${collapsed.has(h.slug) ? 'Expand' : 'Collapse'} ${h.text}`}
                aria-expanded={!collapsed.has(h.slug)}
                onClick={() => toggle(h.slug)}
              >
                <ChevronRight
                  size={12}
                  className={`transition-transform motion-reduce:transition-none ${collapsed.has(h.slug) ? '' : 'rotate-90'}`}
                />
              </button>
            ) : (
              <span className="w-5 shrink-0" />
            )}
            <button
              type="button"
              aria-current={i === current ? 'location' : undefined}
              className={`block min-w-0 flex-1 truncate rounded-md py-1 pr-2 pl-1 text-left text-[13px] leading-snug hover:bg-hover ${i === current ? 'font-medium text-ink' : 'text-slate'}`}
              onClick={() => onJump(h.line)}
              title={h.text}
            >
              {h.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Links({ docId }: { docId: EntryId }) {
  const tree = useTree()!;
  useIndexVersion();
  const s = session();
  const backlinks = s.knowledge.backlinks(tree, docId);
  const outgoing = s.knowledge.outgoing(tree, docId).filter((o) => o.link.kind !== 'image');
  const uniqueOut = [
    ...new Map(outgoing.filter((o) => o.targetId).map((o) => [o.targetId!, o])).values(),
  ];
  const broken = outgoing.filter((o) => !o.targetId);
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
        <h3 className="section-label mb-1.5 px-1">Links from this document · {uniqueOut.length}</h3>
        {uniqueOut.length ? (
          <EntryList ids={uniqueOut.map((o) => o.targetId!)} icon={<ArrowUpRight size={13} />} />
        ) : (
          <p className="px-1 text-caption text-steel">None.</p>
        )}
      </section>
      <UnlinkedMentions docId={docId} />
      {related.length > 0 && (
        <section>
          <h3 className="section-label mb-1.5 px-1">Related · {related.length}</h3>
          <EntryList ids={related} />
        </section>
      )}
      {broken.length > 0 && (
        <section>
          <h3 className="section-label mb-1.5 flex items-center gap-1 px-1 text-warning">
            <AlertTriangle size={12} aria-hidden /> Broken links · {broken.length}
          </h3>
          <ul className="space-y-1 px-1 text-caption text-slate">
            {broken.map((b, i) => (
              <li key={i} className="truncate font-mono" title={b.link.target}>
                {b.link.kind === 'wiki' ? `[[${b.link.target}]]` : b.link.target}
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

function DocInfo({ docId, text }: { docId: EntryId; text: string }) {
  const tree = useTree()!;
  useIndexVersion();
  const e = tree.get(docId);
  const words = useMemo(() => countWords(text), [text]);
  if (!e) return null;
  const tags = session().knowledge.tagsOf(docId);
  const isMd = fileTypeOf(e.name) === 'markdown';
  const rows: [string, React.ReactNode][] = [
    ['Location', tree.dirOf(docId) || 'Workspace root'],
    ['Type', fileTypeOf(e.name)],
    ['Size', formatBytes(e.size)],
    ['Words', words.toLocaleString()],
    ['Characters', text.length.toLocaleString()],
    ['Lines', (text ? text.split('\n').length : 0).toLocaleString()],
    ['Reading time', `${Math.max(1, Math.round(words / 230))} min`],
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
