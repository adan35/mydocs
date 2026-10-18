/**
 * What MyDocs can do with each format: view, edit, convert and export, and what each
 * conversion keeps or loses. The conversion dialog, the Formats page and
 * docs/FORMATS.md are all generated from this table, so they cannot disagree.
 */

export type FormatId = 'md' | 'docx' | 'xlsx' | 'csv' | 'tsv' | 'unl' | 'html' | 'txt' | 'pdf';

export interface FormatInfo {
  id: FormatId;
  label: string;
  extensions: string[];
  /** How the file opens. */
  view: string;
  /** What can be edited in place, without converting. */
  edit: string;
}

export const FORMATS: FormatInfo[] = [
  {
    id: 'md',
    label: 'Markdown',
    extensions: ['md', 'markdown', 'mdx'],
    view: 'Source, split, rich and reading views',
    edit: 'Everything: source, rich editing, tables as a sheet',
  },
  {
    id: 'docx',
    label: 'Word document',
    extensions: ['docx'],
    view: 'Formatted read-only view',
    edit: 'Not in place. Convert to Markdown to edit; the original is kept.',
  },
  {
    id: 'xlsx',
    label: 'Excel workbook',
    extensions: ['xlsx'],
    view: 'Sheet view with sheet tabs and formulas',
    edit: 'Cell values and formulas; every save keeps a version',
  },
  {
    id: 'csv',
    label: 'CSV',
    extensions: ['csv'],
    view: 'Sheet view, or as text',
    edit: 'Cells (only edited rows are rewritten) or raw text',
  },
  {
    id: 'tsv',
    label: 'TSV',
    extensions: ['tsv', 'tab'],
    view: 'Sheet view, or as text',
    edit: 'Cells (only edited rows are rewritten) or raw text',
  },
  {
    id: 'unl',
    label: 'UNL',
    extensions: ['unl'],
    view: 'Sheet view (pipe-delimited, columns A, B, C… with an optional header row), or as text',
    edit: 'Cells (only edited rows are rewritten, keeping the trailing delimiter) or raw text',
  },
  {
    id: 'html',
    label: 'HTML',
    extensions: ['html', 'htm'],
    view: 'Source with highlighting',
    edit: 'Source text',
  },
  {
    id: 'txt',
    label: 'Plain text',
    extensions: ['txt', 'text', 'log'],
    view: 'Text editor',
    edit: 'Text',
  },
  {
    id: 'pdf',
    label: 'PDF',
    extensions: ['pdf'],
    view: 'Page viewer with search, zoom and page navigation',
    edit: 'No',
  },
];

export type ActionKind =
  /** Creates a new file in the workspace next to the original. */
  | 'convert'
  /** Saves a file outside the workspace (download, Save dialog or share sheet). */
  | 'export';

export interface Conversion {
  from: FormatId;
  to: FormatId;
  kinds: ActionKind[];
  keeps: string[];
  loses: string[];
  /** For spreadsheet sources and Markdown tables: works on one sheet or table at a time. */
  scope?: 'sheet' | 'table' | 'all-tables';
}

const MD_TO_WORD_KEEPS = [
  'Headings (as Word heading styles)',
  'Bold, italic, strikethrough, inline code',
  'Bulleted, numbered and nested lists',
  'Task lists (as ☐/☒)',
  'Links and heading links',
  'Tables with alignment and a header row',
  'Images stored in the workspace',
  'Quotes and code blocks',
  'Title, author and tags',
];

