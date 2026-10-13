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

/** Starts both panes at the top (a freshly typed document opens scrolled to the cursor). */
async function scrollToTop(page: Page) {
  await page.locator('.cm-scroller').hover();
  await page.mouse.wheel(0, -100000);
  await expect.poll(() => topHeading(page, 'source')).toBe(1);
  await expect.poll(() => topHeading(page, 'preview')).toBe(1);
}

const SIZES = [
  { name: 'desktop', width: 1400, height: 900 },
  { name: 'tablet', width: 900, height: 1000 },
  { name: 'phone', width: 390, height: 844 },
];

for (const size of SIZES) {
  test(`split view keeps both panes on the same section in either direction (${size.name})`, async ({
    page,
  }) => {
    await runSplitSync(page, size);
  });
}

async function runSplitSync(page: Page, size: { width: number; height: number; name: string }) {
  // Set up on a roomy screen (phones hide the sidebar buttons), then shrink.
  await page.setViewportSize({ width: 1400, height: 900 });
  await freshApp(page);
  await newDocInRoot(page, 'Long');
  await setDoc(page, sections);
  await waitSaved(page);
  await page.setViewportSize({ width: size.width, height: size.height });
  await mode(page, 'Split');
  await expect(page.locator('[data-testid="preview-pane"] h2').first()).toBeVisible();

  await scrollToTop(page);
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
}

test('split view stays aligned past tables and images (phone)', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await freshApp(page);
  await newDocInRoot(page, 'Rich');
  const png =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#7b61ff"/></svg>',
    );
  const doc = Array.from({ length: 20 }, (_, i) => {
    const n = i + 1;
    return `## Section ${n}\n\n![pic](${png})\n\n| a | b | c |\n| - | - | - |\n${'| 1 | 2 | 3 |\n'.repeat(6)}\nText for section ${n}.\n`;
  }).join('\n');
  await setDoc(page, doc);
  await waitSaved(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await mode(page, 'Split');
  await expect(page.locator('[data-testid="preview-pane"] h2').first()).toBeVisible();
  // Both panes are visible at once, one above the other.
  const src = await page.locator('.cm-scroller').boundingBox();
  const pre = await page.locator('[data-testid="preview-pane"]').boundingBox();
  expect(src!.y + src!.height).toBeLessThanOrEqual(pre!.y + 2);

  await scrollToTop(page);
  await page.locator('.cm-scroller').hover();
  await page.mouse.wheel(0, 1800);
  await expect.poll(() => topHeading(page, 'source')).toBeGreaterThan(3);
  await expect
    .poll(async () =>
      Math.abs((await topHeading(page, 'source')) - (await topHeading(page, 'preview'))),
    )
    .toBeLessThanOrEqual(1);
});
