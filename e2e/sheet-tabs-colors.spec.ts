import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { freshApp, mod, withoutFileSystemAccess } from './helpers';

test.beforeEach(({ page }) => withoutFileSystemAccess(page));

const fixture = (name: string) => readFileSync(resolve(process.cwd(), 'fixtures', name));
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function importFile(page: Page, name: string, mimeType: string) {
  await page.getByRole('button', { name: 'Import' }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Files…' }).click();
  await (await chooser).setFiles({ name, mimeType, buffer: fixture(name) });
  await expect(page.getByText(/Imported 1 file/).last()).toBeVisible();
  await page.getByRole('treeitem', { name }).click();
}

/** Opens the palette of a ribbon button and picks one of its standard colors. */
async function pick(page: Page, button: 'Fill color' | 'Text color', color: string) {
  await page.getByRole('button', { name: button }).click();
  await page
    .getByTestId('color-palette')
    .locator(`[data-swatch="palette"][data-color="${color}"]`)
    .click();
  await expect(page.getByTestId('color-palette')).toBeHidden();
}

const SHOTS = process.env.SHOTS_DIR;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(450); // menus and popovers finish animating
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`) });
}

const tabs = (page: Page) => page.getByTestId('sheet-tabs');
const tab = (page: Page, name: string) => tabs(page).getByRole('tab', { name, exact: true });
const colHead = (page: Page, letter: string) =>
  page
    .getByTestId('sheet-grid')
    .getByRole('columnheader', { name: new RegExp(`^${letter} Resize`) });
const tabNames = (page: Page) => tabs(page).getByRole('tab').allTextContents();

test.describe('Excel workbooks', () => {
  test.beforeEach(async ({ page }) => {
    await freshApp(page);
    await importFile(page, 'sales.xlsx', XLSX);
    await expect(tab(page, 'Sales 2026')).toBeVisible();
  });

  test('add, rename, duplicate, color, reorder and delete sheets, with undo', async ({ page }) => {
    expect(await tabNames(page)).toEqual(['Sales 2026', 'Notes']);

    // Add: a new empty sheet opens after the current one.
    await tabs(page).getByRole('button', { name: 'Add sheet' }).click();
    expect(await tabNames(page)).toEqual(['Sales 2026', 'Sheet3', 'Notes']);
    await expect(tab(page, 'Sheet3')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('sheet-grid').locator('[data-cell="A1"]').click();
    await page.keyboard.type('hello');
    await page.keyboard.press('Enter');

    // Rename by double-click; formulas that name the sheet follow (checked in unit tests).
    await tab(page, 'Sheet3').dblclick();
    const rename = tabs(page).getByRole('textbox', { name: 'Sheet name' });
    await rename.fill('Budget');
    await rename.press('Enter');
    expect(await tabNames(page)).toEqual(['Sales 2026', 'Budget', 'Notes']);
    // Escape leaves the name alone.
    await tab(page, 'Budget').dblclick();
    await tabs(page).getByRole('textbox', { name: 'Sheet name' }).fill('Nope');
    await page.keyboard.press('Escape');
    expect(await tabNames(page)).toEqual(['Sales 2026', 'Budget', 'Notes']);

    // Duplicate from the context menu: the copy keeps the data and opens.
    await tab(page, 'Budget').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    expect(await tabNames(page)).toEqual(['Sales 2026', 'Budget', 'Copy of Budget', 'Notes']);
    await expect(page.getByTestId('sheet-grid').locator('[data-cell="A1"]')).toHaveText('hello');

    // Tab color.
    await tab(page, 'Budget').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Tab color' }).click();
    await page.getByRole('menuitemradio', { name: 'orange' }).click();
    await expect(tab(page, 'Budget')).toHaveCSS('box-shadow', /rgb\(255, 153, 0\)/);

    // Reorder with the menu, with the keyboard and by dragging.
    await tab(page, 'Notes').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move left' }).click();
    expect(await tabNames(page)).toEqual(['Sales 2026', 'Budget', 'Notes', 'Copy of Budget']);
    await tab(page, 'Notes').focus();
    await page.keyboard.press('Alt+Shift+ArrowLeft');
    expect(await tabNames(page)).toEqual(['Sales 2026', 'Notes', 'Budget', 'Copy of Budget']);
    await tab(page, 'Copy of Budget').dragTo(tab(page, 'Sales 2026'));
    expect(await tabNames(page)).toEqual(['Copy of Budget', 'Sales 2026', 'Notes', 'Budget']);

    // Delete asks first; Cancel keeps the sheet.
    await tab(page, 'Copy of Budget').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const confirm = page.getByRole('dialog', { name: /Delete “Copy of Budget”/ });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    expect(await tabNames(page)).toHaveLength(4);
    await tab(page, 'Copy of Budget').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete sheet' }).click();
    expect(await tabNames(page)).toEqual(['Sales 2026', 'Notes', 'Budget']);

    // One undo brings the deleted sheet back, and the sheet list survives a reload.
    await page.getByRole('button', { name: 'Undo' }).click();
    expect(await tabNames(page)).toEqual(['Copy of Budget', 'Sales 2026', 'Notes', 'Budget']);
    await page.getByRole('button', { name: 'Redo' }).click();
    await expect(page.getByTestId('sheet-save-status')).toHaveText('Saved');
    await page.reload();
    await page.getByRole('treeitem', { name: 'sales.xlsx' }).click();
    await expect(tab(page, 'Budget')).toBeVisible();
    expect(await tabNames(page)).toEqual(['Sales 2026', 'Notes', 'Budget']);
    await expect(tab(page, 'Budget')).toHaveCSS('box-shadow', /rgb\(255, 153, 0\)/);
  });

  test('the last sheet cannot be deleted', async ({ page }) => {
    for (const name of ['Notes', 'Sales 2026']) {
      await tabs(page).getByRole('tab', { name }).click({ button: 'right' });
      const del = page.getByRole('menuitem', { name: 'Delete' });
      if (name === 'Notes') {
        await del.click();
        await page.getByRole('dialog').getByRole('button', { name: 'Delete sheet' }).click();
      } else await expect(del).toBeDisabled();
    }
    await page.keyboard.press('Escape');
    expect(await tabNames(page)).toEqual(['Sales 2026']);
  });

  test('fills and text colors apply to cells, rows and columns, and are saved in the file', async ({
    page,
  }) => {
    const grid = page.getByTestId('sheet-grid');
    // A range of cells.
    await grid.locator('[data-cell="B2"]').click();
    await page.keyboard.press('Shift+ArrowDown');
    await pick(page, 'Fill color', '#ffff00');
    await expect(grid.locator('[data-cell="B2"]')).toHaveCSS(
      'background-color',
      'rgb(255, 255, 0)',
    );
    await expect(grid.locator('[data-cell="B3"]')).toHaveCSS(
      'background-color',
      'rgb(255, 255, 0)',
    );
    await expect(grid.locator('[data-cell="B4"]')).not.toHaveCSS(
      'background-color',
      'rgb(255, 255, 0)',
    );
    // Text stays readable on the fill without choosing a text color.
    await expect(grid.locator('[data-cell="B2"]')).toHaveCSS('color', 'rgb(31, 31, 31)');
    await pick(page, 'Text color', '#0000ff');
    await expect(grid.locator('[data-cell="B2"]')).toHaveCSS('color', 'rgb(0, 0, 255)');

    // Clicking a row number selects the row; the color then goes to the whole row.
    await grid.getByRole('rowheader', { name: '4', exact: true }).click();
    await expect(page.getByLabel('Selected cell')).toContainText('A4:');
    await expect(grid.getByRole('rowheader', { name: '4', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await pick(page, 'Fill color', '#cfe2f3');
    for (const a of ['A4', 'C4', 'F4'])
      await expect(grid.locator(`[data-cell="${a}"]`)).toHaveCSS(
        'background-color',
        'rgb(207, 226, 243)',
      );

    // A column header selects the column.
    await colHead(page, 'C').click();
    await pick(page, 'Fill color', '#d9ead3');
    await expect(grid.locator('[data-cell="C2"]')).toHaveCSS(
      'background-color',
      'rgb(217, 234, 211)',
    );
    // Painted after the row, so it wins where they cross.
    await expect(grid.locator('[data-cell="C4"]')).toHaveCSS(
      'background-color',
      'rgb(217, 234, 211)',
    );
    await expect(grid.locator('[data-cell="A4"]')).toHaveCSS(
      'background-color',
      'rgb(207, 226, 243)',
    );

    // A selected cell inside a painted range still shows it is selected.
    await grid.locator('[data-cell="B2"]').click();
    await page.keyboard.press('Shift+ArrowDown');
    await expect(grid.locator('[data-cell="B3"]')).toHaveClass(/is-in-range/);

    // None clears.
    await grid.locator('[data-cell="B2"]').click();
    await page.keyboard.press('Shift+ArrowDown');
    await page.getByRole('button', { name: 'Fill color' }).click();
    await page.getByTestId('color-none').click();
    await expect(grid.locator('[data-cell="B2"]')).not.toHaveCSS(
      'background-color',
      'rgb(255, 255, 0)',
    );

    // Undo and redo cover colors like any edit.
    await page.keyboard.press(`${mod}+z`);
    await expect(grid.locator('[data-cell="B2"]')).toHaveCSS(
      'background-color',
      'rgb(255, 255, 0)',
    );

    // Recent colors show first the next time the palette opens.
    await page.getByRole('button', { name: 'Fill color' }).click();
    await expect(
      page.getByRole('group', { name: 'Recent colors' }).locator('[data-color="#d9ead3"]'),
    ).toBeVisible();
    await page.keyboard.press('Escape');

    // The colors are in the saved .xlsx: they survive a reload.
    await expect(page.getByTestId('sheet-save-status')).toHaveText('Saved');
    await page.reload();
    await page.getByRole('treeitem', { name: 'sales.xlsx' }).click();
    await expect(grid.locator('[data-cell="B2"]')).toHaveCSS(
      'background-color',
      'rgb(255, 255, 0)',
    );
    await expect(grid.locator('[data-cell="F4"]')).toHaveCSS(
      'background-color',
      'rgb(207, 226, 243)',
    );
    await expect(grid.locator('[data-cell="C9"]')).toHaveCSS(
      'background-color',
      'rgb(217, 234, 211)',
    );
  });

  test('the palette works from the keyboard and rejects a bad custom color', async ({ page }) => {
    const grid = page.getByTestId('sheet-grid');
    await grid.locator('[data-cell="A2"]').click();
    const fill = page.getByRole('button', { name: 'Fill color' });
    await fill.focus();
    await page.keyboard.press('Enter');
    const palette = page.getByTestId('color-palette');
    await expect(palette.locator('[data-swatch="palette"]').first()).toBeFocused();
    await page.keyboard.press('ArrowDown'); // next row of the palette
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(palette).toBeHidden();
    await expect(fill).toBeFocused();
    await expect(grid.locator('[data-cell="A2"]')).toHaveCSS('background-color', 'rgb(255, 0, 0)');

    await fill.click();
    await palette.getByLabel('Custom color, hex').fill('nope');
    await palette.getByRole('button', { name: 'Apply' }).click();
    await expect(palette.getByRole('alert')).toBeVisible();
    await palette.getByLabel('Custom color, hex').fill('#123456');
    await palette.getByRole('button', { name: 'Apply' }).click();
    await expect(grid.locator('[data-cell="A2"]')).toHaveCSS('background-color', 'rgb(18, 52, 86)');
    // Dark fill: the text turns white by itself.
    await expect(grid.locator('[data-cell="A2"]')).toHaveCSS('color', 'rgb(255, 255, 255)');
  });

  test('Shift+Space selects the row and Ctrl+Space the column', async ({ page }) => {
    const grid = page.getByTestId('sheet-grid');
    await grid.locator('[data-cell="B3"]').click();
    await page.keyboard.press('Shift+Space');
    await expect(page.getByLabel('Selected cell')).toContainText('A3:');
    await page.keyboard.press('Control+Space');
    await expect(page.getByLabel('Selected cell')).toContainText('A1:A');
  });
});

test.describe('UNL, CSV and Markdown sheets', () => {
  test('click a row number to select the row; right-click for the row menu', async ({ page }) => {
    await freshApp(page);
    await importFile(page, 'transactions.unl', 'application/octet-stream');
    const grid = page.getByTestId('sheet-grid');
    await grid.getByRole('rowheader', { name: '2', exact: true }).click();
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(page.getByLabel('Selected cell')).toHaveText('A2:Q2');
    // Selecting a row does not scroll to its far end.
    await expect(grid.locator('[data-cell="A2"]')).toBeInViewport();
    await expect(grid.locator('[data-cell="Q2"]')).toHaveAttribute('aria-selected', 'true');
    // Shift-click extends to more rows; the sum bar sees them.
    await grid.getByRole('rowheader', { name: '4', exact: true }).click({ modifiers: ['Shift'] });
    await expect(page.getByLabel('Selected cell')).toHaveText('A2:Q4');
    // The menu acts on the selected rows.
    await grid.getByRole('rowheader', { name: '3', exact: true }).click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Delete rows 2–4' })).toBeVisible();
    await page.keyboard.press('Escape');
    await shot(page, 'row-selected');
  });

  test('colors are saved with the document, not in the file, and can be undone', async ({
    page,
  }) => {
    await freshApp(page);
    await importFile(page, 'transactions.unl', 'application/octet-stream');
    const grid = page.getByTestId('sheet-grid');
    const first = fixture('transactions.unl').toString('utf8').split('\n')[0];

    await grid.getByRole('rowheader', { name: '2', exact: true }).click();
    await pick(page, 'Fill color', '#fff2cc');
    for (const a of ['A2', 'Q2'])
      await expect(grid.locator(`[data-cell="${a}"]`)).toHaveCSS(
        'background-color',
        'rgb(255, 242, 204)',
      );
    await colHead(page, 'F').click();
    await pick(page, 'Text color', '#cc0000');
    await expect(grid.locator('[data-cell="F5"]')).toHaveCSS('color', 'rgb(204, 0, 0)');

    // The file's text is untouched.
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await expect(page.locator('.cm-content .cm-line').first()).toHaveText(first!);
    await page.getByRole('button', { name: 'Sheet', exact: true }).click();

    // Inserting a row above moves the color down with its row.
    await grid.getByRole('rowheader', { name: '1', exact: true }).click();
    await page.getByRole('button', { name: 'Insert row above' }).click();
    await expect(grid.locator('[data-cell="A3"]')).toHaveCSS(
      'background-color',
      'rgb(255, 242, 204)',
    );
    await expect(grid.locator('[data-cell="A2"]')).not.toHaveCSS(
      'background-color',
      'rgb(255, 242, 204)',
    );
    // One undo undoes the text change and the moved colors together.
    await page.keyboard.press(`${mod}+z`);
    await expect(grid.locator('[data-cell="A2"]')).toHaveCSS(
      'background-color',
      'rgb(255, 242, 204)',
    );

    // They come back after a reload.
    await page.waitForTimeout(700);
    await page.reload();
    await page.getByRole('treeitem', { name: 'transactions.unl' }).click();
    await expect(grid.locator('[data-cell="A2"]')).toHaveCSS(
      'background-color',
      'rgb(255, 242, 204)',
    );
    await expect(grid.locator('[data-cell="F5"]')).toHaveCSS('color', 'rgb(204, 0, 0)');
  });

  test('adding a sheet to a UNL file offers an Excel workbook and keeps the colors', async ({
    page,
  }) => {
    await freshApp(page);
    await importFile(page, 'transactions.unl', 'application/octet-stream');
    const grid = page.getByTestId('sheet-grid');
    await grid.getByRole('rowheader', { name: '2', exact: true }).click();
    await pick(page, 'Fill color', '#fff2cc');
    await expect(tabs(page).getByRole('tab')).toHaveText(['Sheet1']);
    await tabs(page).getByRole('button', { name: 'Add sheet' }).click();
    const ask = page.getByRole('dialog', { name: 'Add a sheet' });
    await expect(ask).toContainText('hold a single sheet');
    await shot(page, 'unl-add-sheet');
    await ask.getByRole('button', { name: 'Make workbook…' }).click();
    const dialog = page.getByRole('dialog', { name: /Convert or export/ });
    await expect(dialog.getByRole('radio', { name: /Excel workbook/ })).toBeChecked();
    await expect(dialog.getByTestId('conversion-preview').locator('[data-cell="A2"]')).toHaveCSS(
      'background-color',
      'rgb(255, 242, 204)',
    );
  });

  test('Markdown tables keep colors per table', async ({ page }) => {
    await freshApp(page);
    await page
      .getByRole('button', { name: 'New document', exact: true })
      .first()
      .click({ modifiers: ['Shift'] });
    await page.locator('.cm-content').click();
    await page.keyboard.insertText(
      '| Item | Qty |\n| --- | --- |\n| Pen | 3 |\n\n| Name |\n| --- |\n| Ada |\n',
    );
    await page
      .getByRole('group', { name: 'View mode' })
      .getByRole('button', { name: 'Sheet', exact: true })
      .click();
    const grid = page.getByTestId('sheet-grid');
    await grid.locator('[data-cell="B2"]').click();
    await pick(page, 'Fill color', '#d9ead3');
    await expect(grid.locator('[data-cell="B2"]')).toHaveCSS(
      'background-color',
      'rgb(217, 234, 211)',
    );
    // The second, stacked table has its own colors.
    await expect(grid.locator('[data-cell="A6"]')).not.toHaveCSS(
      'background-color',
      'rgb(217, 234, 211)',
    );
    // No sheet tabs for Markdown: its tables are already shown together.
    await expect(tabs(page)).toHaveCount(0);
  });
});

test.describe('phone', () => {
  test.use({ hasTouch: true });

  test('tabs and colors fit and work on a phone', async ({ page }) => {
    await freshApp(page);
    await importFile(page, 'sales.xlsx', XLSX);
    await page.setViewportSize({ width: 393, height: 780 });
    await expect(tab(page, 'Notes')).toBeVisible();
    // Sheet options replace right-click.
    await tabs(page).getByRole('button', { name: 'Sheet options' }).tap();
    await expect(page.getByRole('menuitem', { name: 'Duplicate' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Duplicate' }).tap();
    await expect(tab(page, 'Copy of Sales 2026')).toBeVisible();
    await page.getByTestId('sheet-grid').locator('[data-cell="B2"]').tap();
    await page.getByRole('button', { name: 'Fill color' }).tap();
    const palette = page.getByTestId('color-palette');
    const box = await palette.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(393);
    await palette.locator('[data-swatch="palette"][data-color="#ffe599"]').tap();
    await expect(page.getByTestId('sheet-grid').locator('[data-cell="B2"]')).toHaveCSS(
      'background-color',
      'rgb(255, 229, 153)',
    );
    await shot(page, 'phone-tabs-colors');
  });
});

const DEVICES = {
  desktop: { width: 1366, height: 768 },
  tablet: { width: 820, height: 1000 },
  phone: { width: 393, height: 780 },
} as const;

test.describe('screenshots', () => {
  test.skip(!SHOTS, 'set SHOTS_DIR to take screenshots');

  for (const theme of ['light', 'dark'] as const)
    for (const [device, size] of Object.entries(DEVICES)) {
      test(`workbook with colors, ${theme} ${device}`, async ({ page }) => {
        await page.addInitScript((t) => {
          localStorage.setItem('mydoc:settings', JSON.stringify({ theme: t }));
        }, theme);
        await freshApp(page);
        await importFile(page, 'sales.xlsx', XLSX);
        await page.setViewportSize(size);
        const grid = page.getByTestId('sheet-grid');
        await tabs(page).getByRole('button', { name: 'Add sheet' }).click();
        await tab(page, 'Sheet3').click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Tab color' }).click();
        await page.getByRole('menuitemradio', { name: 'green' }).click();
        await tab(page, 'Sales 2026').click();
        await grid.getByRole('rowheader', { name: '1', exact: true }).click();
        await pick(page, 'Fill color', '#073763');
        await pick(page, 'Text color', '#ffffff');
        await grid.locator('[data-cell="E2"]').click();
        await page.keyboard.press('Shift+ArrowDown');
        await pick(page, 'Fill color', '#ffe599');
        await colHead(page, 'G').click();
        await pick(page, 'Fill color', '#d9ead3');
        await grid.locator('[data-cell="B3"]').click();
        await shot(page, `${device}-${theme}-1-workbook`);
        await page.getByRole('button', { name: 'Fill color' }).click();
        await shot(page, `${device}-${theme}-2-palette`);
        await page.keyboard.press('Escape');
        await tab(page, 'Sales 2026').click({ button: 'right' });
        await shot(page, `${device}-${theme}-3-tab-menu`);
      });
    }
});
