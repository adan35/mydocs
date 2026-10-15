import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';
import {
  freshApp,
  mode,
  newDocInRoot,
  setDoc,
  sourceText,
  waitSaved,
  withoutFileSystemAccess,
} from './helpers';

test.beforeEach(({ page }) => withoutFileSystemAccess(page));

const fixture = (name: string) => readFileSync(resolve(process.cwd(), 'fixtures', name));

async function importFile(page: Page, name: string, mimeType: string) {
  await page.getByRole('button', { name: 'Import' }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Files…' }).click();
  await (await chooser).setFiles({ name, mimeType, buffer: fixture(name) });
  await expect(page.getByText(/Imported 1 file/)).toBeVisible();
  await page.getByRole('treeitem', { name }).click();
}

async function openConvert(page: Page) {
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  return page.getByRole('dialog', { name: /Convert or export/ });
}

test('Markdown exports to a real Word file and converts to a new .docx, keeping the original', async ({
  page,
}) => {
  await freshApp(page);
  await newDocInRoot(page, 'Report');
  await setDoc(page, readFileSync(resolve(process.cwd(), 'fixtures/report.md'), 'utf8'));
  await waitSaved(page);
  const dialog = await openConvert(page);
  await dialog.getByRole('radio', { name: /Word document/ }).click();
  // The preview is the Word file read back.
  const preview = dialog.getByTestId('conversion-preview');
  await expect(preview.locator('h2', { hasText: 'Goals' })).toBeVisible();
  await expect(preview.locator('table td', { hasText: '007' })).toBeVisible();
  await expect(dialog.getByTestId('conversion-report')).toContainText('Kept');
  await expect(dialog.getByTestId('conversion-report')).toContainText('TeX');

  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Report.docx');
  const bytes = readFileSync((await file.path())!);
  const doc = strFromU8(unzipSync(new Uint8Array(bytes))['word/document.xml']!);
  expect(doc).toContain('w:val="Heading2"');
  expect(doc).toContain('<w:tbl>');

  // Convert creates a sibling file; the Markdown stays.
  const again = await openConvert(page);
  await again.getByRole('radio', { name: /Word document/ }).click();
  await again.getByRole('button', { name: /Create Report\.docx/ }).click();
  await expect(page.getByRole('treeitem', { name: 'Report.docx' })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: 'Report.md' })).toBeVisible();
  // It opens in the Word view.
  await expect(page.locator('article.prose h1', { hasText: 'Quarterly report' })).toBeVisible();
});

