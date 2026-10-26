import { describe, expect, it } from 'vitest';
import { docModel, remoteChange } from './doc-model';

describe('shared documents in the document model', () => {
  it('mirrors local edits, never remote ones, and refuses edits while locked', () => {
    const sent: string[] = [];
    docModel.state('d1', 'hello');
    const stop = docModel.setSync('d1', {
      local: (trs) => trs.forEach((tr) => !tr.annotation(remoteChange) && sent.push('local')),
    });

    expect(docModel.dispatch('d1', { changes: { from: 5, insert: '!' } })).toBe(true);
    expect(sent).toEqual(['local']);

    // A collaborator's change is applied but not echoed back.
    docModel.dispatchRemote('d1', { changes: { from: 0, insert: '>> ' } });
    expect(docModel.text('d1')).toBe('>> hello!');
    expect(sent).toEqual(['local']);

    // Locked (viewer, or offline): the app can't edit, but collaborators' changes still arrive.
    docModel.setLocked('d1', true);
    expect(docModel.dispatch('d1', { changes: { from: 0, insert: 'x' } })).toBe(false);
    expect(docModel.undo('d1')).toBe(false);
    docModel.dispatchRemote('d1', { changes: { from: 0, insert: 'R' } });
    expect(docModel.text('d1')).toBe('R>> hello!');
    expect(docModel.isLocked('d1')).toBe(true);

    stop();
    docModel.drop('d1');
  });

  it("keeps remote changes out of the user's undo history", () => {
    docModel.state('d2', 'a');
    docModel.dispatch('d2', { changes: { from: 1, insert: 'b' } });
    docModel.dispatchRemote('d2', { changes: { from: 0, insert: 'X' } });
    expect(docModel.undo('d2')).toBe(true);
    // Only the user's own "b" is undone; the collaborator's "X" stays.
    expect(docModel.text('d2')).toBe('Xa');
    docModel.drop('d2');
  });
});
