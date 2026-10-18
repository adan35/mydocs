/** Rules for entry names and file types. Names are untrusted input everywhere. */

export const MAX_NAME_LENGTH = 200;

// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[/\\\u0000-\u001f\u007f]/;

export type NameError = 'empty' | 'too-long' | 'invalid-chars' | 'reserved';

export function validateName(raw: string): NameError | null {
  const name = raw.trim();
  if (!name) return 'empty';
  if (name.length > MAX_NAME_LENGTH) return 'too-long';
  if (FORBIDDEN_CHARS.test(name)) return 'invalid-chars';
  if (name === '.' || name === '..') return 'reserved';
  return null;
}

export const NAME_ERROR_MESSAGES: Record<NameError, string> = {
  empty: 'Enter a name.',
  'too-long': `Names can be at most ${MAX_NAME_LENGTH} characters.`,
  'invalid-chars': 'Names cannot contain slashes or control characters.',
  reserved: 'This name is reserved.',
};

/** Turns an arbitrary string (e.g. an imported file name) into a valid name. */
export function sanitizeName(raw: string, fallback = 'Untitled'): string {
  // eslint-disable-next-line no-control-regex
  let name = raw.replace(/[/\\\u0000-\u001f\u007f]/g, '-').trim();
  if (name === '.' || name === '..') name = '';
  if (name.length > MAX_NAME_LENGTH) {
    const ext = extensionOf(name);
    const base = name.slice(0, MAX_NAME_LENGTH - ext.length - 1);
    name = ext ? `${base}.${ext}` : base;
  }
  return name || fallback;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function baseName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
}

export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function namesEqual(a: string, b: string): boolean {
  return compareNames(a, b) === 0;
}

/**
 * Returns `desired` if no sibling has that name, otherwise `name (2).ext`, `name (3).ext`...
 * Comparison is case-insensitive so exports never collide on case-insensitive filesystems.
 */
export function uniqueName(desired: string, siblingNames: Iterable<string>): string {
  const taken = new Set<string>();
  for (const n of siblingNames) taken.add(n.toLocaleLowerCase());
  if (!taken.has(desired.toLocaleLowerCase())) return desired;
  const ext = extensionOf(desired);
  const base = ext ? desired.slice(0, -(ext.length + 1)) : desired;
  const stem = base.replace(/ \(\d+\)$/, '');
  for (let i = 2; ; i++) {
    const candidate = ext ? `${stem} (${i}).${ext}` : `${stem} (${i})`;
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

export type FileType = 'markdown' | 'text' | 'code' | 'data' | 'image' | 'pdf' | 'binary';

const MARKDOWN = new Set(['md', 'markdown', 'mdx', 'mdown', 'mkd']);
const TEXT = new Set(['txt', 'log', 'text', '']);
const DATA = new Set(['json', 'yaml', 'yml', 'xml', 'csv', 'tsv', 'unl', 'toml', 'ini', 'env']);
const CODE = new Set([
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'tsx',
  'java',
  'py',
  'sql',
  'sh',
  'bash',
  'zsh',
  'go',
  'rs',
  'rb',
  'php',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'kt',
  'swift',
  'vue',
  'svelte',
  'lua',
  'r',
  'dart',
  'dockerfile',
  'gitignore',
  'graphql',
  'proto',
]);
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico']);

export function fileTypeOf(name: string): FileType {
  const ext = extensionOf(name);
  if (MARKDOWN.has(ext)) return 'markdown';
  if (IMAGE.has(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (DATA.has(ext)) return 'data';
  if (CODE.has(ext)) return 'code';
  if (TEXT.has(ext)) return 'text';
  return 'binary';
}

/** Whether a file of this name is opened in the text editor. */
export function isTextType(type: FileType): boolean {
  return type === 'markdown' || type === 'text' || type === 'code' || type === 'data';
}

export function isMarkdownName(name: string): boolean {
  return fileTypeOf(name) === 'markdown';
}

const MIME_BY_EXT: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  mdx: 'text/markdown',
  txt: 'text/plain',
  json: 'application/json',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  xml: 'application/xml',
  csv: 'text/csv',
  unl: 'text/plain',
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  ts: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  pdf: 'application/pdf',
  zip: 'application/zip',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export function mimeOf(name: string): string {
  return MIME_BY_EXT[extensionOf(name)] ?? 'application/octet-stream';
}

export function mediaKindOf(name: string): 'audio' | 'video' | null {
  const mime = mimeOf(name);
  return mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
