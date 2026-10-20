import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry } from '@/domain/types';
import type { Workbook } from '@/lib/convert/workbook';
import { externalSaves } from '@/app/external-saves';
import { XlsxView } from './XlsxView';

const mock = vi.hoisted(() => ({
  readBlob: vi.fn(),
  saveBlob: vi.fn(),
  convert: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/app/app-store', () => ({
  ws: () => ({ readBlob: mock.readBlob, saveBlob: mock.saveBlob }),
}));
vi.mock('@/lib/convert/client', () => ({ convert: mock.convert }));
vi.mock('@/app/toast-store', () => ({ toast: vi.fn(), toastError: mock.toastError }));
vi.mock('@/app/outline-store', () => ({ publishOutline: vi.fn() }));
vi.mock('./SheetRibbon', () => ({
  SheetRibbon: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('./SheetGrid', () => ({
  SheetGrid: ({
    sheet,
    onEdit,
  }: {
    sheet: Workbook['sheets'][number];
    onEdit: (r: number, c: number, input: string) => void;
  }) => (
    <div>
      <span data-testid="value">{String(sheet.rows[0]?.[0]?.v ?? '')}</span>
      <button onClick={() => onEdit(0, 0, '1')}>Write first</button>
      <button onClick={() => onEdit(0, 0, '2')}>Write second</button>
    </div>
  ),
}));

const entry = { id: 'book', name: 'Book.xlsx', updatedAt: 1 } as Entry;
const workbook = (): Workbook => ({ sheets: [{ name: 'Data', rows: [[{ v: 0 }]] }] });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

beforeEach(() => {
  vi.clearAllMocks();
  externalSaves.reset();
  mock.readBlob.mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(0) });
  mock.saveBlob.mockResolvedValue({ updatedAt: 2 });
  mock.convert.mockImplementation(async (op: string) =>
    op === 'readXlsx'
      ? { workbook: workbook(), report: { notes: [] } }
      : { data: new Uint8Array([1]) },
  );
});

afterEach(async () => {
  cleanup();
  await externalSaves.flush();
  externalSaves.reset();
});

describe('workbook autosave', () => {
  it('keeps pending writes attached to their own file when switching between workbooks', async () => {
    const view = render(<XlsxView entry={entry} onConvert={() => {}} />);
    await screen.findByRole('button', { name: 'Write first' });
    fireEvent.click(screen.getByRole('button', { name: 'Write first' }));
    view.rerender(
      <XlsxView entry={{ ...entry, id: 'second', name: 'Second.xlsx' }} onConvert={() => {}} />,
    );
    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('0'));
    fireEvent.click(screen.getByRole('button', { name: 'Write second' }));
    await act(() => externalSaves.flush());
    expect(mock.saveBlob.mock.calls.map(([id]) => id)).toEqual(['book', 'second']);
  });

  it('serializes writes and saves edits made while a previous conversion is still running', async () => {
    const first = deferred<{ data: Uint8Array }>();
    const second = deferred<{ data: Uint8Array }>();
    const converted: Workbook[] = [];
    mock.convert.mockImplementation((op: string, payload: { workbook: Workbook }) => {
      if (op === 'readXlsx')
        return Promise.resolve({ workbook: workbook(), report: { notes: [] } });
      converted.push(payload.workbook);
      return converted.length === 1 ? first.promise : second.promise;
    });
    render(<XlsxView entry={entry} onConvert={() => {}} />);
    await screen.findByRole('button', { name: 'Write first' });
    fireEvent.click(screen.getByRole('button', { name: 'Write first' }));
    let saving!: Promise<void>;
    await act(async () => {
      saving = externalSaves.flush();
    });
    expect(externalSaves.hasUnsaved()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Write second' }));
    const overlappingFlush = externalSaves.flush();
    expect(converted).toHaveLength(1);
    await act(async () => {
      first.resolve({ data: new Uint8Array([1]) });
    });
    expect(converted).toHaveLength(2);
    expect(converted.map((wb) => wb.sheets[0]!.rows[0]![0]!.v)).toEqual([1, 2]);
    await act(async () => {
      second.resolve({ data: new Uint8Array([2]) });
      await saving;
      await overlappingFlush;
    });
    expect(mock.saveBlob).toHaveBeenCalledTimes(2);
    expect(externalSaves.hasUnsaved()).toBe(false);
    expect(screen.getByTestId('sheet-save-status').textContent).toBe('Saved');
  });

  it('retains a failed draft after leaving and recovers it on reopen before allowing new writes', async () => {
    mock.saveBlob.mockRejectedValue(new Error('Storage full'));
    const view = render(<XlsxView entry={entry} onConvert={() => {}} />);
    await screen.findByRole('button', { name: 'Write first' });
    fireEvent.click(screen.getByRole('button', { name: 'Write second' }));
    await act(() => externalSaves.flush());
    expect(externalSaves.hasUnsaved()).toBe(true);
    view.unmount();
    await act(() => externalSaves.flush());
    expect(externalSaves.snapshot<Workbook>('book')?.sheets[0]!.rows[0]![0]!.v).toBe(2);
    render(<XlsxView entry={entry} onConvert={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('2'));
    expect(screen.getByTestId('sheet-save-status').textContent).toBe('Not saved');
    mock.saveBlob.mockResolvedValue({ updatedAt: 3 });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    });
    expect(externalSaves.hasUnsaved()).toBe(false);
    expect(screen.getByTestId('sheet-save-status').textContent).toBe('Saved');
  });

  it('serializes the latest in-memory workbook for export after a storage failure', async () => {
    mock.saveBlob.mockRejectedValue(new Error('Storage full'));
    render(<XlsxView entry={entry} onConvert={() => {}} />);
    await screen.findByRole('button', { name: 'Write second' });
    fireEvent.click(screen.getByRole('button', { name: 'Write second' }));
    await act(() => externalSaves.flush());
    const drafts = await externalSaves.draftBlobs(['book']);
    expect(drafts.get('book')?.type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const [op, payload] = mock.convert.mock.calls.at(-1)!;
    expect(op).toBe('writeXlsx');
    expect(payload.workbook.sheets[0].rows[0][0].v).toBe(2);
    expect(externalSaves.hasUnsaved()).toBe(true);
  });
});
