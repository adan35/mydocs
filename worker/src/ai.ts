import type { Env } from './env';

export interface AiRequest {
  system?: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens: number;
}
export interface AiResult {
  text: string;
  input: number;
  output: number;
}

export const MAX_INPUT_CHARS = 60_000;
export const MAX_OUTPUT_TOKENS = 4096;

/** Rough upper bound on the input tokens, used to reserve quota before the call. */
export const estimateInput = (r: AiRequest) =>
  Math.ceil((r.messages.reduce((n, m) => n + m.content.length, 0) + (r.system?.length ?? 0)) / 3);

/** Validates the untrusted request body. Returns null when it is malformed or too large. */
export function parseAiRequest(b: unknown): AiRequest | null {
  if (!b || typeof b !== 'object') return null;
  const { system, messages, maxTokens } = b as Record<string, unknown>;
  if (!Array.isArray(messages) || !messages.length || messages.length > 100) return null;
  const clean: AiRequest['messages'] = [];
  let chars = typeof system === 'string' ? system.length : 0;
  for (const m of messages) {
    const { role, content } = (m ?? {}) as Record<string, unknown>;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null;
    chars += content.length;
    clean.push({ role, content });
  }
  if (chars > MAX_INPUT_CHARS) return null;
  const max = Math.min(MAX_OUTPUT_TOKENS, Math.max(1, Math.floor(Number(maxTokens) || 1024)));
  return {
    system: typeof system === 'string' ? system : undefined,
    messages: clean,
    maxTokens: max,
  };
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Calls the owner's provider with the default key. */
export async function callProvider(env: Env, r: AiRequest): Promise<AiResult> {
  const provider = env.AI_PROVIDER === 'openai' ? 'openai' : 'anthropic';
  const model = env.AI_MODEL || (provider === 'openai' ? 'gpt-4o-mini' : 'claude-haiku-5-5');
  const res =
    provider === 'anthropic'
      ? await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': env.AI_API_KEY!,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model,
            max_tokens: r.maxTokens,
            ...(r.system ? { system: r.system } : {}),
            messages: r.messages,
          }),
        })
      : await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${env.AI_API_KEY}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model,
            max_completion_tokens: r.maxTokens,
            messages: [...(r.system ? [{ role: 'system', content: r.system }] : []), ...r.messages],
          }),
        });
  if (!res.ok) {
    // Provider error bodies can echo request details; the caller gets a generic message.
    throw new ProviderError(
      'The AI provider rejected the request.',
      res.status === 429 ? 429 : 502,
    );
  }
  const d = (await res.json()) as {
    content?: { text?: string }[];
    choices?: { message?: { content?: string } }[];
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      prompt_tokens?: number;
      completion_tokens?: number;
    };
  };
  return provider === 'anthropic'
    ? {
        text: (d.content ?? []).map((c: { text?: string }) => c.text ?? '').join(''),
        input: d.usage?.input_tokens ?? 0,
        output: d.usage?.output_tokens ?? 0,
      }
    : {
        text: d.choices?.[0]?.message?.content ?? '',
        input: d.usage?.prompt_tokens ?? 0,
        output: d.usage?.completion_tokens ?? 0,
      };
}
