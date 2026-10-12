import { expect, test } from '@playwright/test';
import { freshApp, mod } from './helpers';

const PAYLOAD = `# Hostile document

<script>window.__pwned = 1</script>
<img src=x onerror="window.__pwned = 2">
[click me](javascript:window.__pwned=3)
<iframe src="https://example.com"></iframe>
<svg><script>window.__pwned = 4</script></svg>
<div style="position:fixed;inset:0;background:red">overlay</div>
<a href="data:text/html,<script>alert(1)</script>">data link</a>
<details open ontoggle="window.__pwned = 5">x</details>
`;

test('malicious Markdown cannot run script or escape the preview', async ({ page }) => {
  let dialogs = 0;
  page.on('dialog', (d) => {
    dialogs++;
    void d.dismiss();
  });
  await freshApp(page);
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+A`);
  await page.keyboard.insertText(PAYLOAD);
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('.prose h1')).toHaveText(/Hostile document/);
  await page.locator('.prose').getByText('click me').click();
  await page.waitForTimeout(300);
  expect(
    await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
  ).toBeUndefined();
  expect(dialogs).toBe(0);
  await expect(
    page.locator('.prose script, .prose iframe, .prose [onerror], .prose [ontoggle]'),
  ).toHaveCount(0);
  const overlayPosition = await page
    .locator('.prose div', { hasText: 'overlay' })
    .first()
    .evaluate((el) => getComputedStyle(el).position);
  expect(overlayPosition).not.toBe('fixed');
});
