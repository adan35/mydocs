import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { freshApp, mod, withoutFileSystemAccess } from './helpers';

test.beforeEach(({ page }) => withoutFileSystemAccess(page));

const SHOTS = process.env.SHOTS_DIR;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`) });
}

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
  await expect(page.getByText(/Imported 1 file/).last()).toBeVisible();
  await page.getByRole('treeitem', { name: 'sales.xlsx' }).click();
  await expect(page.getByTestId('sheet-grid')).toBeVisible();
}

const grid = (page: Page) => page.getByTestId('sheet-grid');
const head = (page: Page, letter: string) =>
  grid(page).getByRole('columnheader', { name: new RegExp(`^${letter} Resize`) });
const cell = (page: Page, a: string) => grid(page).locator(`[data-cell="${a}"]`);
const header = async (page: Page) => {
  const out: string[] = [];
  for (const l of 'ABCDEFG') out.push((await cell(page, `${l}1`).textContent()) ?? '');
  return out;
};

test.describe('Moving columns in an Excel sheet', () => {
  test.beforeEach(({ page }) => openSales(page));

  test('drag a selected column header, with a drop line, formulas, and undo', async ({ page }) => {
    await head(page, 'C').click(); // select Qty
    const from = (await head(page, 'C').boundingBox())!;
    const to = (await head(page, 'A').boundingBox())!;
    await page.mouse.move(from.x + 30, from.y + 10);
    await page.mouse.down();
    await page.mouse.move(to.x + 20, to.y + 10, { steps: 8 });
    await expect(page.getByTestId('column-drop-indicator')).toBeVisible();
    await shot(page, 'drag');
    await page.mouse.up();
    await expect(page.getByTestId('column-drop-indicator')).toBeHidden();
    expect(await header(page)).toEqual(['Qty', 'SKU', 'Item', 'Price', 'Total', 'Shipped', 'Date']);
    // The Total formula still multiplies Qty by Price, and the result is unchanged.
    await cell(page, 'E2').click();
    await expect(page.getByTestId('formula-bar')).toHaveValue('=A2*D2');
    await expect(cell(page, 'E2')).toHaveText('4.5');
    // Undo puts it back.
    await page.keyboard.press(`${mod}+z`);
    expect(await header(page)).toEqual(['SKU', 'Item', 'Qty', 'Price', 'Total', 'Shipped', 'Date']);
    await expect(cell(page, 'E2')).toHaveText('4.5');
  });

  test('Alt+Shift+arrows, the toolbar and the header menu move the selected columns', async ({
    page,
  }) => {
    await head(page, 'B').click();
    await page.keyboard.press('Alt+Shift+ArrowRight');
    expect((await header(page)).slice(0, 3)).toEqual(['SKU', 'Qty', 'Item']);
    await page.getByRole('button', { name: 'Move column left' }).click();
    expect((await header(page)).slice(0, 3)).toEqual(['SKU', 'Item', 'Qty']);

    // Several columns at once, from the right-click menu.
    await head(page, 'B').click();
    await head(page, 'C').click({ modifiers: ['Shift'] });
    await head(page, 'C').click({ button: 'right' });
    await shot(page, 'menu');
    await page.getByRole('menuitem', { name: 'Move columns to the end' }).click();
    expect(await header(page)).toEqual(['SKU', 'Price', 'Total', 'Shipped', 'Date', 'Item', 'Qty']);
    // The first column can't go further left.
    await head(page, 'A').click();
    await page.keyboard.press('Alt+Shift+ArrowLeft');
    expect((await header(page))[0]).toBe('SKU');
  });
});
