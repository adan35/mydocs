import { expect, test, type Page } from '@playwright/test';
import { freshApp } from './helpers';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

async function openGuide(page: Page) {
  await freshApp(page);
  await page.getByRole('treeitem', { name: 'Guides' }).click();
  await page.getByRole('treeitem', { name: 'Markdown guide.md' }).click();
  await expect(page.locator('.cm-content, .prose').first()).toBeVisible();
}

test('Reveal in Files expands the folders again and shows the file', async ({ page }) => {
  await openGuide(page);
  const file = page.getByRole('treeitem', { name: 'Markdown guide.md' });
  // Collapse the folder: the open file is no longer in the tree.
  await page.getByRole('treeitem', { name: 'Guides', exact: true }).click();
  await expect(file).toHaveCount(0);

  await page.getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Reveal in Files' }).click();
  await expect(file).toBeVisible();
  await expect(file).toHaveClass(/ring-2/);
});

test('Reveal in Files is on the tab menu and the command palette', async ({ page }) => {
  await openGuide(page);
  await page.getByRole('treeitem', { name: 'Guides', exact: true }).click();
  await page.getByRole('tab', { name: /Markdown guide/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Reveal in Files' }).click();
  await expect(page.getByRole('treeitem', { name: 'Markdown guide.md' })).toBeVisible();

  await page.getByRole('treeitem', { name: 'Guides', exact: true }).click();
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Command palette' }).fill('Reveal in Files');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('treeitem', { name: 'Markdown guide.md' })).toBeVisible();
});

test('copy path options put the path, name and wiki link on the clipboard', async ({ page }) => {
  await openGuide(page);
  const copy = async (item: string) => {
    await page.getByRole('menuitem', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'Copy path' }).click();
    await page.getByRole('menuitem', { name: item }).click();
  };
  await copy('Path in My Doc');
  expect(await clipboard(page)).toBe('Guides/Markdown guide.md');
  await copy('Full path (from root)');
  expect(await clipboard(page)).toBe('/Guides/Markdown guide.md');
  await copy('File name');
  expect(await clipboard(page)).toBe('Markdown guide.md');
  await copy('Wiki link');
  expect(await clipboard(page)).toBe('[[Markdown guide]]');
  await expect(page.getByText('Copied wiki link.')).toBeVisible();

  // From the tree's context menu, relative to the open document.
  await page.getByRole('treeitem', { name: 'Keyboard shortcuts.md' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy path' }).click();
  await page.getByRole('menuitem', { name: 'Relative to open document' }).click();
  expect(await clipboard(page)).toBe('./Keyboard shortcuts.md');
});

test('Show in File Explorer explains the browser limit and offers a copy', async ({ page }) => {
  await openGuide(page);
  await page.getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Show in File Explorer' }).click();
  await expect(page.getByText("Browsers can't open File Explorer.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download a copy' })).toBeVisible();

  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Command palette' }).fill('Show in File Explorer');
  await expect(page.getByRole('option', { name: /Show in File Explorer/ })).toBeVisible();
});

test('right-clicking the blank space beside a document offers the file menu', async ({ page }) => {
  await openGuide(page);
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  const pane = page.getByTestId('preview-pane');
  const box = (await pane.boundingBox())!;
  await pane.click({ button: 'right', position: { x: 12, y: box.height / 2 } });
  await expect(page.getByRole('menuitem', { name: 'Show in File Explorer' })).toBeVisible();
  await page.keyboard.press('Escape');
  // On the text itself the browser's own menu stays.
  await page.locator('.prose p').first().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Show in File Explorer' })).toHaveCount(0);
});
