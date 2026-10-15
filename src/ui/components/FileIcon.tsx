import {
  File,
  FileCode2,
  FileImage,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  FileType2,
  Sheet,
  type LucideProps,
} from 'lucide-react';
import type { Entry } from '@/domain/types';
import { extensionOf, fileTypeOf } from '@/domain/names';

export function FileIcon({
  entry,
  open,
  ...props
}: { entry: Pick<Entry, 'kind' | 'name'>; open?: boolean } & LucideProps) {
  const p = { size: 16, strokeWidth: 1.75, 'aria-hidden': true, ...props };
  if (entry.kind === 'folder') return open ? <FolderOpen {...p} /> : <Folder {...p} />;
  const type = fileTypeOf(entry.name);
  const ext = extensionOf(entry.name);
  if (type === 'markdown') return <FileText {...p} />;
  if (type === 'image') return <FileImage {...p} />;
  if (type === 'pdf') return <FileType2 {...p} />;
  if (ext === 'json') return <FileJson {...p} />;
  if (ext === 'csv' || ext === 'tsv' || ext === 'unl') return <Sheet {...p} />;
  if (type === 'code' || type === 'data') return <FileCode2 {...p} />;
  if (type === 'text') return <FileText {...p} />;
  return <File {...p} />;
}
