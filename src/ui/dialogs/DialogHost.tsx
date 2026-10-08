import { useMemo, useRef, useState } from 'react';
import { ChevronRight, Home } from 'lucide-react';
import { useDialogs, type DialogRequest } from '@/app/dialog-store';
import { TEMPLATES, type Template } from '@/domain/templates';
import { TEMPLATES_FOLDER, workspaceTemplates } from '@/app/actions';
import type { EntryId } from '@/domain/types';
import { Dialog } from '../components/Dialog';
import { FileIcon } from '../components/FileIcon';
import { useTree } from '../hooks';
import { HistoryDialog } from './HistoryDialog';
import { ShortcutsDialog } from './ShortcutsDialog';
import { TableDialog } from './TableDialog';

export function DialogHost() {
  const stack = useDialogs((s) => s.stack);
  return (
    <>
      {stack.map((req, i) => (
        <DialogFor key={i} req={req} />
      ))}
    </>
  );
}

function DialogFor({ req }: { req: DialogRequest }) {
  switch (req.kind) {
    case 'prompt':
      return <PromptDialog req={req} />;
    case 'confirm':
      return <ConfirmDialog req={req} />;
    case 'conflict':
      return <ConflictDialog req={req} />;
    case 'pick-folder':
      return <FolderPicker req={req} />;
    case 'template':
      return <TemplateDialog req={req} />;
    case 'history':
      return <HistoryDialog entryId={req.entryId} onClose={() => req.resolve()} />;
    case 'shortcuts':
      return <ShortcutsDialog onClose={() => req.resolve()} />;
    case 'table':
      return <TableDialog initial={req.table} isNew={req.isNew} onClose={req.resolve} />;
  }
}

