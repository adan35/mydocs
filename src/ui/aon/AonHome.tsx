import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { aiSource } from '@/app/ai';
import { makeBrief, savedBrief, type Brief } from '@/app/aon/brief';
import { openCapture, openTidy } from '@/app/aon/dialog';
import { toggleAon } from '@/app/aon/chat';
import { renderMarkdown } from '@/lib/markdown/render';

/** Home's AON section: today's brief plus the ways to hand AON some work. */
export default function AonHome() {
  const [brief, setBrief] = useState<Brief | null>(() => savedBrief());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const noKey = ['none', 'sign-in'].includes(aiSource());
  useEffect(() => () => abort.current?.abort(), []);
  const html = useMemo(() => (brief ? renderMarkdown(brief.text).html : ''), [brief]);

  const run = async () => {
    setBusy(true);
    setError('');
    abort.current = new AbortController();
    try {
      setBrief(await makeBrief(abort.current.signal));
    } catch (e) {
      if (!abort.current.signal.aborted)
        setError(e instanceof Error ? e.message : 'AON could not write the brief.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="AON" className="mb-8">
      <h2 className="section-label mb-2 flex items-center gap-1.5">
        <Sparkles size={12} aria-hidden /> AON
      </h2>
      <div className="card flex flex-col gap-3 p-4">
        {brief ? (
          <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <p className="text-steel">
            {noKey
              ? 'Add an API key or a local model in Settings to let AON write your daily brief, file captures and tidy your workspace.'
              : 'Get a short brief of what is due, what is open and what changed lately.'}
          </p>
        )}
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy || noKey}
            onClick={() => void run()}
          >
            {busy ? 'Writing…' : brief ? 'Refresh brief' : 'Get my brief'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => openCapture()}>
            Capture
          </button>
          <button type="button" className="btn btn-secondary" onClick={openTidy}>
            Tidy up
          </button>
          <button type="button" className="btn btn-secondary" onClick={toggleAon}>
            Ask AON
          </button>
        </div>
      </div>
    </section>
  );
}
