import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { mockProvider } from './aon-mock';
import { freshApp, mod, mode, newDocInRoot, setDoc, sourceText } from './helpers';

async function importBuffer(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.getByRole('button', { name: 'Import' }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Files…' }).click();
  await (await chooser).setFiles({ name, mimeType, buffer });
  await expect(page.getByText(/Imported 1 file/).last()).toBeVisible();
  await page.getByRole('treeitem', { name }).click();
}

async function ask(page: Page, request: string) {
  await page.getByTestId('sheet-ask-aon').click();
  const dialog = page.getByRole('dialog', { name: 'Ask AON about this sheet' });
  await dialog.getByLabel('What should AON do?').fill(request);
  await dialog.getByRole('button', { name: 'Ask', exact: true }).click();
  return dialog;
}

test('the sheet helper proposes cells for a Markdown table, applies them in one step and undoes', async ({
  page,
}) => {
  const calls = await mockProvider(page, () =>
    JSON.stringify({
      answer: 'Added totals.',
      edits: [
        { cell: 'D1', value: 'Total' },
        { cell: 'D2', value: '=B2*C2' },
        { cell: 'D3', value: '=B3*C3' },
      ],
    }),
  );
  await freshApp(page);
  await newDocInRoot(page, 'Stock');
  await setDoc(
    page,
    '| Item | Qty | Price |\n| --- | --- | --- |\n| Tap | 2 | 5 |\n| Pipe | 3 | 4 |\n',
  );
  await mode(page, 'Sheet');
  const dialog = await ask(page, 'Add a total column');
  await expect(dialog.getByTestId('sheet-ask-result')).toContainText('Added totals.');
  // The model saw the headers and the rows, nothing else of the app.
  const sent = calls[0]!.messages[0]!.content;
  expect(sent).toContain('Columns: A, B, C');
  expect(sent).toContain('2\tTap\t2\t5');
  expect(sent).toContain('Add a total column');
  await dialog.getByRole('button', { name: 'Apply 3 changes' }).click();
  const grid = page.getByTestId('sheet-grid');
  await expect(grid.locator('[data-cell="D2"]')).toHaveText('10');
  await expect(grid.locator('[data-cell="D3"]')).toHaveText('12');
  await mode(page, 'Source');
  const text = await sourceText(page);
  expect(text).toContain('Total');
  expect(text).toContain('=B2*C2');

  await mode(page, 'Sheet');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(grid.locator('[data-cell="D2"]')).toHaveText('');
});

test('a CSV file only gets values: a proposed formula is left out and says so', async ({
  page,
}) => {
  const calls = await mockProvider(page, () =>
    JSON.stringify({
      answer: 'Sized the items.',
      edits: [
        { cell: 'C1', value: 'size' },
        { cell: 'C2', value: '=B2*2' },
        { cell: 'C3', value: 'big' },
      ],
    }),
  );
  await freshApp(page);
  await importBuffer(page, 'stock.csv', 'text/csv', Buffer.from('name,qty\nPen,3\nCup,2\n'));
  const dialog = await ask(page, 'Add a size column');
  expect(calls[0]!.messages[0]!.content).toContain('values only');
  await expect(dialog.getByText('1 proposed change was left out')).toBeVisible();
  await dialog.getByRole('button', { name: 'Apply 2 changes' }).click();
  const grid = page.getByTestId('sheet-grid');
  await expect(grid.locator('[data-cell="C3"]')).toHaveText('big');
  await expect(grid.locator('[data-cell="C2"]')).toHaveText('');
});

test('the sheet helper works on an Excel workbook, keeping formulas as formulas', async ({
  page,
}) => {
  const calls = await mockProvider(page, () =>
    JSON.stringify({
      answer: 'Added a status column.',
      edits: [
        { cell: 'H1', value: 'Status' },
        { cell: 'H2', value: 'Shipped' },
      ],
    }),
  );
  await freshApp(page);
  await importBuffer(
    page,
    'sales.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    readFileSync(resolve(process.cwd(), 'fixtures', 'sales.xlsx')),
  );
  const dialog = await ask(page, 'Add a status column');
  const sent = calls[0]!.messages[0]!.content;
  expect(sent).toContain('Sheet "Sales 2026"');
  expect(sent).toContain('=C2*D2');
  await dialog.getByRole('button', { name: 'Apply 2 changes' }).click();
  const grid = page.getByTestId('sheet-grid');
  await expect(grid.locator('[data-cell="H2"]')).toHaveText('Shipped');
  await expect(grid.locator('[data-cell="E2"]')).toHaveText('4.5');
});

test('private mode talks only to the local server and hides its thinking', async ({ page }) => {
  let cloud = 0;
  await page.route('https://api.anthropic.com/**', (r) => (cloud++, r.abort()));
  await page.route('https://api.openai.com/**', (r) => (cloud++, r.abort()));
  await page.addInitScript(() =>
    localStorage.setItem(
      'mydoc:ai',
      JSON.stringify({
        provider: 'local',
        model: 'llama3.2',
        key: 'sk-cloud-key',
        baseUrl: 'http://localhost:11434/v1',
      }),
    ),
  );
  const seen: { auth: string | undefined; body: { model: string; stream?: boolean } }[] = [];
  await page.route('http://localhost:11434/v1/chat/completions', async (route) => {
    const req = route.request();
    seen.push({ auth: req.headers()['authorization'], body: req.postDataJSON() });
    const ev = (t: string) =>
      `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;
    await route.fulfill({
      contentType: 'text/event-stream',
      body:
        ev('<think>the user says hi') +
        ev('</think>Hello from') +
        ev(' your laptop.') +
        'data: [DONE]\n\n',
    });
  });
  await freshApp(page);
  await page.keyboard.press(`${mod}+j`);
  const panel = page.getByTestId('aon-panel');
  await expect(panel.getByTestId('aon-private-note')).toContainText(
    'nothing is sent to the internet',
  );
  await panel.getByLabel('Message AON').fill('hi');
  await panel.getByRole('button', { name: 'Send' }).click();
  await expect(panel).toContainText('Hello from your laptop.');
  await expect(panel).not.toContainText('the user says hi');
  expect(seen[0]!.auth).toBeUndefined();
  expect(seen[0]!.body.model).toBe('llama3.2');
  expect(cloud).toBe(0);
});

test('Settings: choose a local model, test it, and the key box goes away', async ({ page }) => {
  await page.route('http://localhost:11434/v1/chat/completions', (route) =>
    route.fulfill({ json: { choices: [{ message: { content: 'ok' } }] } }),
  );
  await freshApp(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Provider').selectOption('local');
  await expect(page.getByLabel('API key')).toHaveCount(0);
  await expect(page.getByLabel('Server address')).toHaveValue('http://localhost:11434/v1');
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(page.getByText(/model your local server should use/)).toBeVisible();
  await page.getByLabel('Model', { exact: true }).fill('llama3.2');
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(page.getByText('The model answered.')).toBeVisible();
});

test('dictation fills the AON chat and a new note, and says where the audio may go', async ({
  page,
}) => {
  await page.addInitScript(() => {
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = '';
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        setTimeout(() => {
          const r = Object.assign([{ transcript: ' note that the plumber comes Tuesday ' }], {
            isFinal: true,
          });
          this.onresult?.({ resultIndex: 0, results: [r] });
        }, 30);
      }
      stop() {
        setTimeout(() => this.onend?.(), 0);
      }
    }
    for (const name of ['SpeechRecognition', 'webkitSpeechRecognition'])
      Object.defineProperty(window, name, { value: FakeRecognition, configurable: true });
  });
  await freshApp(page);
  await page.keyboard.press(`${mod}+j`);
  const panel = page.getByTestId('aon-panel');
  await panel.getByRole('button', { name: 'Dictate' }).click();
  await expect(panel.getByLabel('Message AON')).toHaveValue('note that the plumber comes Tuesday');
  await expect(page.getByText(/speech service/)).toBeVisible();
  await panel.getByRole('button', { name: 'Stop dictating' }).click();
  await expect(panel.getByRole('button', { name: 'Dictate' })).toBeVisible();
  await panel.getByRole('button', { name: 'Close AON' }).click();
  await expect(panel).toBeHidden();

  await page
    .getByRole('link', { name: 'Notes' })
    .or(page.getByRole('button', { name: 'Notes' }))
    .first()
    .click();
  await page.getByRole('button', { name: 'Take a note…' }).click();
  await page.getByRole('button', { name: 'Dictate' }).click();
  await expect(page.getByRole('textbox', { name: 'Note' })).toHaveValue(
    'note that the plumber comes Tuesday',
  );
});

test('no microphone button where the browser cannot recognize speech', async ({ page }) => {
  await page.addInitScript(() => {
    for (const name of ['SpeechRecognition', 'webkitSpeechRecognition'])
      Object.defineProperty(window, name, { value: undefined, configurable: true });
  });
  await freshApp(page);
  await page.keyboard.press(`${mod}+j`);
  await expect(page.getByTestId('aon-panel')).toBeVisible();
  await expect(page.getByTestId('mic')).toHaveCount(0);
});

test('the AON panel sits beside the document, inside the window, below the menu bar', async ({
  page,
}) => {
  await freshApp(page);
  await page.keyboard.press(`${mod}+j`);
  const panel = await page.getByTestId('aon-panel').boundingBox();
  const main = await page.locator('#main').boundingBox();
  const bar = await page
    .getByRole('menubar')
    .or(page.getByText('File', { exact: true }))
    .first()
    .boundingBox();
  const { width, height } = page.viewportSize()!;
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(width);
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(height);
  expect(panel!.x).toBeGreaterThanOrEqual(main!.x + main!.width - 1);
  expect(panel!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height - 1);
});
