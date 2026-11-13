import { useMemo, useState } from 'react';
import { Clock, Hash, Star, Trash2, RotateCcw, PencilLine } from 'lucide-react';
import type { Entry } from '@/domain/types';
import { useApp, session } from '@/app/app-store';
import { navigate } from '@/app/router';
import * as A from '@/app/actions';
import { Page, EmptyState } from '../components/Page';
import { EntryList } from '../components/EntryList';
import type { MenuEntry } from '../components/Menu';
import { relativeTime, useIndexVersion, useTree } from '../hooks';

export function FavoritesView() {
  const tree = useTree()!;
  const favorites = useMemo(
    () =>
      tree
        .liveEntries()
        .filter((e) => e.favorite)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [tree],
  );
  return (
    <Page title="Favorites" icon={<Star />}>
      {favorites.length ? (
        <EntryList entries={favorites} showPath />
      ) : (
        <EmptyState icon={<Star />} title="No favorites yet">
          Star a document or folder from its menu or header, and it stays here and in the sidebar.
        </EmptyState>
      )}
    </Page>
  );
}

export function RecentView() {
  const tree = useTree()!;
  const recents = useApp((s) => s.recents);
  const [tab, setTab] = useState<'opened' | 'modified'>('opened');
  const opened = useMemo(
    () =>
      recents
        .map((r) => ({ e: tree.get(r.id), at: r.at }))
        .filter((x): x is { e: Entry; at: number } => !!x.e && !tree.isTrashed(x.e.id)),
    [recents, tree],
  );
  const modified = useMemo(
    () =>
      tree
        .liveFiles()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 50),
    [tree],
  );
  const openedAt = new Map(opened.map((x) => [x.e.id, x.at]));
  return (
    <Page title="Recent" icon={<Clock />}>
      <div role="tablist" aria-label="Recent" className="mb-4 flex gap-4 border-b border-hairline">
        {(['opened', 'modified'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`-mb-px border-b-2 pb-2 text-[14px] font-medium ${tab === t ? 'border-ink text-ink' : 'border-transparent text-steel hover:text-ink'}`}
            onClick={() => setTab(t)}
          >
            {t === 'opened' ? 'Recently opened' : 'Recently modified'}
          </button>
        ))}
      </div>
      {tab === 'opened' ? (
        opened.length ? (
          <EntryList
            entries={opened.map((x) => x.e)}
            showPath
            meta={(e) => `Opened ${relativeTime(openedAt.get(e.id) ?? 0)}`}
          />
        ) : (
          <EmptyState icon={<Clock />} title="Nothing opened yet">
            Documents you open appear here.
          </EmptyState>
        )
      ) : modified.length ? (
        <EntryList
          entries={modified}
          showPath
          meta={(e) => `Edited ${relativeTime(e.updatedAt)}`}
        />
      ) : (
        <EmptyState icon={<Clock />} title="No documents yet" />
      )}
    </Page>
  );
}

export function TagsView({ tag }: { tag?: string }) {
  const tree = useTree()!;
  const v = useIndexVersion();
  // The index version invalidates data derived from the (mutable) index.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tags = useMemo(() => session().knowledge.allTags(tree), [tree, v]);
  const docs = useMemo(
    () =>
      tag && v >= 0
        ? session()
            .knowledge.docsWithTag(tree, tag)
            .map((id) => tree.get(id)!)
            .filter(Boolean)
        : [],
    [tree, tag, v],
  );
  if (tag) {
    return (
      <Page
        title={`#${tag}`}
        icon={<Hash />}
        back={() => navigate({ name: 'tags' })}
        subtitle={`${docs.length} document${docs.length === 1 ? '' : 's'}`}
        actions={
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void A.renameTagEverywhere(tag)}
          >
            <PencilLine size={14} aria-hidden /> Rename tag
          </button>
        }
      >
        {docs.length ? (
          <EntryList entries={docs} showPath />
        ) : (
          <EmptyState icon={<Hash />} title="No documents use this tag anymore" />
        )}
      </Page>
    );
  }
  return (
    <Page
      title="Tags"
      icon={<Hash />}
      subtitle="Tags come from #hashtags and front-matter tags inside your documents."
    >
      {tags.length ? (
        <ul className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <li key={t.tag}>
              <button
                type="button"
                className="tap flex h-8 items-center gap-2 rounded-md border border-hairline px-3 text-[14px] text-charcoal hover:bg-hover"
                onClick={() => navigate({ name: 'tags', tag: t.tag })}
              >
                <span className="text-tag-ink">#{t.tag}</span>
                <span className="text-caption text-stone">{t.count}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<Hash />} title="No tags yet">
          Write #ideas or #work anywhere in a document, or add tags from a document's menu. Tags are
          optional.
        </EmptyState>
      )}
    </Page>
  );
}

export function TrashView() {
  const tree = useTree()!;
  const trashed = tree.trashedRoots();
  const menu = (e: Entry): MenuEntry[] => [
    { label: 'Restore', icon: <RotateCcw />, onSelect: () => void A.restoreEntries([e.id]) },
    'separator',
    {
      label: 'Delete forever…',
      icon: <Trash2 />,
      danger: true,
      onSelect: () => void A.deletePermanently([e.id]),
    },
  ];
  return (
    <Page
      title="Trash"
      icon={<Trash2 />}
      subtitle="Deleted items stay here until you delete them forever."
      actions={
        trashed.length > 0 && (
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void A.restoreEntries(trashed.map((e) => e.id))}
            >
              Restore all
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void A.emptyTrash()}>
              Empty Trash
            </button>
          </>
        )
      }
    >
      {trashed.length ? (
        <EntryList
          entries={trashed}
          menu={menu}
          onOpen={(e) => void A.restoreEntries([e.id])}
          trailing={(e) => (
            <button
              type="button"
              className="btn btn-ghost h-7 px-2 text-caption"
              onClick={() => void A.restoreEntries([e.id])}
            >
              <RotateCcw size={13} aria-hidden /> Restore
            </button>
          )}
          meta={(e) =>
            `Deleted ${relativeTime(e.trashedAt ?? 0)} · from ${e.parentId ? (tree.get(e.parentId)?.name ?? 'a deleted folder') : 'root'}`
          }
        />
      ) : (
        <EmptyState icon={<Trash2 />} title="Trash is empty">
          Items you delete can be restored from here.
        </EmptyState>
      )}
    </Page>
  );
}