function PromptDialog({ req }: { req: Extract<DialogRequest, { kind: 'prompt' }> }) {
  const { options, resolve } = req;
  const [value, setValue] = useState(options.initial ?? '');
  const [touched, setTouched] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const error = options.validate?.(value) ?? null;
  const submit = () => {
    setTouched(true);
    if (!error) resolve(value.trim());
  };
  return (
    <Dialog
      title={options.title}
      onClose={() => resolve(null)}
      initialFocus={input}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={() => resolve(null)}>
            Cancel
          </button>
          <button
            type="submit"
            form="prompt-form"
            className="btn btn-primary"
            disabled={touched && !!error}
          >
            {options.confirmLabel ?? 'OK'}
          </button>
        </>
      }
    >
      <form
        id="prompt-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="mb-1.5 block text-caption font-medium text-slate" htmlFor="prompt-input">
          {options.label}
        </label>
        <input
          id="prompt-input"
          ref={(el) => {
            input.current = el;
            if (el && !el.dataset.selected) {
              el.dataset.selected = '1';
              const [a, b] = options.selectRange ?? [0, el.value.length];
              requestAnimationFrame(() => el.setSelectionRange(a, b));
            }
          }}
          className="input"
          value={value}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={touched && !!error}
          aria-describedby={touched && error ? 'prompt-error' : undefined}
          onChange={(e) => {
            setValue(e.target.value);
            setTouched(true);
          }}
        />
        {touched && error && (
          <p id="prompt-error" className="mt-1.5 text-caption text-danger" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

function ConfirmDialog({ req }: { req: Extract<DialogRequest, { kind: 'confirm' }> }) {
  const { options, resolve } = req;
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      title={options.title}
      description={options.message}
      onClose={() => resolve(false)}
      initialFocus={options.danger || options.cancelLabel ? cancel : undefined}
      footer={
        <>
          <button
            ref={cancel}
            type="button"
            className="btn btn-secondary"
            onClick={() => resolve(false)}
          >
            {options.cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="button"
            className={`btn ${options.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => resolve(true)}
          >
            {options.confirmLabel ?? 'Confirm'}
          </button>
        </>
      }
    />
  );
}

function ConflictDialog({ req }: { req: Extract<DialogRequest, { kind: 'conflict' }> }) {
  const { options, resolve } = req;
  const [applyToAll, setApplyToAll] = useState(false);
  const pick = (action: 'keep-both' | 'replace' | 'skip' | 'cancel') =>
    resolve({ action, applyToAll });
  return (
    <Dialog
      title="A file with this name already exists"
      description={
        <>
          <strong className="break-all text-ink">{options.name}</strong> is already in this folder.
          Replacing keeps the old text in version history.
        </>
      }
      onClose={() => pick('cancel')}
      footer={
        <>
          <button type="button" className="btn btn-ghost mr-auto" onClick={() => pick('cancel')}>
            Stop import
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => pick('skip')}>
            Skip
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => pick('replace')}>
            Replace
          </button>
          <button type="button" className="btn btn-primary" onClick={() => pick('keep-both')}>
            Keep both
          </button>
        </>
      }
    >
      {options.count > 1 && (
        <label className="flex items-center gap-2 text-[14px] text-charcoal">
          <input
            type="checkbox"
            className="size-4 accent-[var(--primary)]"
            checked={applyToAll}
            onChange={(e) => setApplyToAll(e.target.checked)}
          />
          Do this for all remaining conflicts
        </label>
      )}
    </Dialog>
  );
}

function FolderPicker({ req }: { req: Extract<DialogRequest, { kind: 'pick-folder' }> }) {
  const { options, resolve } = req;
  const tree = useTree()!;
  const [selected, setSelected] = useState<EntryId | null>(null);
  const [filter, setFilter] = useState('');
  const excluded = useMemo(() => new Set(options.excludeIds ?? []), [options.excludeIds]);
  const rows = useMemo(() => {
    const out: { id: EntryId; name: string; depth: number; path: string }[] = [];
    const walk = (parent: EntryId | null, depth: number) => {
      for (const e of tree.childrenOf(parent)) {
        if (e.kind !== 'folder' || excluded.has(e.id)) continue;
        out.push({ id: e.id, name: e.name, depth, path: tree.pathOf(e.id) });
        walk(e.id, depth + 1);
      }
    };
    walk(null, 0);
    const q = filter.trim().toLowerCase();
    return q
      ? out.filter((r) => r.path.toLowerCase().includes(q)).map((r) => ({ ...r, depth: 0 }))
      : out;
  }, [tree, excluded, filter]);
  const valid = selected === null || ![...excluded].some((id) => tree.isWithin(selected, id));
  return (
    <Dialog
      title={options.title}
      onClose={() => resolve(undefined)}
      size="md"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={() => resolve(undefined)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!valid}
            onClick={() => resolve(selected)}
          >
            {options.confirmLabel ?? 'Choose'}
          </button>
        </>
      }
    >
      <input
        className="input mb-2"
        placeholder="Filter folders"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label="Filter folders"
      />
      <div
        role="listbox"
        aria-label="Folders"
        className="max-h-[50vh] min-h-[200px] overflow-y-auto rounded-md border border-hairline p-1"
      >
        <button
          type="button"
          role="option"
          aria-selected={selected === null}
          className="menu-item"
          data-active={selected === null}
          onClick={() => setSelected(null)}
          onDoubleClick={() => resolve(null)}
        >
          <Home size={16} className="text-steel" aria-hidden />
          <span className="font-medium">Workspace root</span>
        </button>
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            role="option"
            aria-selected={selected === r.id}
            className="menu-item"
            data-active={selected === r.id}
            style={{ paddingLeft: 10 + (r.depth + 1) * 16 }}
            onClick={() => setSelected(r.id)}
            onDoubleClick={() => resolve(r.id)}
            title={r.path}
          >
            <FileIcon entry={{ kind: 'folder', name: r.name }} className="shrink-0 text-steel" />
            <span className="truncate">{filter ? r.path : r.name}</span>
          </button>
        ))}
        {!rows.length && filter && (
          <p className="p-3 text-caption text-steel">No folders match "{filter}".</p>
        )}
      </div>
      {selected && (
        <p className="mt-2 flex items-center gap-1 truncate text-caption text-steel">
          <ChevronRight size={12} aria-hidden /> {tree.pathOf(selected)}
        </p>
      )}
    </Dialog>
  );
}

function TemplateDialog({ req }: { req: Extract<DialogRequest, { kind: 'template' }> }) {
  const mine = workspaceTemplates();
  const card = (t: Template) => (
    <button
      key={t.id}
      type="button"
      className="card flex flex-col items-start gap-1 p-4 text-left transition-colors hover:bg-hover"
      onClick={() => req.resolve(t.id)}
    >
      <span className="font-medium text-ink">{t.name}</span>
      <span className="line-clamp-2 text-caption text-steel">{t.description}</span>
    </button>
  );
  return (
    <Dialog title="New from template" onClose={() => req.resolve(null)} size="lg">
      <h3 className="section-label mb-2">Your templates</h3>
      {mine.length ? (
        <div className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-2">{mine.map(card)}</div>
      ) : (
        <p className="mb-5 text-caption text-steel">
          Any Markdown file in a top-level <strong>{TEMPLATES_FOLDER}</strong> folder becomes a
          template. Use <strong>Save as template</strong> from a document's menu or the command
          palette. {'{{title}}'}, {'{{date}}'} and {'{{time}}'} are filled in for you.
        </p>
      )}
      <h3 className="section-label mb-2">Built in</h3>
      <div className="grid grid-cols-1 gap-2 pb-3 sm:grid-cols-2">{TEMPLATES.map(card)}</div>
    </Dialog>
  );
}
