import { expect, test, type Page } from '@playwright/test';
import { freshApp, mod, setDoc, sourceText, waitSaved } from './helpers';

interface Body {
  stream?: boolean;
  system?: string;
  messages: { role: string; content: string }[];
}

/** Answers Anthropic calls like a model would, streaming when the app asks for a stream. */
async function mockProvider(page: Page, reply: (body: Body, n: number) => string) {
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

test('@aon + Enter writes a suggestion that is only saved when accepted', async ({ page }) => {
  const calls = await mockProvider(page, () => '- apples\n- pears\n- plums');
  await freshApp(page);
  await page.getByRole('button', { name: 'New document', exact: true }).first().click();
  await setDoc(page, 'Shopping\n');
  await page.keyboard.type('@aon add three fruits');
  await page.keyboard.press('Enter');

  const box = page.getByRole('region', { name: 'AON suggestion' });
  await expect(box).toContainText('- plums');
  // Nothing is written until it is accepted.
  expect(await sourceText(page)).toContain('@aon add three fruits');
  expect(calls[0]!.stream).toBe(true);
  expect(calls[0]!.messages[0]!.content).toContain('⟦AON⟧');
  expect(calls[0]!.messages[0]!.content).toContain('add three fruits');

  await box.getByRole('button', { name: 'Accept' }).click();
  await expect(box).toBeHidden();
  expect(await sourceText(page)).toBe('Shopping\n- apples\n- pears\n- plums');

  // Undo brings the request back, like any other edit.
  await page.keyboard.press(`${mod}+z`);
  expect(await sourceText(page)).toContain('@aon add three fruits');
});

test('Escape discards a suggestion and leaves the text alone', async ({ page }) => {
  await mockProvider(page, () => 'Something else');
  await freshApp(page);
  await page.getByRole('button', { name: 'New document', exact: true }).first().click();
  await setDoc(page, '@aon rewrite this');
  await page.keyboard.press('Enter');
  const box = page.getByRole('region', { name: 'AON suggestion' });
  await expect(box.getByRole('button', { name: 'Accept' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(box).toBeHidden();
  expect(await sourceText(page)).toBe('@aon rewrite this');
});

test('a plain Enter and an escaped \\@aon stay ordinary text', async ({ page }) => {
  const calls = await mockProvider(page, () => 'x');
  await freshApp(page);
  await page.getByRole('button', { name: 'New document', exact: true }).first().click();
  await setDoc(page, '\\@aon is just text');
  await page.keyboard.press('Enter');
  await page.keyboard.type('second line');
  expect(await sourceText(page)).toBe('\\@aon is just text\nsecond line');
  expect(calls).toHaveLength(0);
});

test('the ribbon rewrites the selection with a preview', async ({ page }) => {
  const calls = await mockProvider(page, () => 'Short.');
  await freshApp(page);
  await page.getByRole('button', { name: 'New document', exact: true }).first().click();
  await setDoc(page, 'This is a very long and rambling sentence.');
  await page.keyboard.press(`${mod}+a`);
  await page.getByRole('button', { name: 'Write or rewrite with AON' }).click();
  await page.getByRole('menuitem', { name: 'Make shorter' }).click();
  const box = page.getByRole('region', { name: 'AON suggestion' });
  await expect(box).toContainText('Short.');
  expect(calls[0]!.messages[0]!.content).toContain('<selection>');
  await box.getByRole('button', { name: 'Accept' }).click();
  expect(await sourceText(page)).toBe('Short.');
});

test('without a key the suggestion points to Settings', async ({ page }) => {
  await freshApp(page);
  await page.getByRole('button', { name: 'New document', exact: true }).first().click();
  await setDoc(page, '@aon hello');
  await page.keyboard.press('Enter');
  const box = page.getByRole('region', { name: 'AON suggestion' });
  await expect(box).toContainText('API key');
  await expect(box.getByRole('button', { name: 'Open settings' })).toBeVisible();
});

test('chat finds documents, creates a reminder note, and can undo it', async ({ page }) => {
  const calls = await mockProvider(page, (body, n) => {
    if (n === 1) return 'TOOL: {"tool":"search","args":{"query":"welcome"}}';
    if (n === 2)
      return 'TOOL: {"tool":"create_note","args":{"title":"Call the plumber","reminder":"2099-01-01T09:00","labels":["home"]}}';
    return 'Done. I found the welcome guide and made a reminder.';
  });
  await freshApp(page);
  await page.keyboard.press(`${mod}+j`);
  const panel = page.getByTestId('aon-panel');
  await expect(panel).toBeVisible();
  await panel
    .getByRole('textbox', { name: 'Message AON' })
    .fill('Find the welcome guide and remind me to call the plumber');
  await panel.getByRole('button', { name: 'Send' }).click();

  await expect(panel).toContainText('Done. I found the welcome guide');
  await expect(panel).toContainText('Searched for “welcome”');
  await expect(panel).toContainText('Created note');
  // The search result went back to the model as data.
  expect(calls[1]!.messages.at(-1)!.content).toMatch(/^<tool_result name="search">/);
  expect(calls[1]!.messages.at(-1)!.content).toMatch(/Welcome/i);
  expect(calls[0]!.system).toContain('TOOL:');

  await page
    .getByRole('link', { name: 'Notes' })
    .or(page.getByRole('button', { name: 'Notes' }))
    .first()
    .click();
  await expect(page.getByTestId('note-card').filter({ hasText: 'Call the plumber' })).toBeVisible();

  await panel.getByRole('button', { name: 'Undo: move to Trash' }).click();
  await expect(page.getByTestId('note-card').filter({ hasText: 'Call the plumber' })).toBeHidden();
});

test('standing instructions in AON.md reach the model', async ({ page }) => {
  const calls = await mockProvider(page, () => 'ok');
  await freshApp(page);
  await page.keyboard.press(`${mod}+k`);
  await page.getByRole('combobox').fill('AON.md');
  await page.getByRole('option', { name: /Edit what AON remembers/ }).click();
  await expect(page.locator('.cm-content')).toContainText('How AON should help me');
  await setDoc(page, 'Always answer in Spanish.');
  await waitSaved(page);
  await page.keyboard.press(`${mod}+j`);
  const panel = page.getByTestId('aon-panel');
  await panel.getByRole('textbox', { name: 'Message AON' }).fill('hello');
  await panel.getByRole('button', { name: 'Send' }).click();
  await expect(panel).toContainText('ok');
  expect(calls[0]!.system).toContain('Always answer in Spanish.');
});

test('the sidebar opens AON, which points to Settings when there is no key', async ({ page }) => {
  await freshApp(page);
  await page.getByRole('button', { name: /Ask AON/ }).click();
  const panel = page.getByTestId('aon-panel');
  await expect(panel).toContainText('AON needs an API key');
  await panel.getByRole('button', { name: 'Close AON' }).click();
  await expect(panel).toBeHidden();
});
