import type { Page } from '@playwright/test';

export interface Body {
  stream?: boolean;
  system?: string;
  messages: { role: string; content: string }[];
}

/** Answers Anthropic calls like a model would, streaming when the app asks for a stream. */
export async function mockProvider(page: Page, reply: (body: Body, n: number) => string) {
  const calls: Body[] = [];
  await page.addInitScript(() =>
    localStorage.setItem(
      'mydoc:ai',
      JSON.stringify({ provider: 'anthropic', model: '', key: 'sk-test' }),
    ),
  );
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    const body = route.request().postDataJSON() as Body;
    calls.push(body);
    const text = reply(body, calls.length);
    if (!body.stream) {
      return route.fulfill({ json: { content: [{ type: 'text', text }] } });
    }
    const half = Math.ceil(text.length / 2);
    const ev = (t: string) =>
      `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } })}\n\n`;
    await route.fulfill({
      contentType: 'text/event-stream',
      body: ev(text.slice(0, half)) + ev(text.slice(half)) + 'data: {"type":"message_stop"}\n\n',
    });
  });
  return calls;
}
