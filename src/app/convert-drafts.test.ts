import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workbookToXlsx } from '@/lib/convert/xlsx';
import { externalSaves } from './external-saves';
import { runConversion } from './convert';

const mock = vi.hoisted(() => ({ readBlob: vi.fn(), flush: vi.fn() }));
vi.mock('./app-store', () => ({
  ws: () => ({
    get: () => ({ id: 'book', name: 'Book.xlsx' }),
    readBlob: mock.readBlob,
  }),
}));
vi.mock('./editor-store', () => ({
  editorActions: { flush: mock.flush, textOf: () => undefined },
}));
vi.mock('@/platform', () => ({ saveFile: vi.fn() }));
vi.mock('@/lib/convert/client', async () => {
  const { xlsxToWorkbook } = await import('@/lib/convert/xlsx');
  return {
    convert: async (op: string, input: { data: Uint8Array }) => {
      if (op !== 'readXlsx') throw new Error('Unexpected operation');
      const out = xlsxToWorkbook(input.data);
      return { workbook: out.workbook, report: out.report.toJSON() };
    },
  };
});

const file = (label: string) =>
  new Blob([
    workbookToXlsx({
      sheets: [{ name: 'Data', rows: [[{ v: label }, { v: 9 }]] }],
    }).data as BlobPart,
  ]);

beforeEach(() => {
  vi.clearAllMocks();
  externalSaves.reset();
  mock.readBlob.mockResolvedValue(file('Old'));
});
afterEach(() => externalSaves.reset());

describe('workbook conversion drafts', () => {
  it('converts the current workbook even when saving it to local storage failed', async () => {
    externalSaves.register('book', {
      flush: async () => {},
      hasUnsaved: () => true,
      exportBlob: async () => file('Latest'),
    });
    const out = await runConversion('book', 'csv');
    expect(await out.blob.text()).toBe('Latest,9\n');
    expect(mock.readBlob).not.toHaveBeenCalled();
  });

  it('rejects an unreadable draft instead of converting a stale saved copy', async () => {
    externalSaves.register('book', {
      flush: async () => {},
      hasUnsaved: () => true,
      exportBlob: async () => {
        throw new Error('Cannot serialize workbook');
      },
    });
    await expect(runConversion('book', 'csv')).rejects.toThrow('Cannot serialize workbook');
    expect(mock.readBlob).not.toHaveBeenCalled();
  });
});
