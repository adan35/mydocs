import { useId, useRef, useState } from 'react';
import { FileCode2, FileText, Sheet } from 'lucide-react';
import {
  creationFormat,
  nameForFormat,
  NEW_FILE_FORMATS,
  validateNewFileName,
  type NewFileDraft,
  type NewFileFormat,
} from '@/domain/new-file';
import { Dialog } from '../components/Dialog';

export function NewFileDialog({ onClose }: { onClose(result: NewFileDraft | null): void }) {
  const [name, setName] = useState('Untitled.md');
  const [format, setFormat] = useState<NewFileFormat>('md');
  const [touched, setTouched] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const error = validateNewFileName(name);
  const info = NEW_FILE_FORMATS.find((f) => f.id === format)!;
  const Icon = ['xlsx', 'csv', 'tsv'].includes(format)
    ? Sheet
    : format === 'custom' || format === 'html' || format === 'json'
      ? FileCode2
      : FileText;

  return (
    <Dialog
      title="New file"
      description="Choose a format, or enter your own extension."
      initialFocus={input}
      onClose={() => onClose(null)}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={() => onClose(null)}>
            Cancel
          </button>
          <button type="submit" form={`${id}-form`} className="btn btn-primary" disabled={!!error}>
            Create file
          </button>
        </>
      }
    >
      <form
        id={`${id}-form`}
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!error) onClose({ name: name.trim(), format: creationFormat(name.trim()) });
        }}
      >
        <label className="mb-1.5 block text-caption font-medium text-slate" htmlFor={`${id}-name`}>
          File name
        </label>
        <input
          id={`${id}-name`}
          ref={(el) => {
            input.current = el;
            if (el && !el.dataset.selected) {
              el.dataset.selected = '1';
              requestAnimationFrame(() => el.setSelectionRange(0, 'Untitled'.length));
            }
          }}
          className="input"
          value={name}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={touched && !!error}
          aria-describedby={`${id}-help${touched && error ? ` ${id}-error` : ''}`}
          onChange={(e) => {
            setName(e.target.value);
            setFormat(creationFormat(e.target.value));
            setTouched(true);
          }}
        />
        {touched && error && (
          <p id={`${id}-error`} className="mt-1.5 text-caption text-danger" role="alert">
            {error}
          </p>
        )}
        <label
          className="mt-4 mb-1.5 block text-caption font-medium text-slate"
          htmlFor={`${id}-format`}
        >
          File type
        </label>
        <select
          id={`${id}-format`}
          className="input"
          value={format}
          onChange={(e) => {
            const next = e.target.value as NewFileFormat;
            setFormat(next);
            setName(nameForFormat(name, next));
            setTouched(true);
            if (next === 'custom')
              requestAnimationFrame(() => {
                input.current?.focus();
                input.current?.select();
              });
          }}
        >
          {NEW_FILE_FORMATS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
              {f.extension ? ` (.${f.extension})` : ''}
            </option>
          ))}
        </select>
        <div className="mt-3 flex items-center gap-3 rounded-md border border-hairline bg-surface-soft p-3 text-caption">
          <Icon size={22} className="shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium text-ink">{info.detail}</p>
            <p id={`${id}-help`} className="mt-0.5 text-steel">
              {format === 'custom'
                ? 'Use names like script.py, notes.tex, .gitignore or Makefile.'
                : format === 'xlsx'
                  ? 'Creates a real .xlsx workbook, ready to edit in Sheet view.'
                  : ['csv', 'tsv'].includes(format)
                    ? 'Opens in Sheet view. Values stay portable as plain text.'
                    : 'Saved locally in your current workspace.'}
            </p>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
