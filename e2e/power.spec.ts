import { expect, test } from '@playwright/test';
import { freshApp, mod, newDocInRoot, typeInEditor, waitSaved } from './helpers';

// CodeMirror ignores keys for a moment after the menu opens, so a user can't accept it by accident.
const settle = (page: import('@playwright/test').Page) => page.waitForTimeout(200);

const editor = (page: import('@playwright/test').Page) => page.locator('.cm-content');

test('slash menu filters by typing and inserts blocks', async ({ page }) => {
  await freshApp(page);
  await newDocInRoot(page, 'Slash.md');
  await typeInEditor(page, '\n/hea');
  const menu = page.locator('.cm-tooltip-autocomplete');
  await expect(menu.getByRole('option').first()).toContainText('Heading 1');
  await settle(page);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Plan');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/check');
  await expect(menu.getByRole('option').first()).toContainText('Checklist');
  await settle(page);
  await page.keyboard.press('Enter');
  await page.keyboard.type('Ship it');
  await waitSaved(page);
  await expect(editor(page)).toContainText('## Plan');
  await expect(editor(page)).toContainText('- [ ] Ship it');
  // A slash inside a sentence isn't a command.
  await page.keyboard.press('Enter');
  await page.keyboard.type('and/or ');
  await expect(menu).toBeHidden();
});

test('visual table editor inserts and edits valid Markdown tables', async ({ page }) => {
  await freshApp(page);
  await newDocInRoot(page, 'Tables.md');
  await typeInEditor(page, '\n/table');
  await expect(page.locator('.cm-tooltip-autocomplete [role=option]').first()).toContainText(
    'Table',
  );
  await settle(page);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Insert table' });
  await dialog.getByLabel('Column 1 heading').fill('Name');
  await dialog.getByLabel('Row 1, column 1').fill('Ada | Lovelace');
  await dialog.getByRole('button', { name: 'Column 2 options' }).click();
  await page.getByRole('menuitem', { name: 'Align right' }).click();
  await dialog.getByRole('button', { name: 'Insert table' }).click();
  await expect(editor(page)).toContainText('| Name');
  await expect(editor(page)).toContainText('Ada \\| Lovelace');
  await expect(editor(page)).toContainText('---: |');

  // Edit it again from the command palette with the cursor inside the table.
  await page.locator('.cm-line', { hasText: 'Ada' }).click();
  await page.keyboard.press(`${mod}+k`);
  await page.keyboard.type('edit table');
  await page.keyboard.press('Enter');
  const edit = page.getByRole('dialog', { name: 'Edit table' });
  await expect(edit.getByLabel('Row 1, column 1')).toHaveValue('Ada \\| Lovelace');
  await edit.getByRole('button', { name: 'Add column' }).click();
  await edit.getByLabel('Column 4 heading').fill('Year');
  await edit.getByRole('button', { name: 'Save table' }).click();
  await expect(editor(page)).toContainText('Year');
  await waitSaved(page);
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.locator('.prose table th')).toHaveCount(4);
  await expect(page.locator('.prose table td').first()).toHaveText('Ada | Lovelace');
});

test('pinned tabs stay first and survive closing other tabs', async ({ page }) => {
  await freshApp(page);
  await page.getByRole('treeitem', { name: 'Guides' }).click();
  await page.getByRole('treeitem', { name: 'Markdown guide.md' }).click();
  await page.getByRole('treeitem', { name: 'Keyboard shortcuts.md' }).click();
  const tabs = page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
  await expect(tabs).toHaveCount(3);

  await tabs.filter({ hasText: 'Keyboard shortcuts.md' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Pin tab' }).click();
  await expect(tabs.first()).toContainText('Keyboard shortcuts.md');

  await tabs.filter({ hasText: 'Welcome to My Doc.md' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Close others' }).click();
  await expect(tabs).toHaveCount(2);
  await expect(tabs.first()).toContainText('Keyboard shortcuts.md');

  // Pins are part of the restored session.
  await page.reload();
  await expect(tabs).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Unpin Keyboard shortcuts.md' })).toBeVisible();

  // Ctrl/Cmd+Shift+P opens the command palette too.
  await page.locator('body').press(`${mod}+Shift+P`);
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
});

test('search understands phrases, tags, folders and exclusions', async ({ page }) => {
  await freshApp(page);
  await page.keyboard.press(`${mod}+Shift+F`);
  const box = page.getByRole('searchbox', { name: 'Search everything' });
  const results = page.locator('main ul button');
  await box.fill('shortcut folder:guides');
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText('Keyboard shortcuts.md');
  await box.fill('tag:welcome');
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText('Welcome to My Doc.md');
  await box.fill('"command palette"');
  await expect(results).toHaveCount(2);
  // The welcome guide links to "Guides/Markdown guide.md", so excluding "guides" drops it.
  await box.fill('"command palette" -guides');
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText('Keyboard shortcuts.md');
  await box.fill('zzzz nothing');
  await expect(page.getByRole('button', { name: 'Open by name instead' })).toBeVisible();
});

test('your own templates, front matter properties and outline folding', async ({ page }) => {
  await freshApp(page);
  await newDocInRoot(page, 'Weekly report.md');
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.type(
    '---\nstatus: draft\ntags: [report]\n---\n# {{title}}\n\nWeek of {{date}}.\n\n## Wins\n\n### Details\n\n## Risks\n',
  );
  await waitSaved(page);

  // Properties render above the document; the YAML stays untouched.
  await page.getByRole('button', { name: 'Preview' }).click();
  const props = page.getByRole('definition').filter({ hasText: 'draft' });
  await expect(props).toBeVisible();

  // The outline folds sections.
  await page.getByRole('tab', { name: 'Outline' }).click();
  const outline = page.getByRole('navigation', { name: 'Outline' });
  await expect(outline.getByRole('button', { name: 'Details' })).toBeVisible();
  await outline.getByRole('button', { name: 'Collapse Wins' }).click();
  await expect(outline.getByRole('button', { name: 'Details' })).toBeHidden();
  await expect(outline.getByRole('button', { name: 'Risks' })).toBeVisible();

  // Save as template, then create a document from it.
  await page.keyboard.press(`${mod}+k`);
  await page.keyboard.type('save as template');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('treeitem', { name: 'Templates' })).toBeVisible();
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New from template' });
  await dialog.getByRole('button', { name: /Weekly report/ }).click();
  await expect(page.locator('.cm-content')).toContainText('# Weekly report (2)');
  await expect(page.locator('.cm-content')).toContainText(/Week of \d{4}-\d{2}-\d{2}\./);
});

test('documents export as plain text', async ({ page }) => {
  await freshApp(page);
  await page.keyboard.press(`${mod}+k`);
  await page.keyboard.type('export as plain text');
  const download = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  const file = await download;
  expect(file.suggestedFilename()).toBe('Welcome to My Doc.txt');
  const text = await (await import('node:fs/promises')).readFile((await file.path())!, 'utf8');
  expect(text).toContain('Welcome to My Doc');
  expect(text).not.toContain('**');
});