test('a Word document opens formatted and converts to Markdown with its images', async ({
  page,
}) => {
  await freshApp(page);
  await importFile(
    page,
    'field-notes.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  await expect(page.locator('article.prose h1', { hasText: 'Field notes' })).toBeVisible();
  await expect(page.locator('article.prose table td', { hasText: '0042' })).toBeVisible();
  // The embedded image shows, from the file itself.
  await expect
    .poll(() => page.locator('article.prose img').evaluate((i: HTMLImageElement) => i.naturalWidth))
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Convert or export…' }).first().click();
  const dialog = page.getByRole('dialog', { name: /Convert or export/ });
  await expect(dialog.getByRole('radio', { name: /Markdown/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await dialog.getByRole('button', { name: /Create field-notes\.md/ }).click();
  await expect(page.getByRole('treeitem', { name: 'field-notes.md' })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: 'field-notes.docx' })).toBeVisible();
  await mode(page, 'Source');
  const text = await sourceText(page);
  expect(text).toContain('# Sites');
  expect(text).toContain('1. North ridge');
  expect(text).toContain('| Heron | 4 | 007 |');
  expect(text).toMatch(/!\[\]\((?:\.\/)?assets\/field-notes%20image1\.png\)/);
  // The extracted image is a real file in the workspace and shows in the preview.
  await mode(page, 'Read');
  await expect(page.locator('article.prose img')).toHaveJSProperty('complete', true);
  await expect(page.locator('article.prose img.img-missing')).toHaveCount(0);
});

test('an Excel workbook keeps types and formulas, recalculates edits and keeps versions', async ({
  page,
}) => {
  await freshApp(page);
  await importFile(
    page,
    'sales-libreoffice.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  const grid = page.getByTestId('sheet-grid');
  await expect(grid.locator('[data-cell="A2"]')).toHaveText('007');
  await expect(grid.locator('[data-cell="G2"]')).toHaveText('2026-01-15');
  await expect(grid.locator('[data-cell="E6"]')).toHaveText('36.49');
  await expect(grid.locator('[data-cell="E7"]')).toHaveText('67%');
  await expect(page.getByRole('tab', { name: 'Notes' })).toBeVisible();
  // The unsupported XLOOKUP keeps its saved value and says so.
  await grid.locator('[data-cell="E8"]').click();
  await expect(page.getByText('Not recalculated').first()).toBeVisible();
  // Viewing never changes the file; editing is a choice when features would be dropped.
  await grid.locator('[data-cell="C2"]').click();
  await expect(page.getByTestId('formula-bar')).toHaveValue('3');
  const editAnyway = page.getByRole('button', { name: 'Edit anyway' });
  if (await editAnyway.isVisible()) await editAnyway.click();
  await grid.locator('[data-cell="C2"]').click();
  await page.keyboard.type('5');
  await page.keyboard.press('Enter');
  await expect(grid.locator('[data-cell="E2"]')).toHaveText('7.5');
  await expect(grid.locator('[data-cell="E6"]')).toHaveText('39.49');
  await expect(page.getByTestId('sheet-save-status')).toHaveText('Saved');
  // A formula typed in a cell is calculated.
  await grid.locator('[data-cell="H2"]').click();
  await page.keyboard.type('=SUM(C2:C4)*2');
  await page.keyboard.press('Enter');
  await expect(grid.locator('[data-cell="H2"]')).toHaveText('16');
  await expect(page.getByTestId('sheet-save-status')).toHaveText('Saved');
  // Undo restores the previous value.
  await grid.focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(grid.locator('[data-cell="H2"]')).toHaveText('');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(grid.locator('[data-cell="H2"]')).toHaveText('16');
  await expect(page.getByTestId('sheet-save-status')).toHaveText('Saved');
  // After a reload the saved workbook has the edits.
  await page.reload();
  await page.getByRole('treeitem', { name: 'sales-libreoffice.xlsx' }).click();
  await expect(page.getByTestId('sheet-grid').locator('[data-cell="E2"]')).toHaveText('7.5');
  await expect(page.getByTestId('sheet-grid').locator('[data-cell="A2"]')).toHaveText('007');
  // The original file is in version history.
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Version history' }).click();
  await expect(page.getByRole('dialog', { name: 'Version history' })).toContainText(
    'A saved copy of the whole file',
  );
});

test('a CSV file edits as a sheet and rewrites only the edited row', async ({ page }) => {
  await freshApp(page);
  await importFile(page, 'inventory.csv', 'text/csv');
  const grid = page.getByTestId('sheet-grid');
  await expect(grid.locator('[data-cell="C2"]')).toHaveText('007');
  await expect(grid.locator('[data-cell="A3"]')).toHaveText('Cup, large');
  await grid.locator('[data-cell="B4"]').dblclick();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('9');
  await page.keyboard.press('Enter');
  await expect(grid.locator('[data-cell="B4"]')).toHaveText('9');
  await waitSaved(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  expect(await sourceText(page)).toBe(
    'name,qty,code\nPen,3,007\n"Cup, large",2,0042\nLamp,9,100\n',
  );
  // Converting to Excel types plain numbers but keeps codes as text.
  const dialog = await openConvert(page);
  await dialog.getByRole('radio', { name: /Excel workbook/ }).click();
  const preview = dialog.getByTestId('conversion-preview');
  await expect(preview.locator('[data-cell="C2"]')).toHaveText('007');
  await expect(preview.locator('[data-cell="B2"]')).toHaveClass(/text-right/);
});

test('a .unl export opens as a sheet without the trailing empty column and converts to CSV', async ({
  page,
}) => {
  await freshApp(page);
  await importFile(page, 'transactions.unl', 'application/octet-stream');
  const grid = page.getByTestId('sheet-grid');
  // No header row: the first record is row 1, under column letters.
  await expect(grid.locator('[data-cell="A1"]')).toHaveText('27747620');
  await expect(grid.locator('[data-cell="F1"]')).toHaveText('REISSUE_FUND');
  await expect(grid.locator('[data-cell="Q1"]')).toHaveText('0.0');
  await expect(grid.locator('[data-cell="F6"]')).toHaveText('PRE_AUTH');
  await expect(page.getByRole('checkbox', { name: 'Header row' })).not.toBeChecked();
  // Editing a cell rewrites only that record and keeps its trailing pipe.
  await grid.locator('[data-cell="F3"]').dblclick();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('REFUND');
  await page.keyboard.press('Enter');
  await waitSaved(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  const text = await sourceText(page);
  expect(text.split('\n')[2]).toBe(
    '27744742|0.0|6.0|250.0|250.0|REFUND|F||SD|40|10/15/2026|0642|H|-1|JSNWS|0.0|0.0|',
  );
  expect(text.split('\n')[0]).toBe(fixture('transactions.unl').toString('utf8').split('\n')[0]);

  const dialog = await openConvert(page);
  await dialog.getByRole('radio', { name: /^CSV/ }).click();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('transactions.csv');
  const csv = readFileSync((await file.path())!, 'utf8').split('\n');
  expect(csv[0]).toBe(
    '27747620,-6.0,-6.0,250.0,250.0,REISSUE_FUND,F,,HI,22,10/15/2026,0642,B,-1,BAT_A_ReissueFunds,0.0,0.0',
  );
});

test('Markdown tables edit as a sheet, with a picker for several tables', async ({ page }) => {
  await freshApp(page);
  await newDocInRoot(page, 'Tables');
  await setDoc(
    page,
    '# Plan\n\n## Prices\n\n| Item | Qty |\n| :--- | --: |\n| Pen | 007 |\n\nText between.\n\n## People\n\n| Name | Role |\n| --- | --- |\n| Ada | Lead |\n',
  );
  await waitSaved(page);
  await mode(page, 'Sheet');
  const grid = page.getByTestId('sheet-grid');
  await expect(grid.locator('[data-cell="B2"]')).toHaveText('007');
  // Table cells are text: shown and edited exactly as written, aligned as declared.
  await grid.locator('[data-cell="B2"]').click();
  await expect(page.getByTestId('formula-bar')).toHaveValue('007');
  await expect(grid.locator('[data-cell="B2"]')).toHaveClass(/text-right/);
  await page.getByRole('combobox', { name: 'Table' }).selectOption({ index: 1 });
  await expect(grid.locator('[data-cell="A2"]')).toHaveText('Ada');
  await grid.locator('[data-cell="B2"]').click();
  await page.keyboard.type('Owner');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Insert row below' }).click();
  await waitSaved(page);
  await mode(page, 'Source');
  const text = await sourceText(page);
  expect(text).toContain('| Name | Role  |\n| ---- | ----- |\n| Ada  | Owner |\n|      |       |');
  // The other table is untouched, byte for byte.
  expect(text).toContain('| Item | Qty |\n| :--- | --: |\n| Pen | 007 |');
  expect(text).toContain('Text between.');
});

test('PDFs open in a page viewer with search', async ({ page }) => {
  await freshApp(page);
  await importFile(page, 'field-notes.pdf', 'application/pdf');
  const pages = page.getByTestId('pdf-pages');
  await expect(pages.locator('[data-page="1"] canvas')).toBeVisible();
  await expect(page.getByTestId('pdf-toolbar')).toContainText('Page 1 of 1');
  await page.getByRole('textbox', { name: 'Find in PDF' }).fill('Heron');
  await expect(page.getByTestId('pdf-toolbar')).toContainText('1 of 1 pages');
  await expect(pages.locator('.pdf-hit').first()).toBeVisible();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByTestId('pdf-toolbar')).toContainText('125%');
});

test('the formats page lists what each format supports', async ({ page }) => {
  await freshApp(page);
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('Supported formats');
  await page.keyboard.press('Enter');
  const matrix = page.getByTestId('formats-matrix');
  await expect(matrix).toContainText('Word document → Markdown');
  await expect(matrix).toContainText('Google Docs and Google Sheets');
  await expect(matrix).toContainText('Sync, sharing and real-time collaboration');
});

test('clicking a row number inserts one or several rows above or below', async ({ page }) => {
  await freshApp(page);
  await importFile(page, 'inventory.csv', 'text/csv');
  const grid = page.getByTestId('sheet-grid');
  await expect(grid.locator('[data-cell="A3"]')).toHaveText('Cup, large');
  // One row above row 3.
  await grid.getByRole('rowheader', { name: '3', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Insert row above' }).click();
  await expect(grid.locator('[data-cell="A3"]')).toHaveText('');
  await expect(grid.locator('[data-cell="A4"]')).toHaveText('Cup, large');
  // Three rows below row 1.
  await grid.getByRole('rowheader', { name: '1', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Insert rows below…' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('3');
  await page.getByRole('dialog').getByRole('button', { name: 'Insert' }).click();
  await expect(grid.locator('[data-cell="A2"]')).toHaveText('');
  await expect(grid.locator('[data-cell="A5"]')).toHaveText('Pen');
  await waitSaved(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  expect(await sourceText(page)).toBe(
    'name,qty,code\n,,\n,,\n,,\nPen,3,007\n,,\n"Cup, large",2,0042\nLamp,1,100\n',
  );
});
