import { useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { useAiSettings } from '@/app/ai';
import { startVoice, voiceSupported } from '@/app/voice';

/**
 * Dictation into a text box: tap to start, tap to stop. Hidden where the browser has no
 * speech recognition, and in private mode, because browsers may send audio to their maker.
 */
export function MicButton({
  onText,
  className = 'icon-btn',
}: {
  /** Gets each finished phrase. */
  onText(text: string): void;
  className?: string;
}) {
  const priv = useAiSettings((s) => s.provider === 'local');
  const [on, setOn] = useState(false);
  const stop = useRef<(() => void) | null>(null);
  const latest = useRef(onText);
  latest.current = onText;
  useEffect(() => () => stop.current?.(), []);
  if (priv || !voiceSupported()) return null;

  return (
    <button
      type="button"
      className={`${className} ${on ? 'text-danger' : ''}`}
      aria-label={on ? 'Stop dictating' : 'Dictate'}
      aria-pressed={on}
      title={on ? 'Stop dictating' : 'Dictate with your voice'}
      data-testid="mic"
      onClick={() => {
        if (on) return void stop.current?.();
        setOn(true);
        stop.current = startVoice({
          onText: (t) => t && latest.current(t),
          onEnd: () => {
            stop.current = null;
            setOn(false);
          },
        });
      }}
    >
      <Mic size={16} />
    </button>
  );
}
