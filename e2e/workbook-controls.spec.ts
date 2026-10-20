import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { freshApp, prompt, withoutFileSystemAccess } from './helpers';

test('Excel formats survive reload and sheet actions work on a phone-sized screen', async ({
  page,
}) => {
  await withoutFileSystemAccess(page);
  await freshApp(page);
  await page.getByRole('button', { name: 'Import', exact: true }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Files…' }).click();
  await (
    await chooser
  ).setFiles({
    name: 'controls.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: readFileSync(resolve(process.cwd(), 'fixtures/sales-libreoffice.xlsx')),
  });
  await expect(page.getByRole('treeitem', { name: 'controls.xlsx' })).toBeVisible();
  await page.getByRole('treeitem', { name: 'controls.xlsx' }).click();
  const grid = page.getByTestId('sheet-grid');
  await expect(grid.locator('[data-cell="C2"]')).toHaveText('3');
  const edit = page.getByRole('button', { name: 'Edit anyway' });
  if (await edit.isVisible()) await edit.click();
  await grid.locator('[data-cell="C2"]').click();
  const format = page.getByRole('combobox', { name: 'Number format for selected cell' });
  await format.selectOption({ label: 'Currency (USD)' });
  await expect(grid.locator('[data-cell="C2"]')).toHaveText('$3.00');
  await grid.locator('[data-cell="H2"]').click();
  await format.selectOption({ label: 'Plain text' });
  await grid.focus();
  await page.keyboard.type('123');
  await page.keyboard.press('Enter');
  await expect(grid.locator('[data-cell="H2"]')).toHaveText('123');
  const resize = grid.getByRole('separator', { name: 'Resize column A', exact: true });
  await resize.scrollIntoViewIfNeeded();
  const previousWidth = Number(await resize.getAttribute('aria-valuenow'));
  const handle = (await resize.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 64, handle.y + handle.height / 2);
  await page.mouse.up();
  await expect(resize).toHaveAttribute('aria-valuenow', String(previousWidth + 64));
  const ribbon = page.getByTestId('sheet-ribbon');
  await ribbon.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(resize).toHaveAttribute('aria-valuenow', String(previousWidth));
  await ribbon.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(resize).toHaveAttribute('aria-valuenow', String(previousWidth + 64));
  await expect(page.getByTestId('sheet-save-status')).toHaveText('Saved');
  await page.reload();
  await expect(grid.locator('[data-cell="C2"]')).toHaveText('$3.00');
  await expect(resize).toHaveAttribute('aria-valuenow', String(previousWidth + 64));
  await grid.locator('[data-cell="H2"]').click();
  await expect(format).toHaveValue('@');

  // Every sheet action is reachable with a single tap; no double-click is required.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Sheet options for Notes', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rename sheet…' }).click();
  await prompt(page, 'Notes revised');
  await expect(page.getByRole('tab', { name: 'Notes revised', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sheet options for Notes revised', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Duplicate sheet' }).click();
  await expect(page.getByRole('tab', { name: 'Notes revised copy', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page
    .getByRole('button', { name: 'Sheet options for Notes revised copy', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Delete sheet…' }).click();
  await page
    .getByRole('dialog', { name: 'Delete sheet?' })
    .getByRole('button', { name: 'Delete sheet', exact: true })
    .click();
  await expect(page.getByRole('tab', { name: 'Notes revised copy', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Notes revised', exact: true })).toBeVisible();
  await expect(page.getByTestId('sheet-save-status')).toHaveText('Saved');
});
