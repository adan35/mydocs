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

test('Ctrl+T and Alt+T open the template picker; the sidebar shows the hint', async ({ page }) => {
  await freshApp(page);
  await expect(page.getByRole('button', { name: /^Templates/ }).locator('kbd')).toHaveText(
    process.platform === 'darwin' ? '⌘T' : 'Ctrl+T',
  );
  for (const key of [`${mod}+t`, 'Alt+t']) {
    await page.keyboard.press(key);
    await expect(page.getByRole('dialog', { name: 'New from template' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  }
});
