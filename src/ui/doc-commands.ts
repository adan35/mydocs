import { useUi } from '@/app/ui-store';
import { editorActions } from '@/app/editor-store';
import { openEntry } from '@/app/actions';

export type DocCommand =
  'find' | 'toggle-mode' | 'split' | 'focus-editor' | 'insert-table' | 'panel-sheet';

/** Sends a command to the active document view (it owns the editor instance). */
export function sendDocCommand(cmd: DocCommand) {
  dispatchEvent(new CustomEvent('mydoc:doc-command', { detail: cmd }));
}

/** Side panel: docked on wide screens, a sheet over the document on smaller ones. */
export function toggleSidePanel() {
  if (matchMedia('(min-width: 1280px)').matches) {
    const ui = useUi.getState();
    ui.setRightPanel(!ui.rightPanelOpen);
  } else sendDocCommand('panel-sheet');
}

export async function reopenClosedTab() {
  const id = await editorActions.reopenClosed();
  if (id) void openEntry(id);
}
