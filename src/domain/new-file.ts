import { baseName, extensionOf, NAME_ERROR_MESSAGES, validateName } from './names';

export const NEW_FILE_FORMATS = [
  { id: 'md', label: 'Markdown document', extension: 'md', detail: 'Rich writing and preview' },
  { id: 'txt', label: 'Plain text', extension: 'txt', detail: 'A simple text document' },
  { id: 'xlsx', label: 'Excel workbook', extension: 'xlsx', detail: 'Sheets, values and formulas' },
  { id: 'csv', label: 'CSV spreadsheet', extension: 'csv', detail: 'Comma-separated values' },
  { id: 'tsv', label: 'TSV spreadsheet', extension: 'tsv', detail: 'Tab-separated values' },
  { id: 'json', label: 'JSON', extension: 'json', detail: 'Structured data' },
  { id: 'html', label: 'HTML', extension: 'html', detail: 'A web page source file' },
  {
    id: 'custom',
    label: 'Other / code file',
    extension: '',
    detail: 'Any text extension or dotfile',
  },
] as const;

export type NewFileFormat = (typeof NEW_FILE_FORMATS)[number]['id'];
export interface NewFileDraft {
  name: string;
  format: NewFileFormat;
}

/** The extension chooses the actual content, even when the name is edited by hand. */
export function creationFormat(name: string): NewFileFormat {
  const ext = extensionOf(name.trim());
  if (['md', 'markdown', 'mdx', 'mdown', 'mkd'].includes(ext)) return 'md';
  if (ext === 'htm') return 'html';
  return NEW_FILE_FORMATS.find((f) => f.extension && f.extension === ext)?.id ?? 'custom';
}

export function nameForFormat(name: string, format: NewFileFormat): string {
  const ext = NEW_FILE_FORMATS.find((f) => f.id === format)!.extension;
  if (!ext) return baseName(name.trim()) || 'Untitled';
  return `${baseName(name.trim()) || 'Untitled'}.${ext}`;
}

// These formats need real encoded content. An empty text file with their extension
// would be a corrupt file, so the custom-file path must not pretend to create one.
const IMPORT_FORMATS = new Set([
  'pdf',
  'doc',
  'docx',
  'xls',
  'ppt',
  'pptx',
  'odt',
  'ods',
  'odp',
  'zip',
  '7z',
  'rar',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'avif',
  'bmp',
  'ico',
  'tif',
  'tiff',
  'mp3',
  'wav',
  'ogg',
  'oga',
  'opus',
  'flac',
  'm4a',
  'aac',
  'mp4',
  'm4v',
  'webm',
  'ogv',
  'mov',
  'mkv',
  'avi',
  'exe',
  'dll',
  'wasm',
  'woff',
  'woff2',
  'ttf',
  'otf',
]);

export function validateNewFileName(name: string): string | null {
  const error = validateName(name);
  if (error) return NAME_ERROR_MESSAGES[error];
  if (IMPORT_FORMATS.has(extensionOf(name.trim())))
    return 'Import an existing file for this format. New files support text, code and Excel workbooks.';
  return null;
}

export function initialFileText(format: Exclude<NewFileFormat, 'xlsx'>): string {
  switch (format) {
    case 'json':
      return '{}\n';
    case 'html':
      return '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>Untitled</title>\n</head>\n<body>\n\n</body>\n</html>\n';
    default:
      return '';
  }
}
