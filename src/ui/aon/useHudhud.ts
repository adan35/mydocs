import { useEffect, useState } from 'react';
import { useAon } from '@/app/aon/chat';
import { SLEEP_MS, SUCCESS_MS, hudhudState, type HudhudState } from '@/app/aon/hudhud';

/** Hudhud's pose for the AON chat: follows requests, and dozes off when nothing happens. */
export function useHudhud(typing = false): HudhudState {
  const busy = useAon((s) => s.busy);
  const last = useAon((s) => s.messages[s.messages.length - 1]);
  const [justDone, setJustDone] = useState(false);
  const [inactive, setInactive] = useState(false);
  const usingTool = !!last && last.role === 'assistant' && last.steps.length > 0 && !last.text;

  useEffect(() => {
    if (busy) return;
    // The request ended: celebrate an answer, not a stop or an error.
    const l = useAon.getState().messages.at(-1);
    if (!l || l.role !== 'assistant' || l.error || !l.text || l.text === 'Stopped.') return;
    setJustDone(true);
    const t = setTimeout(() => setJustDone(false), SUCCESS_MS);
    return () => clearTimeout(t);
  }, [busy]);

  useEffect(() => {
    setInactive(false);
    const t = setTimeout(() => setInactive(true), SLEEP_MS);
    return () => clearTimeout(t);
  }, [busy, typing, last?.id]);

  return hudhudState({ busy, usingTool, typing, justDone, inactive });
}
