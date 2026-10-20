import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { freshApp, newDocInRoot, setDoc } from './helpers';

test('a modal owns its keyboard shortcuts and restores the app on close', async ({ page }) => {
  await freshApp(page);
  await page.getByRole('button', { name: 'New folder', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New folder' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Alt+n');
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('treeitem', { name: 'Untitled.md' })).toHaveCount(0);
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('combobox', { name: 'Command palette' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'New document', exact: true }).first().click();
  await expect(page.locator('.cm-content')).toBeVisible();
});

test('nested menus provide a way back on phones and with the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshApp(page);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'Import', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'More', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Theme', exact: true }).click();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('menu', { name: 'More', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Workspace safety' })).toBeVisible();
});

test('saved status and document modes stay readable on a small phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await freshApp(page);
  const header = page.locator('main header').first();
  await expect(header.getByText('Saved', { exact: true })).toBeVisible();
  const title = header.getByRole('navigation', { name: 'Breadcrumb' });
  expect((await title.boundingBox())!.width).toBeGreaterThan(40);
  const modes = page.getByRole('group', { name: 'View mode' });
  await expect(modes.getByText('Source', { exact: true }).first()).toBeVisible();
  expect((await modes.boundingBox())!.y).toBeGreaterThan((await title.boundingBox())!.y);
  await expect(page.getByRole('button', { name: 'More actions' })).toBeInViewport();
});

test('failed local writes pause trash and backup exports contain the latest edits', async ({
  page,
}) => {
  await freshApp(page);
  await newDocInRoot(page, 'Rescue.md');
  await page.evaluate(`
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) {
      if (this.name === 'contents') throw new DOMException('Storage full', 'QuotaExceededError');
      return originalPut.apply(this, args);
    };
  `);
  await setDoc(page, 'These latest changes must be in the backup.');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Move to Trash', exact: true }).click();
  await expect(
    page.getByText('Your latest changes could not be saved. This action was paused.'),
  ).toBeVisible();
  await expect(page.getByRole('treeitem', { name: 'Rescue.md' })).toBeVisible();
  const otherTab = await page.context().newPage();
  await otherTab.goto('/');
  await otherTab.getByRole('button', { name: 'Use here' }).click();
  await expect(otherTab.getByText(/The other tab could not hand over safely/)).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText(
    'These latest changes must be in the backup.',
  );
  await otherTab.close();
  await page
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('button', { name: 'Home', exact: true })
    .click();
  await expect(page.getByText('Some changes still need saving')).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  const download = await downloadEvent;
  const data = await readFile((await download.path())!);
  expect(strFromU8(unzipSync(data)['Rescue.md']!)).toBe(
    'These latest changes must be in the backup.',
  );
});

test('settings choices support arrow keys and backup guidance is easy to find', async ({
  page,
}) => {
  await freshApp(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Storage & backups', exact: true }),
  ).toBeInViewport();
  const theme = page.getByRole('radiogroup', { name: 'Theme', exact: true });
  await theme.getByRole('radio', { checked: true }).focus();
  await page.keyboard.press('Home');
  await expect(theme.getByRole('radio', { name: 'Light', exact: true })).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await expect(theme.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
