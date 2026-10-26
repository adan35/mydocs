import { expect, test } from '@playwright/test';
import { freshApp } from './helpers';

test.describe('menu bar', () => {
  test('File, Edit, View and Help open and run existing commands', async ({ page }) => {
    await freshApp(page);
    const bar = page.getByRole('menubar', { name: 'Application menu' });
    await expect(bar.getByRole('menuitem')).toHaveText(['File', 'Edit', 'View', 'Help']);

    await bar.getByRole('menuitem', { name: 'Help' }).click();
    await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click();
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Pointing at another title switches the open menu.
    await bar.getByRole('menuitem', { name: 'File' }).click();
    await expect(page.getByRole('menuitem', { name: /^Save/ })).toBeVisible();
    await bar.getByRole('menuitem', { name: 'View' }).hover();
    await expect(page.getByRole('menuitem', { name: 'Zoom in' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Zoom in' }).click();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('mydoc:settings')))
      .toContain('"fontSize":17');
  });

  test('Edit menu works on the open document and View switches modes', async ({ page }) => {
    await freshApp(page);
    const bar = page.getByRole('menubar', { name: 'Application menu' });
    await bar.getByRole('menuitem', { name: 'View' }).click();
    await page.getByRole('menuitemradio', { name: 'Read', exact: true }).click();
    await expect(page.locator('.cm-content')).toBeHidden();
    await bar.getByRole('menuitem', { name: 'View' }).click();
    await page.getByRole('menuitemradio', { name: 'Source', exact: true }).click();
    await expect(page.locator('.cm-content')).toBeVisible();

    await bar.getByRole('menuitem', { name: 'Edit' }).click();
    await page.getByRole('menuitem', { name: /^Select all/ }).click();
    await expect
      .poll(() => page.evaluate(() => document.querySelectorAll('.cm-selectionBackground').length))
      .toBeGreaterThan(0);
  });

  test('tablets get one menu button with the same menus', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await freshApp(page);
    await expect(page.getByRole('menubar')).toHaveCount(0);
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'File' }).click();
    await expect(page.getByRole('menuitem', { name: 'New document…' })).toBeVisible();
  });
});

test.describe('New document asks what to create', () => {
  const picker = (page: import('@playwright/test').Page) =>
    page.getByRole('dialog', { name: 'New document' });

  test('Alt+N offers the kinds and creates the chosen one', async ({ page }) => {
    await freshApp(page);
    await page.keyboard.press('Alt+n');
    await expect(picker(page)).toBeVisible();
    await expect(picker(page).locator('button[data-kind]')).toHaveCount(9);
    await picker(page)
      .getByRole('button', { name: /Plain text/ })
      .click();
    await expect(page.getByRole('tab', { name: /Untitled\.txt/ })).toBeVisible();

    await page.keyboard.press('Alt+n');
    await picker(page)
      .getByRole('button', { name: /CSV table/ })
      .click();
    await expect(page.getByRole('tab', { name: /Untitled\.csv/ })).toBeVisible();
  });

  test('remembers the last choice, and Shift+click skips the question', async ({ page }) => {
    await freshApp(page);
    await page.keyboard.press('Alt+n');
    await picker(page)
      .getByRole('button', { name: /HTML page/ })
      .click();
    await expect(page.getByRole('tab', { name: /Untitled\.html/ })).toBeVisible();

    await page.keyboard.press('Alt+n');
    await expect(picker(page).locator('button[data-kind="html"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(picker(page)).toBeHidden();

    await page
      .getByRole('button', { name: 'New document', exact: true })
      .first()
      .click({ modifiers: ['Shift'] });
    await expect(picker(page)).toBeHidden();
    await expect(page.getByRole('tab', { name: /Untitled\.md/ })).toBeVisible();
  });

  test('number keys pick a kind, and the sidebar button asks too', async ({ page }) => {
    await freshApp(page);
    await page.getByRole('button', { name: 'New document', exact: true }).first().click();
    await expect(picker(page)).toBeVisible();
    await page.keyboard.press('1');
    await expect(page.getByRole('tab', { name: /Untitled\.md/ })).toBeVisible();
  });
});
