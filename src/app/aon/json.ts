import { complete, type AiRequest } from '../ai';

/** The first JSON object in a model reply, which may carry prose or a code fence around it. */
export function extractJson(text: string): unknown {
  const open = text.search(/[{[]/);
  if (open < 0) return null;
  const close = text.lastIndexOf(text[open] === '{' ? '}' : ']');
  if (close < open) return null;
  try {
    return JSON.parse(text.slice(open, close + 1));
  } catch {
    return null;
  }
}

/** Asks for a JSON answer. Null when the reply holds none, so callers show one clear message. */
export async function askJson(req: AiRequest, signal?: AbortSignal): Promise<unknown> {
  const { text } = await complete(req, { signal });
  return extractJson(text);
}

export const asString = (v: unknown, max = 400): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';
