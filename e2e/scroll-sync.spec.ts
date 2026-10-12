import { test, expect, type Page } from '@playwright/test';
import { freshApp, mode, newDocInRoot, setDoc, waitSaved } from './helpers';

const sections = Array.from(
  { length: 40 },
  (_, i) =>
    `## Section ${i + 1}\n\n${'A long paragraph that wraps across several lines in the preview pane. '.repeat(i % 3 === 0 ? 6 : 2)}\n`,
).join('\n');

/** The heading closest to the top of a scroll container. */
async function topHeading(page: Page, pane: 'source' | 'preview'): Promise<number> {
  return page.evaluate((pane) => {
    if (pane === 'preview') {
      const box = document.querySelector('[data-testid="preview-pane"]')!;
      const top = box.getBoundingClientRect().top;
      const hs = [...box.querySelectorAll('h2')];
      const h = hs.find((h) => h.getBoundingClientRect().bottom > top + 4) ?? hs[0]!;
      return Number(h.textContent!.match(/\d+/)![0]);
    }
    const scroller = document.querySelector('.cm-scroller')!;
    const top = scroller.getBoundingClientRect().top;
    const lines = [...document.querySelectorAll('.cm-line')].filter((l) =>
      /^## Section/.test(l.textContent ?? ''),
    );
    const l = lines.find((l) => l.getBoundingClientRect().bottom > top + 4) ?? lines[0]!;
    return Number(l.textContent!.match(/\d+/)![0]);
  }, pane);
}

test('split view keeps both panes on the same section in either direction', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await freshApp(page);
  await newDocInRoot(page, 'Long');
  await setDoc(page, sections);
  await waitSaved(page);
  await mode(page, 'Split');
  await expect(page.locator('[data-testid="preview-pane"] h2').first()).toBeVisible();

  // Scrolling the source moves the preview.
  await page.locator('.cm-scroller').hover();
  await page.mouse.wheel(0, 2500);
  // The wheel has to land first, or "aligned" is just both panes still at the top.
  await expect.poll(() => topHeading(page, 'source')).toBeGreaterThan(5);
  await expect
    .poll(async () =>
      Math.abs((await topHeading(page, 'source')) - (await topHeading(page, 'preview'))),
    )
    .toBeLessThanOrEqual(1);
  const afterSource = await topHeading(page, 'preview');
  expect(afterSource).toBeGreaterThan(5);

  // Scrolling the preview moves the source back, without bouncing.
  await page.locator('[data-testid="preview-pane"]').hover();
  await page.mouse.wheel(0, -1200);
  await expect.poll(() => topHeading(page, 'preview')).toBeLessThan(afterSource);
  await expect
    .poll(async () =>
      Math.abs((await topHeading(page, 'source')) - (await topHeading(page, 'preview'))),
    )
    .toBeLessThanOrEqual(1);
  expect(await topHeading(page, 'preview')).toBeLessThan(afterSource);

  // Turning sync off leaves the other pane where it is.
  await page.getByRole('button', { name: 'Sync scrolling' }).click();
  const before = await topHeading(page, 'preview');
  await page.locator('.cm-scroller').hover();
  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(400);
  expect(await topHeading(page, 'preview')).toBe(before);
});
