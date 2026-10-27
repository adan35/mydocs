import { create } from 'zustand';
import { api, cloudAvailable, refreshAccount, useAccount } from './cloud';
import { prefs } from './prefs';

export type AiProvider = 'anthropic' | 'openai' | 'local';

export const AI_PROVIDERS: Record<AiProvider, { label: string; model: string }> = {
  anthropic: { label: 'Anthropic (Claude)', model: 'claude-haiku-5-5' },
  openai: { label: 'OpenAI', model: 'gpt-4o-mini' },
  local: { label: 'Private: a model on this computer', model: '' },
};

/** Ollama's address. Any server that speaks the OpenAI chat format works (LM Studio, llama.cpp). */
export const DEFAULT_LOCAL_URL = 'http://localhost:11434/v1';

export interface AiSettings {
  provider: AiProvider;
  /** Empty uses the provider's default model. */
  model: string;
  /** The user's own API key. It stays on this device and is only ever sent to the provider. */
  key: string;
  /** Private mode: where the model server runs. Nothing is sent anywhere else. */
  baseUrl: string;
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
    baseUrl: DEFAULT_LOCAL_URL,
    ...prefs.get<Partial<AiSettings>>(KEY, {}),
    update(p) {
      set(p);
      const { provider, model, key, baseUrl } = get();
      prefs.set(KEY, { provider, model, key, baseUrl });
    },
  }),
);

export class AiError extends Error {}

export interface AiOptions {
  signal?: AbortSignal;
  /** Gets the text as it arrives. The shared key returns the whole text at once. */
  onText?(chunk: string): void;
}

/** Reads a provider's server-sent events and passes each piece of text on. */
async function readStream(
  res: Response,
  provider: AiProvider,
  onText: (chunk: string) => void,
): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let buffer = '';
  let all = '';
  const handle = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let ev: {
      type?: string;
      delta?: { text?: string };
      choices?: { delta?: { content?: string } }[];
      error?: { message?: string };
    };
    try {
      ev = JSON.parse(data);
    } catch {
      return;
    }
    if (ev.error) throw new AiError(ev.error.message ?? 'The AI provider returned an error.');
    const chunk =
      provider === 'anthropic'
        ? ev.type === 'content_block_delta'
          ? (ev.delta?.text ?? '')
          : ''
        : (ev.choices?.[0]?.delta?.content ?? '');
    if (chunk) {
      all += chunk;
      onText(chunk);
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    lines.forEach(handle);
  }
  handle(buffer);
  return all;
}

/**
 * Reasoning models print their thinking between <think> tags; it is not part of the answer.
 * Works on text that arrives in pieces: push each piece, then call end().
 */
export function thinkFilter() {
  let hidden = false;
  let held = '';
  return {
    push(chunk: string): string {
      let s = held + chunk;
      held = '';
      let out = '';
      for (;;) {
        const tag = hidden ? '</think>' : '<think>';
        const i = s.indexOf(tag);
        if (i >= 0) {
          if (!hidden) out += s.slice(0, i);
          s = s.slice(i + tag.length);
          hidden = !hidden;
          continue;
        }
        // The end of this piece may be the start of a tag that the next piece finishes.
        let k = Math.min(tag.length - 1, s.length);
        while (k > 0 && !tag.startsWith(s.slice(s.length - k))) k--;
        if (!hidden) out += s.slice(0, s.length - k);
        held = s.slice(s.length - k);
        return out;
      }
    },
    end: () => (hidden ? '' : held),
  };
}

const localUrl = (base: string) => base.trim().replace(/\/+$/, '') || DEFAULT_LOCAL_URL;

/** Where a request would be paid for, for showing the user. */
export function aiSource(): 'local' | 'own-key' | 'default-key' | 'sign-in' | 'none' {
  const { provider, model } = useAiSettings.getState();
  // Private mode never falls back to a key or the shared allowance.
  if (provider === 'local') return model.trim() ? 'local' : 'none';
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
  opts: AiOptions = {},
): Promise<{ text: string; via: 'local' | 'own-key' | 'default-key' }> {
  const { provider, model, key, baseUrl } = useAiSettings.getState();
  const maxTokens = Math.min(4096, Math.max(1, req.maxTokens ?? 1024));
  const local = provider === 'local';
  if (local && !model.trim())
    throw new AiError('Choose the model your local server should use in Settings.');
  if (local || key.trim()) {
    const m = model.trim() || AI_PROVIDERS[provider].model;
    const stream = !!opts.onText;
    const call = () =>
      provider === 'anthropic'
        ? fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            signal: opts.signal,
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
              ...(stream ? { stream } : {}),
              ...(req.system ? { system: req.system } : {}),
              messages: req.messages,
            }),
          })
        : fetch(
            local
              ? `${localUrl(baseUrl)}/chat/completions`
              : 'https://api.openai.com/v1/chat/completions',
            {
              method: 'POST',
              signal: opts.signal,
              // A local server needs no key, and the key saved for a cloud provider is never sent to it.
              headers: {
                ...(local ? {} : { authorization: `Bearer ${key.trim()}` }),
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                model: m,
                ...(local ? { max_tokens: maxTokens } : { max_completion_tokens: maxTokens }),
                ...(stream ? { stream } : {}),
                messages: [
                  ...(req.system ? [{ role: 'system', content: req.system }] : []),
                  ...req.messages,
                ],
              }),
            },
          );
    let res: Response;
    try {
      res = await call();
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      throw new AiError(
        local
          ? `Could not reach the model server at ${localUrl(baseUrl)}. Is it running, and does it allow this site? (Ollama: set OLLAMA_ORIGINS.)`
          : 'Could not reach the AI provider. Check your connection.',
      );
    }
    const via = local ? 'local' : 'own-key';
    if (stream && res.ok) {
      if (!local) return { text: await readStream(res, provider, opts.onText!), via };
      const think = thinkFilter();
      let text = '';
      const show = (t: string) => {
        if (!t) return;
        text += t;
        opts.onText!(t);
      };
      await readStream(res, provider, (c) => show(think.push(c)));
      show(think.end());
      return { text: text.trimStart(), via };
    }
    const data = (await res.json().catch(() => null)) as {
      error?: { message?: string } | string;
      content?: { text?: string }[];
      choices?: { message?: { content?: string } }[];
    } | null;
    if (!res.ok)
      throw new AiError(
        (typeof data?.error === 'string' ? data.error : data?.error?.message) ??
          `The AI provider returned an error (${res.status}).`,
      );
    const text =
      provider === 'anthropic'
        ? (data?.content ?? []).map((c) => c.text ?? '').join('')
        : (data?.choices?.[0]?.message?.content ?? '');
    if (!local) return { text, via };
    const think = thinkFilter();
    return { text: (think.push(text) + think.end()).trimStart(), via };
  }
  if (aiSource() !== 'default-key') {
    throw new AiError(
      aiSource() === 'sign-in'
        ? 'Sign in with Google to use the free allowance, or add your own API key in Settings.'
        : 'Add your own API key in Settings to use AI.',
    );
  }
  try {
    const r = await api<{ text: string }>('/api/ai', {
      body: { ...req, maxTokens },
      signal: opts.signal,
    });
    opts.onText?.(r.text);
    return { text: r.text, via: 'default-key' };
  } finally {
    void refreshAccount();
  }
}
