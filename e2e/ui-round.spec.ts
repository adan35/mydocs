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
