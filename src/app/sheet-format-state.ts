import { StateEffect, StateField } from '@codemirror/state';
import { invertedEffects } from '@codemirror/commands';
import type { SheetFormat } from '@/lib/convert/sheet-format';

/**
 * Colors of a text document's sheets, by sheet: "0" for a CSV, TSV or UNL file, the table's
 * number for a Markdown document. They live in the document's editor state, next to its
 * text, so one undo history covers both (a change that edits cells and colors them undoes
 * together). `sheet-formats.ts` saves them in the workspace.
 */
export type DocFormats = Record<string, SheetFormat>;

export const setFormats = StateEffect.define<DocFormats>();

export const formatsField = StateField.define<DocFormats>({
  create: () => ({}),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setFormats)) value = e.value;
    return value;
  },
});

export const formatsExtension = [
  formatsField,
  // Undoing a transaction puts back the colors it replaced.
  invertedEffects.of((tr) =>
    tr.effects
      .filter((e) => e.is(setFormats))
      .map(() => setFormats.of(tr.startState.field(formatsField))),
  ),
];
