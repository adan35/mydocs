import { create } from 'zustand';
import { api, cloudAvailable, refreshAccount, useAccount } from './cloud';
import { prefs } from './prefs';

export type AiProvider = 'anthropic' | 'openai';

export const AI_PROVIDERS: Record<AiProvider, { label: string; model: string }> = {
  anthropic: { label: 'Anthropic (Claude)', model: 'claude-haiku-5-5' },
  openai: { label: 'OpenAI', model: 'gpt-4o-mini' },
};

export interface AiSettings {
  provider: AiProvider;
  /** Empty uses the provider's default model. */
  model: string;
  /** The user's own API key. It stays on this device and is only ever sent to the provider. */
  key: string;
}

export interface AiRequest {
  system?: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens?: number;
}

const KEY = 'mydoc:ai';

export const useAiSettings = create<AiSettings & { update(p: Partial<AiSettings>): void }>(
  (set, get) => ({
    provider: 'anthropic',
    model: '',
    key: '',
    ...prefs.get<Partial<AiSettings>>(KEY, {}),
    update(p) {
      set(p);
      const { provider, model, key } = get();
      prefs.set(KEY, { provider, model, key });
    },
  }),
);

export class AiError extends Error {}

/** Where a request would be paid for, for showing the user. */
export function aiSource(): 'own-key' | 'default-key' | 'sign-in' | 'none' {
  if (useAiSettings.getState().key.trim()) return 'own-key';
  if (!cloudAvailable) return 'none';
  const { user, ai } = useAccount.getState();
  if (!user) return 'sign-in';
  return ai?.defaultKey ? 'default-key' : 'none';
}

/**
 * Runs one AI request: with the user's own key straight to their provider, otherwise
 * through the owner's default key (signed-in users, limited tokens per month).
 */
export async function complete(
  req: AiRequest,
): Promise<{ text: string; via: 'own-key' | 'default-key' }> {
  const { provider, model, key } = useAiSettings.getState();
  const maxTokens = Math.min(4096, Math.max(1, req.maxTokens ?? 1024));
  if (key.trim()) {
    const m = model.trim() || AI_PROVIDERS[provider].model;
    const call = () =>
      provider === 'anthropic'
        ? fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': key.trim(),
              'anthropic-version': '2023-06-01',
              // Required by Anthropic for calls made from a browser with the user's own key.
              'anthropic-dangerous-direct-browser-access': 'true',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model: m,
              max_tokens: maxTokens,
              ...(req.system ? { system: req.system } : {}),
              messages: req.messages,
            }),
          })
        : fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { authorization: `Bearer ${key.trim()}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              model: m,
              max_completion_tokens: maxTokens,
              messages: [
                ...(req.system ? [{ role: 'system', content: req.system }] : []),
                ...req.messages,
              ],
            }),
          });
    let res: Response;
    try {
      res = await call();
    } catch {
      throw new AiError('Could not reach the AI provider. Check your connection.');
    }
    const data = (await res.json().catch(() => null)) as {
      error?: { message?: string };
      content?: { text?: string }[];
      choices?: { message?: { content?: string } }[];
    } | null;
    if (!res.ok)
      throw new AiError(
        data?.error?.message ?? `The AI provider returned an error (${res.status}).`,
      );
    const text =
      provider === 'anthropic'
        ? (data?.content ?? []).map((c) => c.text ?? '').join('')
        : (data?.choices?.[0]?.message?.content ?? '');
    return { text, via: 'own-key' };
  }
  if (aiSource() !== 'default-key') {
    throw new AiError(
      aiSource() === 'sign-in'
        ? 'Sign in with Google to use the free allowance, or add your own API key in Settings.'
        : 'Add your own API key in Settings to use AI.',
    );
  }
  try {
    const r = await api<{ text: string }>('/api/ai', { body: { ...req, maxTokens } });
    return { text: r.text, via: 'default-key' };
  } finally {
    void refreshAccount();
  }
}
