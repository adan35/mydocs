import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  canReveal: true,
  reveal: vi.fn(),
  toast: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/platform', () => ({
  canPrint: true,
  get canRevealInFileManager() {
    return mocks.canReveal;
  },
  revealInFileManager: mocks.reveal,
}));
vi.mock('./toast-store', () => ({
  toast: mocks.toast,
  toastError: mocks.toastError,
  dismissToast: vi.fn(),
  useToasts: {},
}));
vi.mock('./app-store', () => ({
  ws: () => ({
    get: (id: string) => (id === 'doc' ? { id, kind: 'file', name: 'Notes.md' } : undefined),
  }),
  appActions: {},
  session: {},
  useApp: {},
}));
import { showInFileExplorer } from './actions';
import { sourcePaths } from './source-paths';

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.canReveal = true;
});

describe('showInFileExplorer', () => {
  it('shows the original file when the desktop app knows where it came from', async () => {
    sourcePaths.set('doc', 'C:\\Docs\\Notes.md');
    await showInFileExplorer('doc');
    expect(mocks.reveal).toHaveBeenCalledWith('C:\\Docs\\Notes.md');
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('explains and offers a copy for a document stored inside My Doc', async () => {
    await showInFileExplorer('doc');
    expect(mocks.reveal).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'This document is stored inside My Doc.' }),
    );
  });

  it('says browsers cannot open File Explorer, even if a path is stored', async () => {
    mocks.canReveal = false;
    sourcePaths.set('doc', 'C:\\Docs\\Notes.md');
    await showInFileExplorer('doc');
    expect(mocks.reveal).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Browsers can't open File Explorer.",
        action: expect.objectContaining({ label: 'Download a copy' }),
      }),
    );
  });

  it('reports a moved or deleted original', async () => {
    sourcePaths.set('doc', 'C:\\Gone.md');
    mocks.reveal.mockRejectedValue(new Error('not found'));
    await showInFileExplorer('doc');
    expect(mocks.toastError).toHaveBeenCalled();
  });
});
