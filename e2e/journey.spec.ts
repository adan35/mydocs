import { expect, test } from '@playwright/test';
import { freshApp, mod, prompt, typeInEditor, waitSaved } from './helpers';

test('first launch opens a rendered welcome guide', async ({ page }) => {
  await freshApp(page);
  await expect(page.getByRole('treeitem', { name: 'Welcome to My Doc.md' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tab', { name: /Welcome to My Doc\.md/ })).toBeVisible();
});

test('core journey: create, edit, persist, link, search, organize, trash, restore, export', async ({
  page,
}) => {
  await freshApp(page);

  // Create a folder from the sidebar.
  await page.getByRole('button', { name: 'New folder' }).first().click();
  await prompt(page, 'Projects');
  const projects = page.getByRole('treeitem', { name: 'Projects' });
  await expect(projects).toBeVisible();

  // New document inside the folder (hover + button).
  await projects.hover();
  await page.getByRole('button', { name: 'New document in Projects' }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.getByRole('treeitem', { name: 'Untitled.md' })).toBeVisible();

  // Rename via the title in the header.
  await page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('button', { name: 'Untitled.md' })
    .click();
  await prompt(page, 'Architecture.md');
  await expect(page.getByRole('treeitem', { name: 'Architecture.md' })).toBeVisible();

  // Edit Markdown, including a link to another document and a tag.
  await typeInEditor(
    page,
    'The authentication service validates tokens.\n\nSee [the welcome guide](../Welcome%20to%20My%20Doc.md). #backend\n',
  );
  await waitSaved(page);

  // Persistence: reload and verify.
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('authentication service validates');

  // Preview and follow the internal link.
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await page.locator('.prose').getByRole('link', { name: 'the welcome guide' }).click();
  await expect(page.getByRole('tab', { name: /Welcome to My Doc\.md/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // Backlinks on the welcome guide list Architecture.md.
  await page.getByRole('tab', { name: 'Links' }).click();
  await expect(
    page
      .getByRole('complementary', { name: 'Document details' })
      .getByRole('button', { name: /Architecture\.md/ }),
  ).toBeVisible();

  // Global search with highlighted snippet.
  await page.keyboard.press(`${mod}+Shift+F`);
  await page.getByRole('searchbox', { name: 'Search everything' }).fill('validates');
  const result = page.getByRole('main').getByRole('button', { name: /^Architecture\.md/ });
  await expect(result).toBeVisible();
  await expect(result.locator('mark')).toContainText(/validates/i);

  // Tags view lists the inline tag.
  await page
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('button', { name: 'Tags' })
    .click();
  await page.getByRole('button', { name: /#backend/ }).click();
  await expect(
    page.getByRole('main').getByRole('button', { name: /^Architecture\.md/ }),
  ).toBeVisible();

  // Favorite from the tree menu.
  await page.getByRole('treeitem', { name: 'Architecture.md' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Add to favorites' }).click();
  await page
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('button', { name: 'Favorites', exact: true })
    .click();
  await expect(
    page.getByRole('main').getByRole('button', { name: /^Architecture\.md/ }),
  ).toBeVisible();

  // Move to the root with the folder picker; the link is rewritten so it keeps working.
  await page.getByRole('treeitem', { name: 'Architecture.md' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to…' }).click();
  await page.getByRole('option', { name: 'Workspace root' }).click();
  await page.getByRole('button', { name: 'Move here' }).click();
  await expect(
    page.getByRole('treeitem', { name: 'Architecture.md', exact: true }),
  ).toHaveAttribute('aria-level', '1');
  await page.getByRole('treeitem', { name: 'Architecture.md' }).click();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('](Welcome%20to%20My%20Doc.md)');

  // Trash with undo, then trash and restore from the Trash view.
  await page.getByRole('treeitem', { name: 'Architecture.md' }).focus();
  await page.keyboard.press('Delete');
  await page
    .getByRole('status')
    .filter({ hasText: 'moved to Trash' })
    .getByRole('button', { name: 'Undo' })
    .click();
  await expect(page.getByRole('treeitem', { name: 'Architecture.md' })).toBeVisible();
  await page.getByRole('treeitem', { name: 'Architecture.md' }).focus();
  await page.keyboard.press('Delete');
  await expect(page.getByRole('treeitem', { name: 'Architecture.md' })).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('button', { name: /Trash/ })
    .click();
  await page.getByRole('main').getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: 'Architecture.md' })).toBeVisible();

  // Export the workspace as a zip.
  await page.keyboard.press(`${mod}+K`);
  await page.getByRole('combobox', { name: 'Command palette' }).fill('export workspace');
  const download = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  expect((await download).suggestedFilename()).toBe('My Workspace.zip');
});

test('quick open and command palette are keyboard driven', async ({ page }) => {
  await freshApp(page);
  await page.keyboard.press(`${mod}+P`);
  await page.getByRole('combobox', { name: 'Open document' }).fill('mkgd');
  await expect(page.getByRole('option').first()).toContainText('Markdown guide.md');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: /Markdown guide\.md/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await page.keyboard.press(`${mod}+K`);
  await page.getByRole('combobox', { name: 'Command palette' }).fill('theme dark');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('unsaved edits survive a reload through autosave', async ({ page }) => {
  await freshApp(page);
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await typeInEditor(page, '\nA line typed right before reload.');
  // Reload immediately; autosave or the recovery draft must keep the text.
  await page.waitForTimeout(100);
  await page.reload();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('A line typed right before reload.');
});

test('version history shows and restores an earlier version', async ({ page }) => {
  await freshApp(page);
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+A`);
  await page.keyboard.type('Brand new text');
  await waitSaved(page);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Version history' }).click();
  await page.getByRole('button', { name: 'Restore this version' }).click();
  await expect(page.locator('.cm-content')).toContainText('Welcome to My Doc');
});

test('task checkboxes toggle from the preview', async ({ page }) => {
  await freshApp(page);
  await page.getByRole('treeitem', { name: 'Guides' }).click();
  await page.getByRole('treeitem', { name: 'Markdown guide.md' }).click();
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  const box = page.locator('.prose .task-list-item-checkbox').nth(1);
  await expect(box).not.toBeChecked();
  await box.click();
  await expect(page.locator('.prose .task-list-item-checkbox').nth(1)).toBeChecked();
  await waitSaved(page);
});

test('wiki links in the preview open the linked document', async ({ page }) => {
  await freshApp(page);
  await page.locator('.prose a.wiki-link', { hasText: 'Keyboard shortcuts' }).click();
  await expect(
    page.getByRole('tab', { name: /^Keyboard shortcuts\.md/, selected: true }),
  ).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('# Keyboard shortcuts');
});
