import {
  ArrowRight,
  FilePlus2,
  FolderPlus,
  LayoutTemplate,
  Upload,
  Star,
  Clock,
  Search,
} from 'lucide-react';
import { useMemo } from 'react';
import type { Entry } from '@/domain/types';
import { useApp } from '@/app/app-store';
import { useUi } from '@/app/ui-store';
import { navigate } from '@/app/router';
import { SHORTCUTS } from '@/app/shortcuts';
import * as A from '@/app/actions';
import { Page } from '../components/Page';
import { FileIcon } from '../components/FileIcon';
import { EntryList } from '../components/EntryList';
import { openMenuAt } from '../components/Menu';
import { importSubmenu } from '../entry-menu';
import { formatShortcut, relativeTime, useLayout, useTree } from '../hooks';

function greeting() {
  const h = new Date().getHours();
  return h < 5
    ? 'Good evening'
    : h < 12
      ? 'Good morning'
      : h < 18
        ? 'Good afternoon'
        : 'Good evening';
}

export function HomeView() {
  const tree = useTree()!;
  const recents = useApp((s) => s.recents);
  const wsName = useApp((s) => s.session?.workspace.name);
  const { phone } = useLayout();

  const recentDocs = useMemo(
    () =>
      recents
        .map((r) => tree.get(r.id))
        .filter((e): e is Entry => !!e && !tree.isTrashed(e.id) && e.kind === 'file'),
    [recents, tree],
  );
  const modified = useMemo(
    () =>
      tree
        .liveFiles()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 8),
    [tree],
  );
  const favorites = useMemo(() => tree.liveEntries().filter((e) => e.favorite), [tree]);
  const recentFolders = useMemo(() => {
    const seen = new Set<string>();
    const out: Entry[] = [];
    for (const d of [...recentDocs, ...modified]) {
      const p = tree.parentOf(d.id);
      if (p && !seen.has(p.id)) {
        seen.add(p.id);
        out.push(p);
      }
    }
    return out.slice(0, 6);
  }, [recentDocs, modified, tree]);
  const continueDoc = recentDocs[0] ?? modified[0];
  const total = tree.liveFiles().length;

  return (
    <Page title={greeting()} subtitle={`${wsName} · ${total} document${total === 1 ? '' : 's'}`}>
      {phone && (
        <button
          type="button"
          className="search-pill mb-6 flex h-11 w-full items-center gap-2 rounded-md border border-hairline bg-surface px-3 text-left text-steel"
          onClick={() => useUi.getState().setOverlay('quickopen')}
        >
          <Search size={17} aria-hidden /> Search documents
        </button>
      )}
      <section aria-label="Quick actions" className="mb-8 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <QuickAction
          icon={<FilePlus2 />}
          label="New document"
          hint={formatShortcut(SHORTCUTS.newDoc)}
          primary
          onClick={() => void A.newDocument(null)}
        />
        <QuickAction
          icon={<LayoutTemplate />}
          label="From template"
          onClick={() => void A.newFromTemplate(null)}
        />
        <QuickAction
          icon={<FolderPlus />}
          label="New folder"
          onClick={() => void A.newFolder(null)}
        />
        <QuickAction
          icon={<Upload />}
          label="Import"
          hint="or drag in"
          onClick={(el) => openMenuAt(el, importSubmenu(null), 'Import')}
        />
      </section>

      {continueDoc && (
        <section className="mb-8">
          <h2 className="section-label mb-2">Continue</h2>
          <button
            type="button"
            className="card group flex w-full items-center gap-4 p-4 text-left transition-shadow hover:shadow-2"
            onClick={() => void A.openEntry(continueDoc.id)}
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-ink">
              <FileIcon entry={continueDoc} size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px] font-medium text-ink">
                {continueDoc.name}
              </span>
              <span className="block truncate text-caption text-steel">
                {tree.dirOf(continueDoc.id) || 'Workspace root'} · edited{' '}
                {relativeTime(continueDoc.updatedAt)}
              </span>
            </span>
            <ArrowRight
              size={18}
              className="shrink-0 text-stone transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </button>
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="section-label flex items-center gap-1.5">
              <Clock size={12} aria-hidden />{' '}
              {recentDocs.length ? 'Recently opened' : 'Recently modified'}
            </h2>
            <button
              type="button"
              className="text-caption text-link hover:underline"
              onClick={() => navigate({ name: 'recent' })}
            >
              View all
            </button>
          </div>
          {(recentDocs.length ? recentDocs : modified).length ? (
            <EntryList entries={(recentDocs.length ? recentDocs : modified).slice(0, 8)} showPath />
          ) : (
            <p className="rounded-lg border border-dashed border-hairline-strong p-6 text-center text-[14px] text-steel">
              Documents you open will show up here.
            </p>
          )}
        </section>
        <aside className="space-y-8">
          <section>
            <h2 className="section-label mb-2 flex items-center gap-1.5">
              <Star size={12} aria-hidden /> Favorites
            </h2>
            {favorites.length ? (
              <ul className="space-y-px">
                {favorites.slice(0, 8).map((e) => (
                  <SmallRow key={e.id} entry={e} />
                ))}
              </ul>
            ) : (
              <p className="text-caption text-steel">
                Star documents and folders to keep them one click away.
              </p>
            )}
          </section>
          {recentFolders.length > 0 && (
            <section>
              <h2 className="section-label mb-2">Recent folders</h2>
              <ul className="space-y-px">
                {recentFolders.map((e) => (
                  <SmallRow key={e.id} entry={e} />
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </Page>
  );
}

function SmallRow({ entry }: { entry: Entry }) {
  const tree = useTree()!;
  return (
    <li>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover"
        onClick={() => void A.openEntry(entry.id)}
        title={tree.pathOf(entry.id)}
      >
        <FileIcon entry={entry} className="shrink-0 text-steel" />
        <span className="truncate text-[14px] text-charcoal">{entry.name}</span>
      </button>
    </li>
  );
}

function QuickAction({
  icon,
  label,
  hint,
  onClick,
  primary,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick(el: HTMLElement): void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      className={`flex h-[72px] flex-col items-start justify-between rounded-lg border p-3 text-left transition-colors ${primary ? 'border-transparent bg-primary text-on-primary hover:bg-primary-pressed' : 'border-hairline bg-canvas text-ink hover:bg-surface-soft'}`}
      onClick={(e) => onClick(e.currentTarget)}
    >
      <span className={`[&>svg]:size-[18px] ${primary ? '' : 'text-steel'}`}>{icon}</span>
      <span className="flex w-full items-center justify-between gap-2 text-[14px] font-medium">
        {label}
        {hint && <span className="hidden text-xs font-normal opacity-70 lg:inline">{hint}</span>}
      </span>
    </button>
  );
}
