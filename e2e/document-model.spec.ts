import { test, expect } from '@playwright/test';
import { freshApp, mod, newDocInRoot, typeInEditor, waitSaved } from './helpers';

test.describe('document model', () => {
  test('editing a document after leaving and reopening never writes into another tab', async ({
    page,
  }) => {
    await freshApp(page);
    await newDocInRoot(page, 'First');
    await typeInEditor(page, 'first body');
    await waitSaved(page);
    await newDocInRoot(page, 'Second');
    await typeInEditor(page, 'second body');
    await waitSaved(page);
    // Leaving the document unmounts the editor; coming back mounts a new one.
    await page.evaluate(() => (location.hash = '#/'));
    await page.getByRole('tab', { name: /First/ }).first().click();
    await typeInEditor(page, ' more');
    await waitSaved(page);
    await page
      .getByRole('tab', { name: /Second/ })
      .first()
      .click();
    await expect(page.locator('.cm-content')).toContainText('second body');
    await expect(page.locator('.cm-content')).not.toContainText('first body');
    await page.getByRole('tab', { name: /First/ }).first().click();
    await expect(page.locator('.cm-content')).toContainText('first body more');
  });

  test('undo works across source and preview edits', async ({ page }) => {
    await freshApp(page);
    await newDocInRoot(page, 'Tasks');
    await typeInEditor(page, '\n- [ ] ship it');
    await waitSaved(page);
    await page.getByRole('button', { name: /^Read/ }).click();
    await page.locator('.task-list-item-checkbox').first().click();
    await page.getByRole('button', { name: /^Source/ }).click();
    await expect(page.locator('.cm-content')).toContainText('- [x] ship it');
    await page.locator('.cm-content').click();
    await page.keyboard.press(`${mod}+z`);
    await expect(page.locator('.cm-content')).toContainText('- [ ] ship it');
  });
});
