import { expect, test } from '@playwright/test';
import {
  changeDisk,
  disk,
  fakeDisk,
  freshApp,
  importViaPicker,
  sourceText,
  waitSaved,
} from './helpers';

test('a file changed on disk updates the open document without re-importing', async ({ page }) => {
  await fakeDisk(page, 'plan.md', '# Plan\n\nfirst draft\n', 'granted');
  await freshApp(page);
  await importViaPicker(page, 'plan.md');
  await expect(page.locator('.cm-content')).toContainText('first draft');

  await changeDisk(page, '# Plan\n\nedited in another app\n');
  await expect(page.locator('.cm-content')).toContainText('edited in another app');
  await expect(page.getByTestId('disk-status')).toContainText('Updated from disk');
  // The new text is stored, and not written back over the file.
  await expect.poll(() => disk(page)).toBe('# Plan\n\nedited in another app\n');

  // Editing after the refresh still saves to disk.
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('and here');
  await waitSaved(page);
  await expect.poll(() => disk(page)).toBe('# Plan\n\nedited in another app\nand here');
});

test('a disk change never overwrites edits that are not on disk yet', async ({ page }) => {
  await fakeDisk(page, 'notes.txt', 'shared line\n', 'granted');
  await freshApp(page);
  await importViaPicker(page, 'notes.txt');
  await expect(page.getByTestId('disk-status')).toBeVisible();

  // Another app saves the file while this one is being edited.
  await changeDisk(page, 'shared line\nfrom the other app\n');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('typed here');

  const conflict = page.getByTestId('disk-conflict');
  await expect(conflict).toBeVisible();
  expect(await disk(page)).toBe('shared line\nfrom the other app\n');
  expect(await sourceText(page)).toContain('typed here');

  await conflict.click();
  await page.getByRole('menuitem', { name: 'Load the version on disk' }).click();
  await expect(page.locator('.cm-content')).toContainText('from the other app');
  await expect(page.locator('.cm-content')).not.toContainText('typed here');
  await expect(page.getByTestId('disk-status')).toBeVisible();
});

test('keeping the My Doc version writes it over the changed file', async ({ page }) => {
  await fakeDisk(page, 'notes.txt', 'one\n', 'granted');
  await freshApp(page);
  await importViaPicker(page, 'notes.txt');
  await expect(page.getByTestId('disk-status')).toBeVisible();

  await changeDisk(page, 'one\ntwo from disk\n');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('mine');
  await page.getByTestId('disk-conflict').click();
  await page.getByRole('menuitem', { name: 'Keep mine and save it to disk' }).click();
  await expect.poll(() => disk(page)).toBe('one\nmine');
  await expect(page.getByTestId('disk-status')).toBeVisible();
});