export const CONVERSIONS: Conversion[] = [
  {
    from: 'md',
    to: 'docx',
    kinds: ['convert', 'export'],
    keeps: MD_TO_WORD_KEEPS,
    loses: [
      'Code block languages',
      'Equations (kept as TeX text)',
      'Raw HTML (kept as text)',
      'Images from the web (kept as their description)',
      'Front matter fields other than title, author, subject, tags and dates',
    ],
  },
  {
    from: 'md',
    to: 'html',
    kinds: ['convert', 'export'],
    keeps: [
      'Everything the preview shows, as a standalone page',
      'Links between documents (as relative links)',
    ],
    loses: [
      'Diagrams render only when opened in MyDocs',
      'Embedded workspace images are linked, not embedded',
    ],
  },
  {
    from: 'md',
    to: 'txt',
    kinds: ['convert', 'export'],
    keeps: ['All words, in order'],
    loses: ['All formatting', 'Link destinations', 'Images'],
  },
  {
    from: 'md',
    to: 'pdf',
    kinds: ['export'],
    keeps: ['The reading view, as printed by your system'],
    loses: [
      'Links between documents',
      'Not available in the Android and iOS apps (no print dialog): they share HTML instead',
    ],
  },
  {
    from: 'md',
    to: 'xlsx',
    kinds: ['convert', 'export'],
    scope: 'all-tables',
    keeps: [
      'Every table, one per sheet',
      'Plain numbers as numbers, TRUE/FALSE as booleans',
      'Everything else (leading zeros, dates, codes) exactly as text',
    ],
    loses: ['Text around the tables', 'Inline formatting inside cells (kept as Markdown text)'],
  },
  {
    from: 'md',
    to: 'csv',
    kinds: ['convert', 'export'],
    scope: 'table',
    keeps: ['One table, every cell exactly as written'],
    loses: ['Column alignment', 'Other tables'],
  },
  {
    from: 'docx',
    to: 'md',
    kinds: ['convert'],
    keeps: [
      'Headings (Word heading styles and Title)',
      'Bold, italic, strikethrough, underline, superscript, subscript',
      'Bulleted, numbered and nested lists, with start numbers',
      'Links and bookmarks',
      'Tables (first row as header) with alignment',
      'Embedded images (saved to an assets folder)',
      'Quotes and monospaced paragraphs as code',
      'Title, author, subject and keywords',
    ],
    loses: [
      'Comments and footnotes',
      'Tracked changes (imported as accepted)',
      'Merged cells (split)',
      'Headers, footers, page layout and fonts',
      'Shapes, charts and text box positions',
    ],
  },
  {
    from: 'docx',
    to: 'html',
    kinds: ['export'],
    keeps: ['Same as Word → Markdown'],
    loses: ['Same as Word → Markdown'],
  },
  {
    from: 'docx',
    to: 'txt',
    kinds: ['export'],
    keeps: ['All words, in order'],
    loses: ['All formatting and images'],
  },
  {
    from: 'xlsx',
    to: 'csv',
    kinds: ['convert', 'export'],
    scope: 'sheet',
    keeps: ['The values each cell shows (formula results, formatted dates)'],
    loses: [
      'Formulas (saved as their values)',
      'Other sheets',
      'Number formats beyond the shown text',
    ],
  },
  {
    from: 'xlsx',
    to: 'tsv',
    kinds: ['convert', 'export'],
    scope: 'sheet',
    keeps: ['The values each cell shows'],
    loses: ['Formulas (saved as their values)', 'Other sheets'],
  },
  {
    from: 'xlsx',
    to: 'md',
    kinds: ['convert'],
    keeps: ['Every sheet as a heading and a table of shown values'],
    loses: ['Formulas (saved as their values)', 'Number types (cells become text)'],
  },
  {
    from: 'csv',
    to: 'xlsx',
    kinds: ['convert', 'export'],
    keeps: [
      'Every value',
      'Plain numbers as numbers, TRUE/FALSE as booleans',
      'Leading zeros, dates and codes exactly as text',
    ],
    loses: [],
  },
  {
    from: 'csv',
    to: 'md',
    kinds: ['convert'],
    keeps: ['Every value, as a table with the first row as header'],
    loses: ['Line breaks inside cells (become spaces)'],
  },
  { from: 'csv', to: 'tsv', kinds: ['convert', 'export'], keeps: ['Every value'], loses: [] },
  {
    from: 'tsv',
    to: 'xlsx',
    kinds: ['convert', 'export'],
    keeps: ['Every value', 'Plain numbers as numbers'],
    loses: [],
  },
  {
    from: 'tsv',
    to: 'md',
    kinds: ['convert'],
    keeps: ['Every value, as a table'],
    loses: ['Line breaks inside cells (become spaces)'],
  },
  { from: 'tsv', to: 'csv', kinds: ['convert', 'export'], keeps: ['Every value'], loses: [] },
  {
    from: 'unl',
    to: 'xlsx',
    kinds: ['convert', 'export'],
    keeps: [
      'Every value, one row per record',
      'Plain numbers as numbers (250.0 keeps its decimal place)',
      'Leading zeros, dates and codes exactly as text',
    ],
    loses: ['The trailing delimiter (it ends a row, it is not a column)'],
  },
  {
    from: 'unl',
    to: 'csv',
    kinds: ['convert', 'export'],
    keeps: ['Every value, including escaped delimiters and line breaks'],
    loses: ['The trailing delimiter (it ends a row, it is not a column)'],
  },
  {
    from: 'unl',
    to: 'tsv',
    kinds: ['convert', 'export'],
    keeps: ['Every value'],
    loses: ['The trailing delimiter (it ends a row, it is not a column)'],
  },
  {
    from: 'unl',
    to: 'md',
    kinds: ['convert'],
    keeps: ['Every value, as a table with columns named A, B, C…'],
    loses: ['Line breaks inside cells (become spaces)'],
  },
  {
    from: 'html',
    to: 'md',
    kinds: ['convert'],
    keeps: [
      'Headings, paragraphs, lists, quotes, code, tables, links, images',
      'Bold, italic, strikethrough, underline, sub/superscript',
      'Title, author, description and keywords',
    ],
    loses: [
      'Styling and layout',
      'Scripts, forms and embedded media',
      'Merged table cells (split)',
    ],
  },
  {
    from: 'txt',
    to: 'md',
    kinds: ['convert'],
    keeps: [
      'All text; blank lines separate paragraphs; Markdown characters are escaped so nothing changes meaning',
    ],
    loses: [],
  },
];

