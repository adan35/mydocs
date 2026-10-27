import { prefs } from './prefs';
import { toast } from './toast-store';

/** The parts of the browser's speech recognition that we use (it is not in the DOM typings). */
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type Ctor = new () => Recognition;

const ctor = (): Ctor | undefined => {
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

/** Browsers differ: Chrome and Safari have it, Firefox does not. */
export const voiceSupported = () => typeof window !== 'undefined' && !!ctor();

const NOTICE = 'mydoc:voice-notice';

const ERRORS: Record<string, string> = {
  'not-allowed': 'The microphone is blocked. Allow it for this site in your browser settings.',
  'service-not-allowed': 'Voice typing is turned off in this browser.',
  network: 'Voice typing needs a connection in this browser.',
  'audio-capture': 'No microphone was found.',
};

/**
 * Turns speech into text with the browser's own recognizer, then calls onText with each
 * finished phrase. Returns a function that stops it. Some browsers send the audio to
 * their vendor's servers, so the first use says so.
 */
export function startVoice(h: { onText(t: string): void; onEnd(): void }): () => void {
  const Rec = ctor();
  if (!Rec) {
    h.onEnd();
    return () => {};
  }
  if (!prefs.get<boolean>(NOTICE, false)) {
    prefs.set(NOTICE, true);
    toast({
      message:
        "Voice typing uses your browser's speech service. Some browsers send the audio to their maker.",
    });
  }
  const rec = new Rec();
  rec.lang = document.documentElement.lang || navigator.language || 'en-US';
  rec.continuous = true;
  rec.interimResults = false;
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!;
      if (r.isFinal && r[0]) h.onText(r[0].transcript.trim());
    }
  };
  rec.onerror = (e) => {
    if (e.error !== 'no-speech' && e.error !== 'aborted')
      toast({ message: ERRORS[e.error] ?? 'Voice typing stopped.' });
  };
  rec.onend = h.onEnd;
  try {
    rec.start();
  } catch {
    h.onEnd();
  }
  return () => rec.stop();
}
