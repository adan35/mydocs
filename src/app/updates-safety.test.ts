import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  save: vi.fn(),
  install: vi.fn(),
  relaunch: vi.fn(),
  check: vi.fn(),
}));
vi.mock('@/platform', () => ({
  updateMode: 'in-app',
  checkForUpdate: mock.check,
  relaunchApp: mock.relaunch,
}));
vi.mock('./editor-store', () => ({ editorActions: { saveBeforeAction: mock.save } }));
import { checkNow, installUpdate, restartNow, useUpdates } from './updates';

beforeEach(() => {
  vi.resetAllMocks();
  mock.install.mockResolvedValue(undefined);
  mock.relaunch.mockResolvedValue(undefined);
  mock.check.mockResolvedValue({ version: '9.0.0', kind: 'in-app', install: mock.install });
  useUpdates.setState({ status: { phase: 'idle' }, promptOpen: false });
});

describe('updates protect document edits', () => {
  it('leaves an update available instead of installing when saving fails', async () => {
    await checkNow();
    mock.save.mockResolvedValue(false);
    await installUpdate();
    expect(mock.install).not.toHaveBeenCalled();
    expect(mock.relaunch).not.toHaveBeenCalled();
    expect(useUpdates.getState().status.phase).toBe('available');
  });

  it('does not restart into an installed update when later edits cannot save', async () => {
    mock.save.mockResolvedValue(false);
    await restartNow();
    expect(mock.relaunch).not.toHaveBeenCalled();
  });

  it('saves again before restarting after a successful installation', async () => {
    await checkNow();
    mock.save.mockResolvedValue(true);
    await installUpdate();
    expect(mock.install).toHaveBeenCalledOnce();
    expect(mock.save).toHaveBeenCalledTimes(2);
    expect(mock.relaunch).toHaveBeenCalledOnce();
  });
});
