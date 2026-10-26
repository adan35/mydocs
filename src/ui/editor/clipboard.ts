import { selectAll } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { toast } from '@/app/toast-store';

export type EditAction = 'cut' | 'copy' | 'paste' | 'select-all';

/** Cut, copy, paste and select all for the Edit menu, in the source editor or (without `view`) the page. */
export async function runEdit(view: EditorView | null, what: EditAction) {
  view?.focus();
  if (what === 'select-all')
    return void (view ? selectAll(view) : document.execCommand('selectAll'));
  if (what !== 'paste') return void document.execCommand(what);
  let text: string | null = null;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    /* denied or unsupported: explained below */
  }
  if (text === null) {
    toast({ message: 'This browser does not allow pasting from a menu. Press Ctrl+V instead.' });
  } else if (view) {
    view.dispatch({ ...view.state.replaceSelection(text), userEvent: 'input.paste' });
  } else document.execCommand('insertText', false, text);
}
