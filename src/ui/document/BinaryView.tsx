import { useEffect, useState } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import type { Entry } from '@/domain/types';
import { fileTypeOf, formatBytes, mimeOf, mediaKindOf, extensionOf } from '@/domain/names';
import { bytePreview, PREVIEW_BYTES } from '@/lib/byte-preview';
import { officeText, OFFICE_TEXT_EXTENSIONS } from '@/lib/office-text';
import { ws } from '@/app/app-store';
import { exportEntry } from '@/app/actions';
import { FileIcon } from '../components/FileIcon';
import { useTree } from '../hooks';

/** Files My Doc can't edit as text: shown honestly, with a preview where safe. */
export function BinaryView({ entry }: { entry: Entry }) {
  const tree = useTree()!;
  const type = fileTypeOf(entry.name);
  const media = mediaKindOf(entry.name);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [bytes, setBytes] = useState('');
  const [documentText, setDocumentText] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState('');

  useEffect(() => {
    let u: string | null = null;
    let cancelled = false;
    setFailed(false);
    setPlaybackFailed(false);
    setUrl(null);
    setBytes('');
    setDocumentText([]);
    setPreviewError('');
    void ws()
      .readBlob(entry.id)
      .then(async (blob) => {
        if (cancelled) return;
        if (!blob) return setFailed(true);
        const typed = new Blob([blob], {
          type:
            entry.mime && entry.mime !== 'application/octet-stream'
              ? entry.mime
              : mimeOf(entry.name),
        });
        u = URL.createObjectURL(typed);
        setUrl(u);
        const sample = new Uint8Array(await blob.slice(0, PREVIEW_BYTES).arrayBuffer());
        if (!cancelled) setBytes(bytePreview(sample));
        if (OFFICE_TEXT_EXTENSIONS.has(extensionOf(entry.name))) {
          try {
            if (blob.size > 20 * 1024 * 1024)
              throw new Error('Text preview is limited to files up to 20 MB.');
            const paragraphs = officeText(new Uint8Array(await blob.arrayBuffer()), entry.name);
            if (!cancelled) setDocumentText(paragraphs);
          } catch (error) {
            if (!cancelled)
              setPreviewError(
                error instanceof Error ? error.message : 'Text preview could not be loaded.',
              );
          }
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (u) URL.revokeObjectURL(u);
    };
  }, [entry.id, entry.updatedAt, entry.mime, entry.name]);

  const rows: [string, string][] = [
    ['Type', entry.mime || mimeOf(entry.name)],
    ['Size', formatBytes(entry.size)],
    ['Location', tree.dirOf(entry.id) || 'Workspace root'],
    ['Modified', new Date(entry.updatedAt).toLocaleString()],
    ['Created', new Date(entry.createdAt).toLocaleString()],
  ];

  return (
    <div className="scroll-area h-full">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 py-10">
        {media && url && !playbackFailed ? (
          media === 'audio' ? (
            <audio
              key={url}
              controls
              preload="metadata"
              src={url}
              aria-label={`Play ${entry.name}`}
              onError={() => setPlaybackFailed(true)}
              className="w-full"
            />
          ) : (
            <video
              key={url}
              controls
              playsInline
              preload="metadata"
              src={url}
              aria-label={`Play ${entry.name}`}
              onError={() => setPlaybackFailed(true)}
              className="max-h-[60vh] w-full rounded-lg bg-black"
            />
          )
        ) : type === 'image' && url && !failed ? (
          <img
            src={url}
            alt={entry.name}
            className="max-h-[60vh] max-w-full rounded-lg border border-hairline object-contain"
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="flex size-20 items-center justify-center rounded-xl bg-surface text-steel">
            <FileIcon entry={entry} size={36} />
          </div>
        )}
        <div className="text-center">
          <h2 className="text-[18px] font-semibold break-all text-ink">{entry.name}</h2>
          <p className="mt-1 text-caption text-steel">
            {failed
              ? 'The contents of this file could not be read.'
              : playbackFailed
                ? 'This media format or codec cannot be played on this device. You can inspect its bytes or download the original.'
                : media
                  ? 'Playback uses the formats and codecs available on this device.'
                  : type === 'image'
                    ? 'Images can be embedded in documents with ![alt](path).'
                    : 'A byte preview is available below. Download preserves the original file.'}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void exportEntry(entry.id, 'file')}
          >
            <Download size={15} aria-hidden /> Download
          </button>
          {url && (type === 'pdf' || type === 'image') && (
            <a className="btn btn-secondary" href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={15} aria-hidden /> Open in new tab
            </a>
          )}
        </div>
        <dl className="card grid w-full max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2 p-5 text-[14px]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-steel">{k}</dt>
              <dd className="min-w-0 break-all text-charcoal">{v}</dd>
            </div>
          ))}
        </dl>
        {!!documentText.length && (
          <section
            aria-label="Document text preview"
            className="card w-full space-y-3 p-5 text-charcoal"
          >
            <h3 className="font-semibold text-ink">Text preview</h3>
            <p className="text-caption text-steel">
              Text content only. Original layout, images, animations and formatting are not shown.
            </p>
            {documentText.map((paragraph, i) => (
              <p key={i} className="whitespace-pre-wrap break-words">
                {paragraph}
              </p>
            ))}
          </section>
        )}
        {previewError && (
          <p role="status" className="text-caption text-steel">
            {previewError} The original file and byte preview are still available.
          </p>
        )}
        {(type !== 'image' || failed) && (
          <details className="card w-full p-4" open={!media || playbackFailed}>
            <summary className="cursor-pointer text-[14px] font-medium text-ink">
              Byte preview · first {PREVIEW_BYTES} bytes
            </summary>
            <pre
              aria-label="File byte preview"
              className="mt-3 overflow-x-auto text-xs text-charcoal"
            >
              {bytes || (entry.size === 0 ? 'Empty file' : 'Loading…')}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
