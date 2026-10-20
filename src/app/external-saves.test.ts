import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editorActions, useEditor } from './editor-store';
import { externalSaves } from './external-saves';

beforeEach(() => editorActions.reset());
afterEach(() => editorActions.reset());

describe('binary editor save guards', () => {
  it('flushes a workbook before allowing a workspace action', async () => {
    let dirty = true;
    const flush = vi.fn(async () => {
      dirty = false;
    });
    externalSaves.register('workbook', { flush, hasUnsaved: () => dirty });
    expect(editorActions.hasUnsaved()).toBe(true);
    expect(await editorActions.saveBeforeAction()).toBe(true);
    expect(flush).toHaveBeenCalledOnce();
    expect(editorActions.hasUnsaved()).toBe(false);
  });

  it('pauses an action when a workbook save fails, even without a text buffer', async () => {
    externalSaves.register('workbook', {
      flush: async () => {
        throw new Error('Storage full');
      },
      hasUnsaved: () => true,
    });
    expect(await editorActions.saveBeforeAction()).toBe(false);
    expect(editorActions.hasUnsaved()).toBe(true);
  });

  it('leaves a tab open when its binary edits cannot be saved', async () => {
    useEditor.setState({ tabs: ['workbook'], activeId: 'workbook' });
    externalSaves.register('workbook', {
      flush: async () => {},
      hasUnsaved: () => true,
    });
    await editorActions.close('workbook');
    expect(useEditor.getState().tabs).toEqual(['workbook']);
    expect(useEditor.getState().activeId).toBe('workbook');
  });

  it('does not flush or block on unrelated workbooks for a scoped action', async () => {
    const flush = vi.fn(async () => {});
    externalSaves.register('unrelated', { flush, hasUnsaved: () => true });
    expect(await editorActions.saveBeforeAction(['other-file'])).toBe(true);
    expect(flush).not.toHaveBeenCalled();
    expect(editorActions.hasUnsaved()).toBe(true);
  });

  it('includes binary editors in background and page-close flushing', async () => {
    const flush = vi.fn(async () => {});
    externalSaves.register('workbook', { flush, hasUnsaved: () => true });
    await editorActions.flushAll();
    expect(flush).toHaveBeenCalledOnce();
  });

  it('retains an unmounted failed draft until a retry saves it', async () => {
    const draft = { sheets: [{ name: 'Sheet1', rows: [[{ v: 'Latest edit' }]] }] };
    let dirty = true;
    const dispose = externalSaves.register('workbook', {
      hasUnsaved: () => dirty,
      flush: async () => {
        dirty = false;
      },
      snapshot: () => draft,
    });
    dispose();
    expect(externalSaves.snapshot('workbook')).toBe(draft);
    expect(editorActions.hasUnsaved()).toBe(true);
    await editorActions.flushAll();
    expect(externalSaves.ids()).toEqual([]);
    expect(externalSaves.snapshot('workbook')).toBeUndefined();
  });

  it('keeps a reopened editor registered when the old view cleans up', () => {
    const disposeOld = externalSaves.register('workbook', {
      hasUnsaved: () => true,
      flush: async () => {},
      snapshot: () => 'Old draft',
    });
    externalSaves.register('workbook', {
      hasUnsaved: () => true,
      flush: async () => {},
      snapshot: () => 'Recovered draft',
    });
    disposeOld();
    expect(externalSaves.snapshot('workbook')).toBe('Recovered draft');
  });

  it('drops a clean editor on unmount without exposing a stale recovery snapshot', () => {
    const dispose = externalSaves.register('workbook', {
      hasUnsaved: () => false,
      flush: async () => {},
      snapshot: () => 'Saved content',
    });
    expect(externalSaves.snapshot('workbook')).toBeUndefined();
    dispose();
    expect(externalSaves.ids()).toEqual([]);
  });

  it('exports only dirty requested drafts and propagates serialization errors', async () => {
    const draft = new Blob(['latest bytes']);
    const cleanExport = vi.fn(async () => new Blob(['saved bytes']));
    externalSaves.register('dirty', {
      hasUnsaved: () => true,
      flush: async () => {},
      exportBlob: async () => draft,
    });
    externalSaves.register('clean', {
      hasUnsaved: () => false,
      flush: async () => {},
      exportBlob: cleanExport,
    });
    externalSaves.register('broken', {
      hasUnsaved: () => true,
      flush: async () => {},
      exportBlob: async () => {
        throw new Error('Serialization failed');
      },
    });
    expect(await externalSaves.draftBlobs(['dirty', 'clean'])).toEqual(new Map([['dirty', draft]]));
    expect(cleanExport).not.toHaveBeenCalled();
    await expect(externalSaves.draftBlobs(['broken'])).rejects.toThrow('Serialization failed');
  });
});
