import { useState } from 'react';
import { Pin, X } from 'lucide-react';
import { useEditor, editorActions } from '@/app/editor-store';
import { navigate, useRouter } from '@/app/router';
import { appActions } from '@/app/app-store';
import { closeTab, openEntry } from '@/app/actions';
import { SHORTCUTS } from '@/app/shortcuts';
import { FileIcon } from '../components/FileIcon';
import { openMenu } from '../components/Menu';
import { useTree } from '../hooks';
import { reopenClosedTab } from '../doc-commands';

/** Open documents: open, close, pin, reorder, close others/right/all, reopen. */
export function TabBar() {
  const tabs = useEditor((s) => s.tabs);
  const activeId = useEditor((s) => s.activeId);
  const pinned = useEditor((s) => s.pinned);
  const route = useRouter((s) => s.route);
  const tree = useTree()!;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  if (!tabs.length) return null;
  const onDoc = route.name === 'doc';

  const close = async (id: string) => {
    const hadFocus = !!document.activeElement?.closest('[role="tablist"]');
    await closeTab(id);
    if (hadFocus)
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus(),
      );
  };

  return (
    <div
      role="tablist"
      aria-label="Open documents"
      className="flex h-9 shrink-0 items-end gap-px overflow-x-auto border-b border-hairline bg-surface-soft px-1.5 [scrollbar-width:none] no-print"
    >
      {tabs.map((id, i) => {
        const e = tree.get(id);
        if (!e) return null;
        const selected = onDoc && id === activeId;
        const isPinned = pinned.includes(id);
        return (
          <div
            key={id}
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            draggable
            title={tree.pathOf(id)}
            data-pinned={isPinned || undefined}
            className={`group relative flex h-8 ${isPinned ? 'max-w-[160px] min-w-0' : 'max-w-[200px] min-w-[96px]'} shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md pr-1 pl-2.5 text-[13px] select-none ${
              selected
                ? 'bg-canvas text-ink shadow-[0_1px_0_var(--canvas)]'
                : 'text-steel hover:bg-hover hover:text-charcoal'
            } ${dragIndex === i ? 'opacity-50' : ''}`}
            onClick={() => void openEntry(id)}
            onAuxClick={(ev) => ev.button === 1 && void close(id)}
            onKeyDown={(ev) => {
              if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
                const next =
                  tabs[(i + (ev.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]!;
                void openEntry(next);
                requestAnimationFrame(() =>
                  document
                    .querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
                    ?.focus(),
                );
              } else if (ev.key === 'Delete') void close(id);
            }}
            onContextMenu={(ev) => {
              ev.preventDefault();
              openMenu({
                at: { x: ev.clientX, y: ev.clientY },
                label: e.name,
                items: [
                  { label: 'Close', shortcut: SHORTCUTS.closeTab, onSelect: () => void close(id) },
                  {
                    label: 'Close others',
                    onSelect: () => void editorActions.closeOthers(id).then(() => openEntry(id)),
                  },
                  {
                    label: 'Close tabs to the right',
                    disabled: i === tabs.length - 1,
                    onSelect: () => void editorActions.closeToRight(id),
                  },
                  {
                    label: 'Close all',
                    onSelect: () =>
                      void editorActions.closeAll().then(() => {
                        const left = useEditor.getState().tabs[0];
                        if (left) void openEntry(left);
                        else navigate({ name: 'home' });
                      }),
                  },
                  'separator',
                  {
                    label: isPinned ? 'Unpin tab' : 'Pin tab',
                    icon: <Pin size={14} />,
                    onSelect: () => editorActions.togglePin(id),
                  },
                  'separator',
                  {
                    label: 'Reopen closed tab',
                    shortcut: SHORTCUTS.reopenTab,
                    onSelect: () => void reopenClosedTab(),
                  },
                  { label: 'Reveal in sidebar', onSelect: () => appActions.reveal(id) },
                ],
              });
            }}
            onDragStart={(ev) => {
              setDragIndex(i);
              ev.dataTransfer.effectAllowed = 'move';
              ev.dataTransfer.setData('application/x-mydoc-tab', String(i));
            }}
            onDragEnd={() => setDragIndex(null)}
            onDragOver={(ev) => {
              if (ev.dataTransfer.types.includes('application/x-mydoc-tab')) ev.preventDefault();
            }}
            onDrop={(ev) => {
              const from = Number(ev.dataTransfer.getData('application/x-mydoc-tab'));
              if (!Number.isNaN(from) && from !== i) editorActions.reorder(from, i);
              setDragIndex(null);
            }}
          >
            <FileIcon entry={e} size={14} className="shrink-0 opacity-80" />
            <span className="min-w-0 flex-1 truncate">{e.name}</span>
            {isPinned ? (
              <button
                type="button"
                tabIndex={-1}
                aria-label={`Unpin ${e.name}`}
                title="Pinned (click to unpin)"
                className="flex size-5 shrink-0 items-center justify-center rounded text-steel hover:bg-active hover:text-ink"
                onClick={(ev) => {
                  ev.stopPropagation();
                  editorActions.togglePin(id);
                }}
              >
                <Pin size={12} />
              </button>
            ) : (
              <TabCloseButton id={id} name={e.name} onClose={() => void close(id)} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function TabCloseButton({ id, name, onClose }: { id: string; name: string; onClose(): void }) {
  const dirty = useEditor((s) => {
    const b = s.buffers[id];
    return !!b && b.status !== 'loading' && b.text !== b.savedText;
  });
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={`Close ${name}${dirty ? ' (unsaved changes)' : ''}`}
      className="group/close relative flex size-5 shrink-0 items-center justify-center rounded text-stone hover:bg-active hover:text-ink"
      onClick={(ev) => {
        ev.stopPropagation();
        onClose();
      }}
    >
      {dirty && (
        <span
          className="absolute size-2 rounded-full bg-steel group-hover/close:hidden"
          aria-hidden
        />
      )}
      <X
        size={13}
        className={
          dirty
            ? 'hidden group-hover/close:block'
            : 'opacity-0 group-hover:opacity-100 group-aria-selected:opacity-100'
        }
      />
    </button>
  );
}
