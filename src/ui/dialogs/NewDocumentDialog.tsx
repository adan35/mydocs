import { useRef, type ReactNode } from 'react';
import {
  FileCode,
  FileText,
  LayoutTemplate,
  ListChecks,
  Sheet,
  StickyNote,
  Table,
  TextAlignStart,
  Users,
} from 'lucide-react';
import { NEW_KINDS, type NewKindId } from '@/domain/new-document';
import { Dialog } from '../components/Dialog';

const ICONS: Record<NewKindId, ReactNode> = {
  md: <FileText />,
  txt: <TextAlignStart />,
  meeting: <Users />,
  csv: <Table />,
  xlsx: <Sheet />,
  html: <FileCode />,
  note: <StickyNote />,
  list: <ListChecks />,
  template: <LayoutTemplate />,
};

/** "New document": pick what to make. The kind picked last time has the focus, so Enter repeats it. */
export function NewDocumentDialog({
  last,
  onPick,
}: {
  last: NewKindId;
  onPick(kind: NewKindId | null): void;
}) {
  const lastRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      title="New document"
      description="What do you want to create?"
      size="lg"
      onClose={() => onPick(null)}
      initialFocus={lastRef}
    >
      <div
        className="grid grid-cols-1 gap-2 pb-2 sm:grid-cols-2"
        onKeyDown={(e) => {
          // 1–9 pick a kind without the mouse.
          const kind = /^[1-9]$/.test(e.key) && NEW_KINDS[Number(e.key) - 1];
          if (kind && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            onPick(kind.id);
          }
        }}
      >
        {NEW_KINDS.map((k, i) => (
          <button
            key={k.id}
            ref={k.id === last ? lastRef : undefined}
            type="button"
            data-kind={k.id}
            className="card flex items-start gap-3 p-3 text-left transition-colors hover:bg-hover focus-visible:bg-hover"
            onClick={() => onPick(k.id)}
          >
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-soft-ink [&>svg]:size-4">
              {ICONS[k.id]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 font-medium text-ink">
                <span className="truncate">{k.name}</span>
                {k.ext && <span className="text-xs font-normal text-stone">{k.ext}</span>}
              </span>
              <span className="line-clamp-2 text-caption text-steel">{k.description}</span>
            </span>
            <kbd className="kbd hidden sm:inline">{i + 1}</kbd>
          </button>
        ))}
      </div>
      <p className="pb-1 text-caption text-steel">
        Tip: hold <kbd className="kbd">Shift</kbd> while you click New document to skip this and
        create a Markdown document.
      </p>
    </Dialog>
  );
}
