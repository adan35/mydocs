import { test, expect } from '@playwright/test';
import { freshApp, mod, mode } from './helpers';

const selected = (page: import('@playwright/test').Page) =>
  page.evaluate(() => getSelection()?.toString() ?? '');

test('Ctrl+A in the Read view selects only the document, not the sidebar', async ({ page }) => {
  await freshApp(page);
  await mode(page, 'Read');
  const article = page.locator('[data-testid="preview-pane"] article.prose');
  await article.locator('p').first().click(); // focus lands on plain text, not an input
  await page.keyboard.press(`${mod}+a`);
  const text = await selected(page);
  const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
  expect(norm(text)).toContain(norm(await article.evaluate((el) => (el as HTMLElement).innerText)));
  expect(text).not.toContain('Templates');
});

test('Ctrl+A in the sidebar selects the sidebar only', async ({ page }) => {
  await freshApp(page);
  await page.getByRole('navigation', { name: 'Workspace' }).getByText('Tags').click();
  await page.getByRole('navigation', { name: 'Workspace' }).getByText('Templates').hover();
  await page.keyboard.press(`${mod}+a`);
  const text = await selected(page);
  expect(text).toContain('Templates');
  expect(text).not.toContain('Welcome to My Doc');
});

test('Alt+T (and Ctrl+T where the browser allows it) opens templates; the AI prompt template works', async ({
  page,
}) => {
  await freshApp(page);
  await expect(page.getByRole('button', { name: /^Templates/ }).locator('kbd')).toHaveText(
    process.platform === 'darwin' ? '⌥T' : 'Alt+T',
  );
  for (const key of [`${mod}+t`, 'Alt+t']) {
    await page.keyboard.press(key);
    await expect(page.getByRole('dialog', { name: 'New from template' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  }
  await page.keyboard.press('Alt+t');
  await page.getByRole('dialog', { name: 'New from template' }).getByText('AI prompt').click();
  await expect(page.getByRole('tab', { name: /Prompt/ })).toBeVisible();
  const editor = page.locator('.cm-content');
  await expect(editor).toContainText('</quality_check>'); // the editor opens at the end
  await expect(editor).toContainText('Best-practice checklist');
});

test('Ctrl+/ opens a searchable list of every shortcut', async ({ page }) => {
  await freshApp(page);
  await expect(page.getByRole('button', { name: /^Shortcuts/ })).toBeVisible();
  await page.keyboard.press(`${mod}+/`);
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('searchbox', { name: 'Search shortcuts' }).fill('next file');
  await expect(dialog.getByText('Open the next / previous file in Files')).toBeVisible();
  await expect(dialog.getByText('Bold')).toBeHidden();
});

test('Ctrl+Alt+Up/Down open the previous/next file in Files', async ({ page }) => {
  await freshApp(page);
  await page.getByRole('treeitem', { name: 'Guides' }).click();
  await page.getByRole('heading', { name: 'Welcome to My Doc' }).first().click();
  const current = (name: string) =>
    page.getByRole('tab', { name: new RegExp(name), selected: true });
  await page.keyboard.press('Control+Alt+ArrowUp');
  await expect(current('Markdown guide')).toBeVisible();
  await page.keyboard.press('Control+Alt+ArrowUp');
  await expect(current('Keyboard shortcuts')).toBeVisible();
  await page.keyboard.press('Control+Alt+ArrowDown');
  await expect(current('Markdown guide')).toBeVisible();
  await page.keyboard.press('Control+Alt+ArrowDown');
  await expect(current('Welcome to My Doc')).toBeVisible();
});
