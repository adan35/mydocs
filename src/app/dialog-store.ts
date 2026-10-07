import { create } from 'zustand';
import type { EntryId } from '@/domain/types';
import type { Table } from '@/domain/table';

export interface PromptOptions {
  title: string;
  label: string;
  initial?: string;
  confirmLabel?: string;
  /** Text range to preselect, e.g. the name without its extension. */
  selectRange?: [number, number];
  validate?: (value: string) => string | null;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  /** Label for the safe choice; it gets the initial focus when set. */
  cancelLabel?: string;
  danger?: boolean;
}

export interface ConflictOptions {
  name: string;
  count: number;
}

export type ConflictChoice = {
  action: 'keep-both' | 'replace' | 'skip' | 'cancel';
  applyToAll: boolean;
};

export interface PickFolderOptions {
  title: string;
  confirmLabel?: string;
  /** Entries being moved: they and their descendants can't be targets. */
  excludeIds?: EntryId[];
}

export type DialogRequest =
  | { kind: 'prompt'; options: PromptOptions; resolve: (v: string | null) => void }
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'conflict'; options: ConflictOptions; resolve: (v: ConflictChoice) => void }
  | {
      kind: 'pick-folder';
      options: PickFolderOptions;
      resolve: (v: EntryId | null | undefined) => void;
    }
  | { kind: 'template'; resolve: (v: string | null) => void }
  | { kind: 'history'; entryId: EntryId; resolve: (v: void) => void }
  | { kind: 'shortcuts'; resolve: (v: void) => void }
  | { kind: 'table'; table: Table; isNew: boolean; resolve: (v: Table | null) => void };

interface DialogState {
  stack: DialogRequest[];
  open(req: DialogRequest): void;
  close(req: DialogRequest): void;
}

export const useDialogs = create<DialogState>((set) => ({
  stack: [],
  open(req) {
    set((s) => ({ stack: [...s.stack, req] }));
  },
  close(req) {
    set((s) => ({ stack: s.stack.filter((r) => r !== req) }));
  },
}));

function request<T>(build: (resolve: (v: T) => void) => DialogRequest): Promise<T> {
  return new Promise<T>((resolve) => {
    const req = build((v: T) => {
      useDialogs.getState().close(req);
      resolve(v);
    });
    useDialogs.getState().open(req);
  });
}

export const dialogs = {
  prompt: (options: PromptOptions) =>
    request<string | null>((resolve) => ({ kind: 'prompt', options, resolve })),
  confirm: (options: ConfirmOptions) =>
    request<boolean>((resolve) => ({ kind: 'confirm', options, resolve })),
  conflict: (options: ConflictOptions) =>
    request<ConflictChoice>((resolve) => ({ kind: 'conflict', options, resolve })),
  /** Resolves to a folder id, `null` for the workspace root, or `undefined` if cancelled. */
  pickFolder: (options: PickFolderOptions) =>
    request<EntryId | null | undefined>((resolve) => ({ kind: 'pick-folder', options, resolve })),
  template: () => request<string | null>((resolve) => ({ kind: 'template', resolve })),
  history: (entryId: EntryId) =>
    request<void>((resolve) => ({ kind: 'history', entryId, resolve })),
  shortcuts: () => request<void>((resolve) => ({ kind: 'shortcuts', resolve })),
  table: (table: Table, isNew: boolean) =>
    request<Table | null>((resolve) => ({ kind: 'table', table, isNew, resolve })),
};