export const NOT_SUPPORTED: { what: string; why: string }[] = [
  {
    what: 'Google Docs and Google Sheets',
    why: 'Not connected. Download them as .docx or .xlsx and import those; export from MyDocs as .docx or .xlsx and upload to Google Drive.',
  },
  {
    what: 'Editing PDFs, or converting PDFs to text documents',
    why: 'PDFs have no reliable structure; text extraction would guess at headings, tables and reading order.',
  },
  {
    what: 'Editing Word documents in place',
    why: 'Word layout features (sections, fonts, comments) have no Markdown equivalent; converting first makes every loss visible before it happens.',
  },
  {
    what: 'Sync, sharing and real-time collaboration',
    why: 'MyDocs keeps documents on this device only. There is no server.',
  },
  {
    what: 'Formatted viewing of legacy .doc, .xls, .ppt and .rtf',
    why: 'These open as raw text or bytes with the original available to download. Save them as .docx, .xlsx or .pptx for a document preview.',
  },
];

export function formatOf(name: string): FormatInfo | undefined {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return FORMATS.find((f) => f.extensions.includes(ext));
}

export function conversionsFrom(from: FormatId): Conversion[] {
  return CONVERSIONS.filter((c) => c.from === from);
}

export const formatLabel = (id: FormatId) => FORMATS.find((f) => f.id === id)!.label;

/** The matrix as Markdown (docs/FORMATS.md and the in-app Formats page). */
export function capabilityMarkdown(): string {
  const rows = FORMATS.map(
    (f) =>
      `| ${f.label} (${f.extensions.map((e) => `.${e}`).join(', ')}) | ${f.view} | ${f.edit} |`,
  );
  const conv = CONVERSIONS.map(
    (c) =>
      `| ${formatLabel(c.from)} → ${formatLabel(c.to)} | ${c.kinds.join(', ')}${c.scope ? ` (${c.scope.replace('-', ' ')})` : ''} | ${c.keeps.join('; ')} | ${c.loses.join('; ') || 'Nothing'} |`,
  );
  const not = NOT_SUPPORTED.map((n) => `| ${n.what} | ${n.why} |`);
  return [
    '## Opening and editing',
    '',
    '| Format | Opens as | Edit in place |',
    '| --- | --- | --- |',
    ...rows,
    '| PowerPoint (.pptx) | Text-only slide preview in presentation order (up to 20 MB) | No |',
    '| OpenDocument (.odt, .ods, .odp) | Text-only content preview (up to 20 MB) | No |',
    '| Audio and video | Playback controls when the device supports the codec | No |',
    '| Images | Image preview when the device supports the format | No |',
    '| Other files | Text editor when readable as text; otherwise file details and a 512-byte hexadecimal preview | Text files only |',
    '',
    '## Converting and exporting',
    '',
    '*Convert* creates a new file next to the original; the original is never changed. *Export* saves a copy outside MyDocs.',
    '',
    '| Conversion | How | Keeps | Loses |',
    '| --- | --- | --- | --- |',
    ...conv,
    '',
    '## Not supported',
    '',
    '| What | Why |',
    '| --- | --- |',
    ...not,
    '',
  ].join('\n');
}
