import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  freshApp,
  mod,
  newDocInRoot,
  prompt,
  setDoc,
  waitSaved,
  withoutFileSystemAccess,
} from './helpers';

test.beforeEach(({ page }) => withoutFileSystemAccess(page));

async function importFixture(page: Page, name: string, mimeType: string) {
  await page.getByRole('button', { name: 'Import' }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Files…' }).click();
  await (
    await chooser
  ).setFiles({ name, mimeType, buffer: readFileSync(resolve(process.cwd(), 'fixtures', name)) });
  await expect(page.getByText(/Imported 1 file/).last()).toBeVisible();
  await page.getByRole('treeitem', { name }).click();
}

test('each format gets the controls that work for it', async ({ page }) => {
  await freshApp(page);
  // Markdown: block styles and formatting, no plain-text tools.
  await newDocInRoot(page, 'Notes');
  await setDoc(page, '# Notes\n\nSome text.\n');
  await waitSaved(page);
  const ribbon = page.getByTestId('ribbon');
  await expect(ribbon.getByRole('combobox', { name: 'Paragraph style' })).toBeVisible();
  await expect(ribbon.getByRole('button', { name: 'Bold' })).toBeVisible();
  await expect(ribbon.getByRole('button', { name: 'Wrap long lines' })).toHaveCount(0);

  // Plain text: find, replace, wrapping; no Markdown formatting that would be saved as symbols.
  await page.getByRole('button', { name: 'New document', exact: true }).first().click();
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button').last().click();
  await page.getByRole('dialog').getByRole('textbox').fill('log.txt');
  await page.getByRole('dialog').getByRole('textbox').press('Enter');
  await page.getByRole('button', { name: 'Use .txt' }).click();
  await expect(page.getByRole('treeitem', { name: 'log.txt' })).toBeVisible();
  await expect(ribbon.getByRole('button', { name: 'Replace' })).toBeVisible();
  await expect(ribbon.getByRole('button', { name: 'Wrap long lines' })).toBeVisible();
  await expect(ribbon.getByRole('button', { name: 'Bold' })).toHaveCount(0);
  await expect(ribbon.getByRole('combobox', { name: 'Paragraph style' })).toHaveCount(0);

  // Spreadsheet: row, column and sort commands.
  await importFixture(page, 'inventory.csv', 'text/csv');
  const sheetRibbon = page.getByTestId('sheet-ribbon');
  await expect(sheetRibbon.getByRole('button', { name: 'Insert row below' })).toBeVisible();
  await expect(sheetRibbon.getByRole('button', { name: /Sort/ }).first()).toBeVisible();
  await expect(page.getByTestId('ribbon')).toHaveCount(0);

  // PDF: navigation, zoom, search; nothing that edits.
  await importFixture(page, 'field-notes.pdf', 'application/pdf');
  const pdf = page.getByTestId('pdf-toolbar');
  await expect(pdf.getByRole('button', { name: 'Next page' })).toBeVisible();
  await expect(pdf.getByRole('button', { name: 'Zoom in' })).toBeVisible();
  await expect(pdf.getByRole('textbox', { name: 'Find in PDF' })).toBeVisible();
  await expect(page.getByTestId('ribbon')).toHaveCount(0);

  // Word: read-only, with conversion as the way to edit.
  await importFixture(
    page,
    'field-notes.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  await expect(page.getByRole('button', { name: 'Convert or export…' }).first()).toBeVisible();
  await expect(page.getByTestId('ribbon')).toHaveCount(0);
});

test('renaming a linked document keeps both kinds of link, and the graph edge', async ({
  page,
}) => {
  await freshApp(page);
  await newDocInRoot(page, 'Target');
  await setDoc(page, '# Target\n');
  await waitSaved(page);
  await newDocInRoot(page, 'Source');
  await setDoc(page, '# Source\n\nSee [[Target]] and [the target](./Target.md).\n');
  await waitSaved(page);

  // Rename the target from the tree.
  await page.getByRole('treeitem', { name: 'Target.md' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Rename/ }).click();
  await prompt(page, 'Renamed');
  await expect(page.getByRole('treeitem', { name: 'Renamed.md' })).toBeVisible();

  await page.getByRole('treeitem', { name: 'Source.md' }).click();
  await expect(page.locator('.cm-content')).toContainText('[[Renamed]]');
  await expect(page.locator('.cm-content')).toContainText('(./Renamed.md)');

  await page.getByRole('treeitem', { name: 'Renamed.md' }).click();
  await page.keyboard.press(`${mod}+k`);
  await page.keyboard.type('local graph');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Graph · Renamed.md' })).toBeVisible();
  await expect(page.getByText(/2 documents · 1 link/)).toBeVisible();
});
