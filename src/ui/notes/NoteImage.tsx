import { useEffect, useState } from 'react';
import { useNoteImage } from '@/app/notes';

/** A note picture: a workspace path (`href`) or a file picked but not saved yet (`file`). */
export function NoteImage({
  href,
  file,
  className,
}: {
  href?: string;
  file?: File;
  className?: string;
}) {
  const stored = useNoteImage(href ?? '');
  const [local, setLocal] = useState<string>();
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setLocal(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const src = file ? local : stored;
  return src ? (
    <img src={src} alt="" loading="lazy" className={className} />
  ) : (
    <div className={`${className ?? ''} min-h-16 bg-[var(--hover)]`} aria-hidden />
  );
}
