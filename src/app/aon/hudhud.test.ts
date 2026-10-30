import { describe, expect, it } from 'vitest';
import { hudhudState, type HudhudInput } from './hudhud';

const base: HudhudInput = {
  busy: false,
  usingTool: false,
  typing: false,
  justDone: false,
  inactive: false,
};
const pose = (over: Partial<HudhudInput>) => hudhudState({ ...base, ...over });

describe('hudhudState', () => {
  it('rests in idle', () => expect(pose({})).toBe('idle'));
  it('listens while the person types', () => expect(pose({ typing: true })).toBe('listening'));
  it('thinks while a request is in flight, and searches while it uses a tool', () => {
    expect(pose({ busy: true })).toBe('thinking');
    expect(pose({ busy: true, usingTool: true })).toBe('searching');
  });
  it('celebrates an answer, then goes back to idle', () => {
    expect(pose({ justDone: true })).toBe('success');
    expect(pose({})).toBe('idle');
  });
  it('falls asleep when inactive', () => expect(pose({ inactive: true })).toBe('sleeping'));
  it('work wins over everything else', () => {
    expect(pose({ busy: true, typing: true, justDone: true, inactive: true })).toBe('thinking');
    expect(pose({ typing: true, inactive: true })).toBe('listening');
    expect(pose({ justDone: true, inactive: true })).toBe('success');
  });
});
