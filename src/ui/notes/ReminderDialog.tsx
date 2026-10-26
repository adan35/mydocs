import { useState } from 'react';
import { REPEATS, type Repeat } from '@/domain/notes';
import { Dialog } from '../components/Dialog';
import { REPEAT_NAMES, fromLocalInput, toLocalInput } from './format';

/** Picks a date, time and repeat for a note reminder. */
export function ReminderDialog({
  initial,
  repeat: initialRepeat,
  onSave,
  onClose,
}: {
  initial: number | null;
  repeat: Repeat | null;
  onSave(at: number | null, repeat: Repeat | null): void;
  onClose(): void;
}) {
  const [value, setValue] = useState(() =>
    toLocalInput(initial ?? new Date().setMinutes(0, 0, 0) + 3_600_000),
  );
  const [repeat, setRepeat] = useState<Repeat | 'none'>(initialRepeat ?? 'none');
  const at = fromLocalInput(value);
  return (
    <Dialog
      title="Remind me"
      onClose={onClose}
      footer={
        <>
          {initial !== null && (
            <button
              type="button"
              className="btn btn-ghost mr-auto"
              onClick={() => {
                onSave(null, null);
                onClose();
              }}
            >
              Remove
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={at === null}
            onClick={() => {
              onSave(at, repeat === 'none' ? null : repeat);
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3 pb-2">
        <label className="flex flex-col gap-1 text-[13px] text-steel">
          Date and time
          <input
            type="datetime-local"
            className="input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-steel">
          Repeat
          <select
            className="input"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value as Repeat | 'none')}
          >
            {(['none', ...REPEATS] as const).map((r) => (
              <option key={r} value={r}>
                {REPEAT_NAMES[r]}
              </option>
            ))}
          </select>
        </label>
        <p className="text-[12px] text-steel">
          Reminders show while My Doc is open. Nothing can ring when the app is closed.
        </p>
      </div>
    </Dialog>
  );
}
