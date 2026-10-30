import { expect, test, type Page } from '@playwright/test';
import { mockProvider } from './aon-mock';
import { freshApp, mod, setDoc } from './helpers';

/** Holds the model's answer back, so the in-flight poses can be seen. */
async function slowly(page: Page, ms: number) {
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.fallback();
  });
}

const bird = (page: Page) => page.getByTestId('aon-panel').getByTestId('hudhud').first();

test('Hudhud follows what AON is doing in the chat', async ({ page }) => {
  await mockProvider(page, (_b, n) =>
    n === 1 ? 'TOOL: {"tool":"search","args":{"query":"welcome"}}' : 'Found it.',
  );
  await slowly(page, 700);
  await freshApp(page);
  await page.keyboard.press(`${mod}+j`);
  const panel = page.getByTestId('aon-panel');
  await expect(bird(page)).toHaveAttribute('data-state', 'idle');

  await panel.getByRole('textbox', { name: 'Message AON' }).fill('where is the welcome guide');
  await expect(bird(page)).toHaveAttribute('data-state', 'listening');
  await panel.getByRole('button', { name: 'Send' }).click();
  await expect(bird(page)).toHaveAttribute('data-state', 'thinking');
  await expect(panel.locator('.hudhud-dots')).toBeVisible();
  await expect(panel.getByTestId('hudhud-mood')).toHaveText('Thinking…');
  await expect(bird(page)).toHaveAttribute('data-state', 'searching');
  await expect(panel).toContainText('Found it.');
  await expect(bird(page)).toHaveAttribute('data-state', 'success');
  await expect(bird(page)).toHaveAttribute('data-state', 'idle', { timeout: 6000 });
});

test('a small Hudhud shows while the panel is closed, and opens it', async ({ page }) => {
  await mockProvider(page, () => 'All done.');
  await slowly(page, 700);
  await freshApp(page);
  await page.keyboard.press(`${mod}+j`);
  const panel = page.getByTestId('aon-panel');
  await panel.getByRole('textbox', { name: 'Message AON' }).fill('hello');
  await panel.getByRole('button', { name: 'Send' }).click();
  await page.keyboard.press(`${mod}+j`);
  await expect(panel).toBeHidden();
  const float = page.getByTestId('hudhud-float');
  await expect(float).toBeVisible();
  await expect(float).toHaveAccessibleName(/thinking/);
  await expect(float).toHaveAccessibleName(/answer/);
  await float.click();
  await expect(panel).toContainText('All done.');
  await expect(float).toBeHidden();
});

test('the empty chat introduces Hudhud, and motion stops when reduced', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await freshApp(page);
  await page.keyboard.press(`${mod}+j`);
  const panel = page.getByTestId('aon-panel');
  await expect(panel).toContainText('I’m Hudhud');
  const img = panel.locator('.hudhud > img').last();
  await expect(img).toBeVisible();
  expect(await img.evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
  // The pose is decorative: no extra name for screen readers.
  await expect(panel.getByTestId('hudhud').first()).toHaveAttribute('aria-hidden', 'true');
});

test('the inline suggestion shows Hudhud while it writes', async ({ page }) => {
  await mockProvider(page, () => 'three');
  await slowly(page, 600);
  await freshApp(page);
  await page
    .getByRole('button', { name: 'New document', exact: true })
    .first()
    .click({ modifiers: ['Shift'] });
  await setDoc(page, '@aon count');
  await page.keyboard.press('Enter');
  const box = page.getByRole('region', { name: 'AON suggestion' });
  await expect(box.locator('.hudhud')).toHaveAttribute('data-state', 'thinking');
  await expect(box.locator('.hudhud')).toHaveAttribute('data-state', 'success');
});

test('Settings can hide AON and Hudhud everywhere', async ({ page }) => {
  const calls = await mockProvider(page, () => 'x');
  await freshApp(page);
  await expect(page.getByRole('button', { name: /Ask AON/ })).toBeVisible();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('region', { name: 'AON' })).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('switch', { name: 'Show AON' }).click();
  await expect(page.getByRole('button', { name: /Ask AON/ })).toHaveCount(0);
  await page.keyboard.press(`${mod}+j`);
  await expect(page.getByTestId('aon-panel')).toHaveCount(0);
  await page.keyboard.press(`${mod}+k`);
  await page.getByRole('combobox', { name: 'Command palette' }).fill('AON');
  await expect(page.getByRole('option', { name: /AON/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('region', { name: 'AON' })).toHaveCount(0);

  // In a document, @aon is ordinary text and Enter is an ordinary new line.
  await page
    .getByRole('button', { name: 'New document', exact: true })
    .first()
    .click({ modifiers: ['Shift'] });
  await setDoc(page, '@aon hello');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'AON suggestion' })).toHaveCount(0);
  expect(calls).toHaveLength(0);

  // Still off after a reload; switching it back on brings everything back.
  await page.reload();
  await expect(page.getByRole('button', { name: /Ask AON/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('switch', { name: 'Show AON' }).click();
  await expect(page.getByRole('button', { name: /Ask AON/ })).toBeVisible();
});
