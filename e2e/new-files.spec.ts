import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';
import { freshApp, setDoc, sourceText, waitSaved } from './helpers';

async function createFile(page: Page, name: string) {
  await page.getByRole('button', { name: 'New file…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New file', exact: true });
  await dialog.getByRole('textbox', { name: 'File name' }).fill(name);
  await dialog.getByRole('button', { name: 'Create file' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('treeitem', { name, exact: true })).toBeVisible();
}

test('new files keep custom extensions and dotfiles, and edits survive reopening', async ({
  page,
}) => {
  await freshApp(page);
  await createFile(page, 'analysis.py');
  await setDoc(page, 'print("Hello")\n');
  await waitSaved(page);
  await createFile(page, '.gitignore');
  await setDoc(page, 'dist/\n');
  await waitSaved(page);
  await createFile(page, 'settings.json');
  expect(JSON.parse(await sourceText(page))).toEqual({});
  await createFile(page, 'index.html');
  expect(await sourceText(page)).toContain('<!doctype html>');

  await page.reload();
  await page.getByRole('treeitem', { name: 'analysis.py', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('print("Hello")');
  await page.getByRole('treeitem', { name: '.gitignore', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('dist/');
  await expect(page.getByRole('treeitem', { name: 'analysis.py.md', exact: true })).toHaveCount(0);
});

test('the file type picker creates an editable real Excel workbook and CSV opens as a sheet', async ({
  page,
}) => {
  await freshApp(page);
  await page.getByRole('button', { name: 'New file…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New file', exact: true });
  await dialog.getByRole('combobox', { name: 'File type' }).selectOption('xlsx');
  await expect(dialog.getByRole('textbox', { name: 'File name' })).toHaveValue('Untitled.xlsx');
  await dialog.getByRole('textbox', { name: 'File name' }).fill('Budget.xlsx');
  await dialog.getByRole('button', { name: 'Create file' }).click();
  const grid = page.getByTestId('sheet-grid');
  await expect(grid).toBeVisible();
  await grid.locator('[data-cell="A1"]').dblclick();
  await page.getByRole('textbox', { name: 'Edit cell' }).fill('42');
  await page.getByRole('textbox', { name: 'Edit cell' }).press('Enter');
  await expect(grid.locator('[data-cell="A1"]')).toHaveText('42');
  await expect(page.getByTestId('sheet-save-status')).toHaveText('Saved');

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Export', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: /Original file/ }).click();
  const file = await download;
  const zip = unzipSync(new Uint8Array(readFileSync((await file.path())!)));
  expect(strFromU8(zip['xl/worksheets/sheet1.xml']!)).toContain('<v>42</v>');

  await createFile(page, 'inventory.csv');
  await expect(page.getByTestId('sheet-grid')).toBeVisible();
});

test('invalid names and binary extensions cannot create misleading broken files', async ({
  page,
}) => {
  await freshApp(page);
  await page.getByRole('button', { name: 'New file…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New file', exact: true });
  const name = dialog.getByRole('textbox', { name: 'File name' });
  await name.fill('../image.png');
  await expect(dialog.getByRole('alert')).toContainText('slashes');
  await expect(dialog.getByRole('button', { name: 'Create file' })).toBeDisabled();
  await name.fill('image.png');
  await expect(dialog.getByRole('alert')).toContainText('Import an existing file');
  await expect(dialog.getByRole('button', { name: 'Create file' })).toBeDisabled();
  await name.fill('Makefile');
  await expect(dialog.getByRole('button', { name: 'Create file' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Create file' }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.getByRole('treeitem', { name: 'Makefile', exact: true })).toBeVisible();
});

test('phone navigation opens the format picker and creates a text file without overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshApp(page);
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'More' })
    .click();
  await page.getByRole('menuitem', { name: 'New file…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New file', exact: true });
  await dialog.getByRole('combobox', { name: 'File type' }).selectOption('txt');
  await dialog.getByRole('textbox', { name: 'File name' }).fill('Phone notes.txt');
  await dialog.getByRole('button', { name: 'Create file' }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await setDoc(page, 'A note from my phone');
  await waitSaved(page);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(0);
});
