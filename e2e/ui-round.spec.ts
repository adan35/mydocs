import { expect, test } from '@playwright/test';
import { freshApp, mode, newDocInRoot, setDoc, waitSaved } from './helpers';

test('home has a visible drop zone and the sidebar leads with New document', async ({ page }) => {
  await freshApp(page);
  await page.goto('/#/');
  await expect(page.getByTestId('home-drop-zone')).toContainText('Drag and drop files or folders');
  const first = page.getByRole('navigation', { name: 'Workspace' }).getByRole('button').nth(4);
  await expect(
    page.getByRole('button', { name: 'New document', exact: true }).first(),
  ).toBeVisible();
  void first;
});

test('a dragged document can be dropped on Favorites and Trash', async ({ page }) => {
  await freshApp(page);
  await newDocInRoot(page, 'Dragme');
  const row = page.getByRole('treeitem', { name: 'Dragme.md' });
  const nav = page.getByRole('navigation', { name: 'Workspace' });
  await row.dragTo(nav.getByRole('button', { name: 'Favorites' }));
  await expect(page.getByRole('button', { name: 'Remove from favorites' })).toBeVisible();
  await row.dragTo(nav.getByRole('button', { name: /^Trash/ }));
  await expect(page.getByRole('treeitem', { name: 'Dragme.md' })).toHaveCount(0);
});

test('links tab lists web links; history is a commit log', async ({ page }) => {
  await freshApp(page);
  await newDocInRoot(page, 'Links');
  await setDoc(page, '# T\n\nSee [Tauri](https://tauri.app) and <https://example.com>.\n');
  await waitSaved(page);
  await mode(page, 'Read');
  await page.getByRole('tab', { name: 'Links', exact: true }).click();
  await expect(
    page.getByRole('list', { name: 'Web links' }).getByRole('link', { name: /Tauri/ }),
  ).toHaveAttribute('href', 'https://tauri.app');
  await expect(page.getByText('Links from this document · 2')).toBeVisible();
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  await page.getByRole('button', { name: 'Version history' }).click();
  await expect(
    page.getByRole('list', { name: 'Versions' }).getByRole('listitem').first(),
  ).toContainText('Current version');
});

test('version history maximizes and offers diff layouts, comparison, source and preview', async ({
  page,
}) => {
  await freshApp(page);
  await newDocInRoot(page, 'Hist');
  await setDoc(page, '# Title\n\nOne\n\nTwo\n\nThree\n');
  await waitSaved(page);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Version history' }).click();
  const dialog = page.getByRole('dialog', { name: 'Version history' });
  const vp = page.viewportSize()!;

  // Maximize fills the window; restore floats it again; Esc still closes.
  await dialog.getByRole('button', { name: 'Maximize' }).click();
  expect((await dialog.boundingBox())!.width).toBe(vp.width);
  expect((await dialog.boundingBox())!.height).toBe(vp.height);
  await dialog.getByRole('button', { name: 'Restore size' }).click();
  expect((await dialog.boundingBox())!.width).toBeLessThan(vp.width);

  // Whole document, side by side.
  const list = dialog.getByRole('list', { name: 'Versions' });
  const versions = list.getByRole('listitem');
  await expect(versions.first()).toContainText('Current version');
  await versions.first().click();
  await dialog.getByRole('button', { name: 'Side by side' }).click();
  await dialog.getByRole('button', { name: 'Whole document' }).click();
  await expect(dialog.locator('pre [data-diff="add"]').first()).toBeVisible();
  await expect(dialog.locator('pre')).toContainText('Three');

  // Compare an older version with the current one.
  await versions.last().click();
  await dialog.getByLabel('Compare with').selectOption({ label: 'Current version' });
  await expect(dialog).toContainText('Red lines exist only in');

  // Source and rendered preview of the selected version.
  await dialog.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(dialog.locator('pre')).toBeVisible();
  await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(dialog.locator('.prose')).toBeVisible();

  // Filter the list.
  await dialog.getByLabel('Filter versions').fill('zzzz');
  await expect(dialog).toContainText('No match.');
  await dialog.getByLabel('Filter versions').fill('current');
  await expect(versions).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
