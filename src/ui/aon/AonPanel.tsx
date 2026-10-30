import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, FileText, Square, Trash2, X } from 'lucide-react';
import { aiSource } from '@/app/ai';
import { openEntry } from '@/app/actions';
import {
  askAon,
  openAonFile,
  stopAon,
  undoCreated,
  useAon,
  type ChatMessage,
} from '@/app/aon/chat';
import { navigate } from '@/app/router';
import { renderMarkdown } from '@/lib/markdown/render';
import { useLayout } from '../hooks';
import { Hudhud } from './Hudhud';
import { MicButton } from './MicButton';
import { useHudhud } from './useHudhud';

const MOOD: Record<string, string> = {
  listening: 'Listening…',
  thinking: 'Thinking…',
  searching: 'Searching your documents…',
  success: 'Done',
  sleeping: 'Resting. Ask me anything.',
};

const IDEAS = [
  'What is due this week?',
  'Find my notes about …',
  'Remind me tomorrow at 9:00 to …',
  'Summarize what I changed recently',
];

function Answer({ m }: { m: ChatMessage }) {
  const html = useMemo(() => (m.text ? renderMarkdown(m.text).html : ''), [m.text]);
  return (
    <div className="flex flex-col gap-1.5">
      {m.steps.length > 0 && (
        <ul className="text-caption text-steel" aria-label="What AON did">
          {m.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
      {m.text &&
        (m.error ? (
          <p className="text-danger">{m.text}</p>
        ) : (
          <div className="prose prose-compact" dangerouslySetInnerHTML={{ __html: html }} />
        ))}
      {m.sources.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Documents AON read">
          {m.sources.map((s) => (
            <button
              key={s.id}
              type="button"
              className="btn btn-secondary h-7 max-w-full gap-1 px-2 text-caption"
              onClick={() => void openEntry(s.id)}
              title={s.path}
            >
              <FileText size={13} aria-hidden />
              <span className="truncate">{s.path}</span>
            </button>
          ))}
        </div>
      )}
      {m.created.length > 0 && (
        <div>
          <button
            type="button"
            className="btn btn-secondary h-7 px-2 text-caption"
            onClick={() => void undoCreated(m.id)}
          >
            Undo: move to Trash
          </button>
        </div>
      )}
    </div>
  );
}

export function AonPanel() {
  const { phone, desktop } = useLayout();
  const { messages, busy } = useAon();
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const source = aiSource();
  const setup = source === 'none' || source === 'sign-in';
  const mood = useHudhud(draft.trim() !== '');

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages]);

  const send = (text = draft) => {
    if (!text.trim() || busy) return;
    setDraft('');
    void askAon(text);
  };

  return (
    <aside
      aria-label="AON"
      data-testid="aon-panel"
      className={`flex min-h-0 flex-col bg-canvas no-print ${
        desktop
          ? 'h-full w-[380px] shrink-0 border-l border-hairline'
          : 'fixed inset-y-0 right-0 z-[45] shadow-3'
      }`}
      style={desktop ? undefined : { width: phone ? '100vw' : 'min(420px, 100vw)' }}
      onKeyDown={(e) => e.key === 'Escape' && useAon.getState().setOpen(false)}
    >
      <header className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <Hudhud state={mood} size={32} />
        <h2 className="text-[15px] font-semibold text-ink">AON</h2>
        <span className="flex-1 truncate text-caption text-steel" data-testid="hudhud-mood">
          {MOOD[mood] ?? ''}
        </span>
        {messages.length > 0 && (
          <button
            type="button"
            className="icon-btn"
            aria-label="Clear conversation"
            title="Clear conversation"
            onClick={() => useAon.getState().clear()}
          >
            <Trash2 size={15} />
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          aria-label="Close AON"
          onClick={() => useAon.getState().setOpen(false)}
        >
          <X size={16} />
        </button>
      </header>
      <div
        ref={log}
        role="log"
        aria-live="polite"
        aria-label="Conversation with AON"
        className="scroll-area flex min-h-0 flex-1 flex-col gap-4 p-3"
      >
        {setup && (
          <div className="rounded-lg border border-hairline bg-surface p-3 text-caption text-steel">
            {source === 'sign-in'
              ? 'Sign in with Google to use the free allowance, or add your own API key.'
              : 'AON needs an API key or a local model.'}{' '}
            <button
              type="button"
              className="font-medium text-primary underline"
              onClick={() => navigate({ name: 'settings' })}
            >
              Open settings
            </button>
          </div>
        )}
        {messages.length === 0 && (
          <div className="flex flex-col gap-3 text-steel">
            <div className="flex items-end gap-3">
              <Hudhud state={mood} size={88} />
              <p className="pb-1 text-caption">
                I&rsquo;m <span className="font-semibold text-ink">Hudhud</span>, your AON
                assistant.
              </p>
            </div>
            <p className="text-ink">
              Ask me to find something, answer from your notes, or set a reminder. I read only the
              documents I need for each question.
            </p>
            <div className="flex flex-col gap-1.5">
              {IDEAS.map((idea) => (
                <button
                  key={idea}
                  type="button"
                  className="rounded-md border border-hairline px-3 py-1.5 text-left text-caption text-charcoal hover:bg-hover"
                  onClick={() =>
                    idea.includes('…')
                      ? (setDraft(idea.replace('…', '')), input.current?.focus())
                      : send(idea)
                  }
                >
                  {idea}
                </button>
              ))}
            </div>
            <p className="text-caption">
              In any document, type <code>@aon</code> and a request, then press Enter.{' '}
              <button
                type="button"
                className="text-primary underline"
                onClick={() => void openAonFile()}
              >
                Edit what AON remembers
              </button>
            </p>
          </div>
        )}
        {messages.map((m) =>
          m.role === 'user' ? (
            <p
              key={m.id}
              className="max-w-[90%] self-end whitespace-pre-wrap rounded-lg bg-active px-3 py-2 text-ink"
            >
              {m.text}
            </p>
          ) : (
            <Answer key={m.id} m={m} />
          ),
        )}
        {busy && messages[messages.length - 1]?.text === '' && (
          <p className="text-caption text-steel">Working…</p>
        )}
      </div>
      <form
        className="flex items-end gap-2 border-t border-hairline p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          ref={input}
          className="input min-h-[40px] flex-1 resize-none py-2"
          rows={2}
          aria-label="Message AON"
          placeholder="Ask AON…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <MicButton
          className="icon-btn mb-1"
          onText={(t) => setDraft((d) => (d && !/\s$/.test(d) ? `${d} ${t}` : d + t))}
        />
        {busy ? (
          <button type="button" className="btn btn-secondary" aria-label="Stop" onClick={stopAon}>
            <Square size={14} />
          </button>
        ) : (
          <button
            type="submit"
            className="btn btn-primary"
            aria-label="Send"
            disabled={!draft.trim()}
          >
            <ArrowUp size={16} />
          </button>
        )}
      </form>
      {source === 'local' && (
        <p className="px-3 pb-3 text-caption text-steel" data-testid="aon-private-note">
          Private mode: answers come from the model on your computer and nothing is sent to the
          internet. Small models can be slower and less careful.
        </p>
      )}
    </aside>
  );
}
