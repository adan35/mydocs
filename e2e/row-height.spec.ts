import { expect, test, type Page } from '@playwright/test';
import { freshApp, newDocInRoot, setDoc } from './helpers';

const long =
  'Response Code: 00 Response Description: Approved statement_date: 2026-10-16, 2026-11-16 principal_amt=201.36, fc_amt=0.95, installment_amt=202.31 '.repeat(
    3,
  );
const table =
  '# Cases\n\n| # | Case | Expected |\n|---|---|---|\n' +
  [1, 2, 3].map((n) => `| ${n} | Verify case ${n} | ${long} |`).join('\n') +
  '\n';

const rowHeight = (page: Page, n: number) =>
  page
    .locator('.prose tbody tr')
    .nth(n)
    .evaluate((tr) => tr.getBoundingClientRect().height);

async function pick(page: Page, opener: ReturnType<Page['locator']>, name: RegExp) {
  await opener.click();
  await page.getByRole('menuitemradio', { name }).click();
}

test('tables start one line per row and switch to Normal, Medium and Full height', async ({
  page,
}) => {
  await freshApp(page);
  await newDocInRoot(page, 'Cases');
  await setDoc(page, table);
  await page.getByRole('button', { name: 'Read', exact: true }).click();

  const rows = page.locator('.table-rows-btn');
  await expect(rows).toHaveText('Rows: Default');
  const single = await rowHeight(page, 0);
  expect(single).toBeLessThan(45);
  // The whole cell text is still there, in the tooltip.
  await expect(page.locator('.prose tbody tr').first().locator('td').nth(2)).toHaveAttribute(
    'title',
    /installment_amt=202.31/,
  );

  await pick(page, rows, /^Normal/);
  const normal = await rowHeight(page, 0);
  expect(normal).toBeGreaterThan(single * 2);

  await pick(page, rows, /^Medium/);
  const medium = await rowHeight(page, 0);
  expect(medium).toBeGreaterThan(normal);

  await pick(page, rows, /^Full/);
  expect(await rowHeight(page, 0)).toBeGreaterThan(medium);

  // Clicking a row opens just that row in full; the choice is remembered.
  await pick(page, rows, /^Default/);
  await page.locator('.prose tbody tr').nth(1).locator('td').nth(2).click();
  expect(await rowHeight(page, 1)).toBeGreaterThan(single * 3);
  expect(await rowHeight(page, 0)).toBeLessThan(45);
  await page.reload();
  await expect(page.locator('.table-rows-btn')).toHaveText('Rows: Default');
});

test('the sheet view uses the same row height', async ({ page }) => {
  await freshApp(page);
  await newDocInRoot(page, 'Cases');
  await setDoc(page, table);
  await page.getByRole('button', { name: 'Sheet', exact: true }).click();
  const cell = page.locator('[data-cell="C2"]');
  await expect(cell).toBeVisible();
  const single = await cell.evaluate((el) => el.getBoundingClientRect().height);
  expect(single).toBe(28);
  await pick(page, page.getByTestId('row-height'), /^Medium/);
  await expect(page.getByTestId('row-height')).toContainText('Medium');
  expect(await cell.evaluate((el) => el.getBoundingClientRect().height)).toBe(6 * 18 + 10);
  await pick(page, page.getByTestId('row-height'), /^Full/);
  const full = await cell.evaluate((el) => el.getBoundingClientRect().height);
  expect(full).toBeGreaterThan(6 * 18 + 10);
  // Every line of the cell fits inside it.
  const fits = await cell.evaluate((el) => {
    const span = el.querySelector('span')!;
    return span.scrollHeight <= el.clientHeight;
  });
  expect(fits).toBe(true);
});
