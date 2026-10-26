import { expect, test } from '@playwright/test';
import { freshApp, mod, mode, newDocInRoot, setDoc, sourceText, waitSaved } from './helpers';

test('Markdown tables calculate formulas, select ranges, fill, filter and write back to the file', async ({
  page,
}) => {
  await freshApp(page);
  await newDocInRoot(page, 'Budget');
  await setDoc(
    page,
    '# Budget\n\n| Item | Cost |\n| --- | --- |\n| Rent | 1200 |\n| Food | $300 |\n| Total |  |\n',
  );
  await waitSaved(page);
  await mode(page, 'Sheet');
  const grid = page.getByTestId('sheet-grid');
  const bar = page.getByTestId('formula-bar');

  // A formula is typed like in Excel, calculated for display and kept as text in the file.
  await grid.locator('[data-cell="B4"]').click();
  await page.keyboard.type('=SUM(B2:B3)');
  await page.keyboard.press('Enter');
  await expect(grid.locator('[data-cell="B4"]')).toHaveText('1500');
  await grid.locator('[data-cell="B4"]').click();
  await expect(bar).toHaveValue('=SUM(B2:B3)');
  await grid.locator('[data-cell="B2"]').click();
  await page.keyboard.type('1000');
  await page.keyboard.press('Enter');
  await expect(grid.locator('[data-cell="B4"]')).toHaveText('1300');

  // Shift+arrows select a range; the status bar adds it up.
  await grid.locator('[data-cell="B2"]').click();
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.getByTestId('sheet-stats')).toContainText('Sum: 1300');
  await expect(page.getByLabel('Selected cell')).toHaveText('B2:B3');

  // Insert a column, then fill a formula down with Ctrl+D.
  await page.getByRole('button', { name: 'Insert column right' }).click();
  await grid.locator('[data-cell="C2"]').click();
  await page.keyboard.type('=B2*2');
  await page.keyboard.press('Enter');
  await grid.locator('[data-cell="C2"]').click();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press(`${mod}+d`);
  await expect(grid.locator('[data-cell="C3"]')).toHaveText('600');

  // Bold writes Markdown emphasis; numbers inside it still count.
  await grid.locator('[data-cell="B2"]').click();
  await page.keyboard.press('Shift+ArrowDown');
  await page.getByRole('button', { name: 'Bold' }).click();
  await expect(grid.locator('[data-cell="B2"]')).toHaveText('1000');
  await expect(grid.locator('[data-cell="B4"]')).toHaveText('1300');

  // A filter hides rows in the view only.
  await page.getByRole('button', { name: 'Filter rows' }).click();
  await page.getByLabel('Filter column').selectOption({ label: 'B · Cost' });
  await page.getByLabel('Filter condition').selectOption({ label: 'is greater than' });
  await page.getByLabel('Filter value').fill('500');
  await page.getByRole('button', { name: 'Add filter' }).click();
  await expect(grid.locator('[data-cell="A2"]')).toHaveText('Rent');
  await expect(grid.locator('[data-cell="A3"]')).toHaveText('Total');
  await page.getByRole('button', { name: /Remove filter 1/ }).click();
  await expect(grid.locator('[data-cell="A3"]')).toHaveText('Food');

  // Freeze the header row.
  await page.getByRole('button', { name: 'Freeze header row' }).click();
  await expect(page.locator('.sheet-frozen-rows')).toBeVisible();

  await waitSaved(page);
  await mode(page, 'Source');
  const text = await sourceText(page);
  expect(text).toContain('=SUM(B2:B3)');
  expect(text).toContain('**1000**');
  expect(text).toContain('=B3*2');
});

test('the meeting minutes template creates a ready-to-fill document with editable tables', async ({
  page,
}) => {
  await freshApp(page);
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'New from template' })
    .getByRole('button', { name: /Meeting minutes/ })
    .click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await mode(page, 'Read');
  await expect(page.getByRole('heading', { name: /Action items/ })).toBeVisible();
  await expect(page.locator('article.prose .callout')).not.toHaveCount(0);
  await mode(page, 'Sheet');
  await expect(page.getByRole('combobox', { name: 'Table' }).locator('option')).toHaveCount(3);
});
