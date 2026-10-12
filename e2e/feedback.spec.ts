import { expect, test, type Page } from '@playwright/test';
import { freshApp, mod, prompt, waitSaved, withoutFileSystemAccess } from './helpers';

// Regression tests for the issues found in the first round of user testing.

test.beforeEach(({ page }) => withoutFileSystemAccess(page));

async function importFiles(
  page: Page,
  files: { name: string; mimeType: string; buffer: Buffer }[],
) {
  await page.getByRole('button', { name: 'Import' }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Files…' }).click();
  await (await chooser).setFiles(files);
  await expect(page.getByText(/^Imported/)).toBeVisible();
}

const editorText = (page: Page) => page.locator('.cm-content');

async function newDoc(page: Page) {
  await page.getByRole('button', { name: 'New document', exact: true }).first().click();
  await expect(editorText(page)).toBeFocused();
}

test('a new document is ready for typing', async ({ page }) => {
  await freshApp(page);
  await newDoc(page);
  await expect(editorText(page)).toBeFocused();
  await page.keyboard.type('Weekly status update');
  await expect(editorText(page)).toContainText('Weekly status update');
  // Typing spaces didn't press the button again.
  await expect(page.getByRole('treeitem', { name: /^Untitled/ })).toHaveCount(1);
});

test('renaming without an extension keeps the document Markdown', async ({ page }) => {
  await freshApp(page);
  await newDoc(page);
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button').last().click();
  const input = page.getByRole('dialog').getByRole('textbox');
  await input.press(`${mod}+A`);
  await prompt(page, 'Chapter one');
  await expect(page.getByRole('treeitem', { name: 'Chapter one.md' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'View mode' })).toBeVisible();

  // Changing the extension on purpose asks first.
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button').last().click();
  const rename = page.getByRole('dialog').getByRole('textbox');
  await rename.fill('Chapter one.txt');
  await rename.press('Enter');
  await page.getByRole('button', { name: 'Keep .md' }).click();
  await expect(page.getByRole('treeitem', { name: 'Chapter one.txt.md' })).toBeVisible();
});

test('closing the active tab closes it', async ({ page }) => {
  await freshApp(page);
  await page.getByRole('treeitem', { name: 'Guides' }).click();
  await page.getByRole('treeitem', { name: 'Keyboard shortcuts.md' }).click();
  await expect(page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab')).toHaveCount(
    2,
  );
  await page.keyboard.press('Alt+W');
  await expect(page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab')).toHaveCount(
    1,
  );
  await expect(page.getByRole('tab', { name: /Welcome to My Doc/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('button', { name: /^Close Welcome to My Doc/ }).click();
  await expect(page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab')).toHaveCount(
    0,
  );
});

test('search shows clean snippets and opens at the match', async ({ page }) => {
  await freshApp(page);
  await newDoc(page);
  const filler = Array.from({ length: 80 }, (_, i) => `Paragraph ${i} of filler text.`).join(
    '\n\n',
  );
  await page.keyboard.insertText(
    `${filler}\n\n## Limits\n\nThe **zebracorn** limit is _strict_.\n`,
  );
  await waitSaved(page);

  await page.keyboard.press(`${mod}+Shift+F`);
  await page.getByRole('searchbox', { name: 'Search everything' }).fill('zebracorn');
  const result = page.getByRole('main').getByRole('button', { name: /^Untitled\.md/ });
  await expect(result).toContainText('The zebracorn limit is strict.');
  await expect(result).not.toContainText('**');
  await result.click();
  const line = page.locator('.cm-line', { hasText: 'zebracorn' });
  await expect(line).toBeInViewport();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe('zebracorn');
});

test('list typing: checklist shortcut, repeated markers and wiki completion', async ({ page }) => {
  await freshApp(page);
  await newDoc(page);
  await page.keyboard.press(`${mod}+Shift+9`);
  await page.keyboard.type('first');
  await expect(editorText(page)).toContainText('- [ ] first');
  // Enter continues the list; typing the marker again doesn't double it.
  await page.keyboard.press('Enter');
  await page.keyboard.type('- [ ] second');
  await expect(editorText(page)).toContainText('- [ ] second');
  await expect(editorText(page)).not.toContainText('- [ ] - [ ]');

  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('See [[Welc');
  await page.getByRole('option', { name: /Welcome to My Doc/ }).click();
  await expect(page.locator('.cm-line', { hasText: 'See [[' })).toHaveText(
    'See [[Welcome to My Doc]]',
  );
});

test('formatting toolbar formats the selection', async ({ page }) => {
  await freshApp(page);
  await newDoc(page);
  await page.keyboard.type('important');
  await page.keyboard.press('Shift+Home');
  await page
    .getByRole('toolbar', { name: 'Formatting' })
    .getByRole('button', { name: 'Bold' })
    .click();
  await expect(editorText(page)).toContainText('**important**');
  await page
    .getByRole('toolbar', { name: 'Formatting' })
    .getByRole('button', { name: 'Checklist' })
    .click();
  await expect(editorText(page)).toContainText('- [ ] **important**');
});

test('focus returns after the palette and goes to a neighbor after deleting', async ({ page }) => {
  await freshApp(page);
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await editorText(page).click();
  await page.keyboard.press(`${mod}+K`);
  await expect(page.getByRole('combobox', { name: 'Command palette' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(editorText(page)).toBeFocused();

  await page.getByRole('treeitem', { name: 'Guides' }).click();
  const first = page.getByRole('treeitem', { name: 'Keyboard shortcuts.md' });
  await first.focus();
  await page.keyboard.press('Delete');
  await expect(first).toBeHidden();
  await expect(page.locator('[role="treeitem"]:focus')).toHaveCount(1);
});

test('the editor font setting applies to the editor', async ({ page }) => {
  await freshApp(page);
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  const font = () => page.locator('.cm-scroller').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(await font()).toMatch(/JetBrains Mono/);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Sans serif' }).click();
  await page.goBack();
  expect(await font()).toMatch(/Inter/);
});

test('local images and ![[embeds]] show the first time a document opens', async ({ page }) => {
  await freshApp(page);
  // 1x1 transparent PNG.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
    'base64',
  );
  await importFiles(page, [
    { name: 'site.png', mimeType: 'image/png', buffer: png },
    {
      name: 'Pics.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# Pics\n\n![Site](site.png)\n\n![[site.png]]\n'),
    },
  ]);
  await page.getByRole('treeitem', { name: 'Pics.md' }).click();
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  const images = page.locator('.prose img');
  await expect(images).toHaveCount(2);
  for (const img of await images.all()) {
    await expect(img).toHaveAttribute('src', /^blob:/);
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
  }
});
