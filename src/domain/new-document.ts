/** The kinds of thing "New document" can make. The picker, remembered choice and tests share this list. */

export type NewKindId =
  'md' | 'txt' | 'meeting' | 'csv' | 'xlsx' | 'html' | 'note' | 'list' | 'template';

export interface NewKind {
  id: NewKindId;
  name: string;
  description: string;
  /** Shown as a small badge; empty when the result is not a file of its own. */
  ext: string;
}

export const NEW_KINDS: NewKind[] = [
  {
    id: 'md',
    name: 'Markdown document',
    description: 'Headings, lists, links, tables and code. The default.',
    ext: '.md',
  },
  { id: 'txt', name: 'Plain text', description: 'Just text, with no formatting.', ext: '.txt' },
  {
    id: 'meeting',
    name: 'Meeting notes',
    description: 'Agenda, notes, decisions and action items.',
    ext: '.md',
  },
  {
    id: 'csv',
    name: 'CSV table',
    description: 'Rows and columns that open in Excel and every other tool.',
    ext: '.csv',
  },
  {
    id: 'xlsx',
    name: 'Excel workbook',
    description: 'A spreadsheet with formulas and several sheets.',
    ext: '.xlsx',
  },
  { id: 'html', name: 'HTML page', description: 'A web page you write as source.', ext: '.html' },
  {
    id: 'note',
    name: 'Note',
    description: 'A quick colored card for a thought or idea.',
    ext: '',
  },
  { id: 'list', name: 'Checklist', description: 'A note made of tick boxes.', ext: '' },
  {
    id: 'template',
    name: 'From a template…',
    description: 'README, project plan, lecture and your own templates.',
    ext: '',
  },
];

/** What a new file of a text kind contains. `title` is the file name without its extension. */
export const NEW_FILE_BODIES = {
  txt: () => '',
  csv: () => 'Column A,Column B,Column C\n,,\n',
  html: (title: string) =>
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>${title.replace(/[<>&]/g, '')}</title>\n</head>\n<body>\n\n</body>\n</html>\n`,
} as const;

export const isNewKindId = (v: unknown): v is NewKindId => NEW_KINDS.some((k) => k.id === v);

/** The remembered kind if it is still valid, else Markdown. */
export const lastNewKind = (saved: unknown): NewKindId => (isNewKindId(saved) ? saved : 'md');
