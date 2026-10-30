import { expect, test } from '@playwright/test';
import { deleteFromDisk, fakeDisk, freshApp, importViaPicker } from './helpers';

test('a file deleted on disk asks whether to delete it here too (Keep)', async ({ page }) => {
  await fakeDisk(page, 'plan.md', '# Plan\n', 'granted');
  await freshApp(page);
  await importViaPicker(page, 'plan.md');
  await expect(page.getByTestId('disk-status')).toBeVisible();

  await deleteFromDisk(page);
  const dialog = page.getByRole('dialog', { name: 'Deleted from disk' });
  await expect(dialog).toContainText('"plan.md" was deleted from your computer');
  await expect(page.getByTestId('disk-missing')).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep' }).click();

  // It stays as a local copy that no longer tries to save to disk.
  await expect(page.getByRole('treeitem', { name: 'plan.md' })).toBeVisible();
  await expect(page.getByTestId('disk-missing')).toHaveCount(0);
  await expect(page.getByText('Disk save failed')).toHaveCount(0);
});

test('a file deleted on disk can be deleted here too (Delete)', async ({ page }) => {
  await fakeDisk(page, 'plan.md', '# Plan\n', 'granted');
  await freshApp(page);
  await importViaPicker(page, 'plan.md');

  await deleteFromDisk(page);
  const dialog = page.getByRole('dialog', { name: 'Deleted from disk' });
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('treeitem', { name: 'plan.md' })).toHaveCount(0);
  await expect(page.getByText('"plan.md" moved to Trash.')).toBeVisible();
});
