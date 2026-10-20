import { test, expect } from '@playwright/test';
import { freshApp, newDocInRoot, setDoc, mode, sourceText, waitSaved } from './helpers';

test('Markdown sheets show readable text and grow without adding empty cells to the document', async ({
  page,
}) => {
  await freshApp(page);
  await newDocInRoot(page, 'Project sheet');
  const before =
    '# Plan\n\n| Platform | Folder |\n| --- | --- |\n| [Desktop](https://tauri.app) | `src-tauri/` |\n\nKeep this paragraph.\n';
  await setDoc(page, before);
  await mode(page, 'Sheet');
  const grid = page.getByTestId('sheet-grid');
  await expect(grid).toHaveAttribute('aria-colcount', '26');
  await expect(grid).toHaveAttribute('aria-rowcount', '100');
  await expect(grid.locator('[data-cell="A2"]')).toHaveText('Desktop');
  await grid.locator('[data-cell="B2"]').click();
  await expect(page.getByTestId('formula-bar')).toHaveValue('`src-tauri/`');
  await mode(page, 'Source');
  expect(await sourceText(page)).toBe(before);
  await mode(page, 'Sheet');
  await grid.locator('[data-cell="D4"]').click();
  await page.keyboard.type('Added');
  await page.keyboard.press('Enter');
  await expect(grid.locator('[data-cell="D4"]')).toHaveText('Added');
  await waitSaved(page);
  await mode(page, 'Source');
  expect(await sourceText(page)).toContain('Keep this paragraph.');
  expect(await sourceText(page)).toContain('[Desktop](https://tauri.app)');
  expect(await sourceText(page)).toContain('Added');
});

test('ranges copy and paste quoted multiline cells, clear together and undo together', async ({
  page,
}) => {
  await freshApp(page);
  await newDocInRoot(page, 'Range selection');
  await setDoc(page, '| A | B |\n| --- | --- |\n| first | second |\n| third | fourth |\n');
  await mode(page, 'Sheet');
  const grid = page.getByTestId('sheet-grid');
  await grid.locator('[data-cell="A2"]').click();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(grid.locator('[aria-selected="true"][role="gridcell"]')).toHaveCount(4);
  const copied = await grid.evaluate((el) => {
    const clipboardData = new DataTransfer();
    el.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, clipboardData }));
    return clipboardData.getData('text/plain');
  });
  expect(copied).toBe('first\tsecond\nthird\tfourth');
  await page.keyboard.press('Delete');
  await expect(grid.locator('[data-cell="A2"]')).toHaveText('');
  await expect(grid.locator('[data-cell="B3"]')).toHaveText('');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(grid.locator('[data-cell="A2"]')).toHaveText('first');
  await expect(grid.locator('[data-cell="B3"]')).toHaveText('fourth');
  await grid.locator('[data-cell="D2"]').click();
  await grid.evaluate((el) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', '"one\ttwo"\tthree\n"line1\nline2"\tfour');
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData }));
  });
  await expect(grid.locator('[data-cell="D2"]')).toHaveText('one\ttwo');
  // Markdown serializes an in-cell newline as <br>; its display is still two lines.
  await expect(grid.locator('[data-cell="D3"]')).toHaveText('line1\nline2');
  await expect(grid.locator('[data-cell="E3"]')).toHaveText('four');
});

test('cell navigation, mouse range selection, column sizing and frozen headers work', async ({
  page,
}) => {
  await freshApp(page);
  await newDocInRoot(page, 'Navigation');
  await setDoc(
    page,
    '| Name | Description |\n| --- | --- |\n| Ada | A long description for fitting the column |\n',
  );
  await mode(page, 'Sheet');
  const grid = page.getByTestId('sheet-grid');
  const from = await grid.locator('[data-cell="A1"]').boundingBox();
  const to = await grid.locator('[data-cell="B2"]').boundingBox();
  await page.mouse.move(from!.x + 20, from!.y + 10);
  await page.mouse.down();
  await page.mouse.move(to!.x + 20, to!.y + 10, { steps: 5 });
  await page.mouse.up();
  await expect(grid.locator('[aria-selected="true"][role="gridcell"]')).toHaveCount(4);
  const resize = grid.getByRole('separator', { name: 'Resize column A', exact: true });
  const width = Number(await resize.getAttribute('aria-valuenow'));
  await resize.focus();
  await page.keyboard.press('ArrowRight');
  await expect(resize).toHaveAttribute('aria-valuenow', String(width + 16));
  await page.getByRole('textbox', { name: 'Go to cell' }).fill('Z90');
  await page.getByRole('textbox', { name: 'Go to cell' }).press('Enter');
  await expect(grid.locator('[data-cell="Z90"]')).toBeVisible();
  await expect(grid.locator('[data-cell="Z90"]')).toHaveAttribute('aria-selected', 'true');
  await expect(grid.getByRole('rowheader', { name: '1', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('textbox', { name: 'Go to cell' }).fill('A1');
  await page.getByRole('textbox', { name: 'Go to cell' }).press('Enter');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByTestId('formula-bar')).toBeVisible();
});
