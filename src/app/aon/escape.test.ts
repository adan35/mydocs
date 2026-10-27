import { autocompletion, startCompletion } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { aonExtension, suggestionField } from './inline';

describe('discarding a suggestion', () => {
  it('works with Escape while a completion is still being computed', () => {
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: '@aon rewrite this',
        extensions: [
          // Before AON, like the editor's own setup: this keymap sees Escape first.
          autocompletion({ override: [() => new Promise(() => {})] }),
          aonExtension(),
          suggestionField.init(() => ({
            run: 1,
            from: 0,
            to: 17,
            request: 'x',
            kind: 'request',
            original: '@aon rewrite this',
            status: 'ready',
            text: 'Something else',
          })),
        ],
      }),
    });
    startCompletion(view);
    expect(view.state.field(suggestionField)).not.toBeNull();
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }),
    );
    expect(view.state.field(suggestionField)).toBeNull();
    view.destroy();
  });
});
