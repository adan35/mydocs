import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { freshApp, withoutFileSystemAccess } from './helpers';

test.beforeEach(({ page }) => withoutFileSystemAccess(page));

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function openSales(page: Page) {
  await freshApp(page);
  await page.getByRole('button', { name: 'Import' }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Files…' }).click();
  await (
    await chooser
  ).setFiles({
    name: 'sales.xlsx',
    mimeType: XLSX,
    buffer: readFileSync(resolve(process.cwd(), 'fixtures', 'sales.xlsx')),
  });
  await page.getByRole('treeitem', { name: 'sales.xlsx' }).click();
  await expect(page.getByTestId('sheet-grid')).toBeVisible();
}

const grid = (page: Page) => page.getByTestId('sheet-grid');

test('filter the columns you choose in a workbook: values, conditions, clear', async ({ page }) => {
  await openSales(page);

  // The funnel is on the column header; pick the values to keep.
  await grid(page).getByRole('columnheader', { name: /^F\b/ }).hover();
  await page.getByRole('button', { name: 'Filter column F' }).click();
  const panel = page.getByTestId('column-filter');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('filter-values')).toContainText('TRUE');
  await panel.getByRole('checkbox', { name: /FALSE/ }).uncheck();
  await panel.getByRole('checkbox', { name: /\(empty\)/ }).uncheck();
  await panel.getByRole('button', { name: 'Apply' }).click();

  // Header stays; only the shipped rows show, still numbered as in the file.
  await expect(grid(page).locator('[data-cell="A1"]')).toHaveText('SKU');
  await expect(grid(page).locator('[data-cell="B2"]')).toHaveText('Pen');
  await expect(grid(page).locator('[data-cell="B3"]')).toHaveText('Lamp');
  await expect(grid(page).locator('[data-cell="B4"]')).toHaveCount(0);
  await expect(grid(page).locator('[data-row-header="3"]')).toHaveText('4');
  await expect(page.getByTestId('filter-bar')).toContainText('2 of 7 rows');
  await expect(page.getByTestId('filter-chip')).toContainText('F · Shipped');

  // A second column narrows further: a condition on Qty.
  await page.getByRole('button', { name: 'Filter column C' }).click();
  await page
    .getByLabel('Filter condition')
    .selectOption({ label: 'Rows where the cell is greater than' });
  await page.getByLabel('Filter value').fill('1');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(grid(page).locator('[data-cell="B2"]')).toHaveText('Pen');
  await expect(grid(page).locator('[data-cell="B3"]')).toHaveCount(0);
  await expect(page.getByTestId('filter-bar')).toContainText('1 of 7 rows');

  // Rows can't be inserted into a view that hides some.
  await grid(page).locator('[data-cell="B2"]').click();
  await page.getByRole('button', { name: 'Insert row below' }).click();
  await expect(page.getByText(/Clear the filters first/).last()).toBeVisible();

  // Removing one chip leaves the other.
  await page.getByRole('button', { name: /Remove filter on C/ }).click();
  await expect(grid(page).locator('[data-cell="B3"]')).toHaveText('Lamp');

  // The toolbar toggle turns the filters off.
  await page.getByRole('button', { name: 'Filter columns' }).click();
  await expect(page.getByTestId('filter-bar')).toBeHidden();
  await expect(grid(page).locator('[data-cell="B3"]')).toHaveText('Cup');
});

test('a column header menu and Alt+Down open the filter', async ({ page }) => {
  await openSales(page);
  await grid(page).getByRole('columnheader', { name: /^B\b/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Filter this column/ }).click();
  await expect(page.getByTestId('column-filter')).toBeVisible();
  await page.getByLabel('Search values').fill('la');
  await expect(page.getByTestId('filter-values').getByRole('checkbox')).toHaveCount(2); // select all + Lamp
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('column-filter')).toBeHidden();

  await grid(page).locator('[data-cell="C2"]').click();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.getByTestId('column-filter')).toContainText('Filter C');
});
