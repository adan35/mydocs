import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { MemoryProvider } from '@/storage/memory';
import { Workspace, setWriteGuard } from './workspace';
import { buildZip, exportFile, type ExportDraft } from './exporter';

const saveFile = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock('@/platform', () => ({ saveFile }));

let workspace: Workspace;

beforeEach(async () => {
  setWriteGuard(() => true);
  const provider = new MemoryProvider();
  const info = await provider.create('Test');
  workspace = await Workspace.open(await provider.open(info.id));
  saveFile.mockClear();
});

describe('binary draft exports', () => {
  it('exports the current binary draft byte for byte rather than the saved file', async () => {
    const entry = await workspace.createFile(null, 'Book.xlsx', new Blob(['Old file']));
    const draft = new Blob([new Uint8Array([80, 75, 0, 255, 128, 7])], { type: entry.mime });
    await exportFile(workspace, entry.id, draft);
    expect(saveFile).toHaveBeenCalledWith(draft, 'Book.xlsx');
    expect(new Uint8Array(await (saveFile.mock.calls[0]![0] as Blob).arrayBuffer())).toEqual(
      new Uint8Array([80, 75, 0, 255, 128, 7]),
    );
  });

  it('combines binary drafts and intentionally empty text drafts in a workspace backup', async () => {
    const book = await workspace.createFile(null, 'Book.xlsx', new Blob(['Old file']));
    const note = await workspace.createFile(null, 'Note.md', 'Old text');
    const bytes = new Uint8Array([80, 75, 0, 255, 128, 7]);
    const drafts = new Map<string, ExportDraft>([
      [book.id, new Blob([bytes])],
      [note.id, ''],
    ]);
    const files = unzipSync(await buildZip(workspace, null, drafts));
    expect(files['Book.xlsx']).toEqual(bytes);
    expect(strFromU8(files['Note.md']!)).toBe('');
  });
});
