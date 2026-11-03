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

test('hovering Copy path flies its submenu out beside the menu, and its items work', async ({
  page,
}) => {
  await openGuide(page);
  await page.getByRole('treeitem', { name: 'Keyboard shortcuts.md' }).click({ button: 'right' });
  const copy = page.getByRole('menuitem', { name: 'Copy path' });
  await copy.hover();
  const sub = page.getByRole('menu', { name: 'Copy path' });
  await expect(sub).toBeVisible();
  // The parent menu stays open and the submenu sits to its right.
  const parent = (await page.getByRole('menu').first().boundingBox())!;
  expect((await sub.boundingBox())!.x).toBeGreaterThan(parent.x + parent.width - 10);
  await expect(page.getByRole('menuitem', { name: 'Reveal in Files' })).toBeVisible();

  // Moving to another submenu swaps it; moving to a plain item closes it.
  await page.getByRole('menuitem', { name: 'Export' }).hover();
  await expect(page.getByRole('menu', { name: 'Export' })).toBeVisible();
  await expect(sub).toBeHidden();
  await page.getByRole('menuitem', { name: 'Rename…' }).hover();
  await expect(page.getByRole('menu', { name: 'Export' })).toBeHidden();

  await copy.hover();
  await sub.getByRole('menuitem', { name: 'File name' }).click();
  expect(await clipboard(page)).toBe('Keyboard shortcuts.md');
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('relative path is copied for the open document', async ({ page }) => {
  await openGuide(page);
  await page.getByRole('treeitem', { name: 'Markdown guide.md' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy path' }).hover();
  await page.getByRole('menuitem', { name: 'Relative to open document' }).click();
  expect(await clipboard(page)).toBe('./Markdown guide.md');
});

test('submenus open with → and close with ← or Escape without closing the menu', async ({
  page,
}) => {
  await openGuide(page);
  await page.getByRole('treeitem', { name: 'Markdown guide.md' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy path' }).focus();
  await page.keyboard.press('ArrowRight');
  const sub = page.getByRole('menu', { name: 'Copy path' });
  await expect(sub.getByRole('menuitem', { name: 'Path in My Doc' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(sub).toBeHidden();
  await expect(page.getByRole('menuitem', { name: 'Copy path' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(sub.getByRole('menuitem', { name: 'Path in My Doc' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sub).toBeHidden();
  await expect(page.getByRole('menuitem', { name: 'Copy path' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('clicking outside closes the menu and its submenu', async ({ page }) => {
  await openGuide(page);
  await page.getByRole('treeitem', { name: 'Markdown guide.md' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy path' }).hover();
  await expect(page.getByRole('menu', { name: 'Copy path' })).toBeVisible();
  await page.mouse.click(700, 400);
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('menu bar: arrows switch menus, ↓ opens one, and clicking its title again closes it', async ({
  page,
}) => {
  await openGuide(page);
  const file = page.getByRole('menuitem', { name: 'File', exact: true });
  await file.click();
  await expect(page.getByRole('menu', { name: 'File' })).toBeVisible();
  await file.click();
  await expect(page.getByRole('menu')).toHaveCount(0);

  await file.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menu', { name: 'File' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Close tab' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menu', { name: 'Edit' })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('menu', { name: 'Help' })).toBeVisible();
});

test('a "…" button closes its own menu when pressed again', async ({ page }) => {
  await openGuide(page);
  const more = page.getByRole('button', { name: /^More/ }).first();
  await more.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await more.click();
  await expect(page.getByRole('menu')).toHaveCount(0);
});
