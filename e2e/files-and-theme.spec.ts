import { expect, test } from '@playwright/test';
import {
  disk,
  fakeDisk,
  freshApp,
  importViaPicker,
  waitSaved,
  withoutFileSystemAccess,
} from './helpers';

test('edits to an imported file are saved back to the original file', async ({ page }) => {
  await fakeDisk(page, 'notes.txt', 'first line\n', 'granted');
  await freshApp(page);
  await importViaPicker(page, 'notes.txt');
  await expect(page.getByTestId('disk-status')).toBeVisible();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('added on the go');
  await waitSaved(page);
  await expect.poll(() => disk(page)).toBe('first line\nadded on the go');
});

test('asks for permission before writing to disk', async ({ page }) => {
  await fakeDisk(page, 'todo.md', '# Todo\n', 'prompt');
  await freshApp(page);
  await importViaPicker(page, 'todo.md');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('- [ ] call Sam');
  await waitSaved(page);
  expect(await disk(page)).toBe('# Todo\n');
  await page.getByRole('button', { name: 'Allow saving to disk' }).click();
  await expect(page.getByTestId('disk-status')).toBeVisible();
  await expect.poll(() => disk(page)).toBe('# Todo\n- [ ] call Sam');
});

test('dotfiles and unfamiliar text files open in the editor', async ({ page }) => {
  await withoutFileSystemAccess(page);
  await freshApp(page);
  await page.getByRole('button', { name: 'Import' }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Files…' }).click();
  await (
    await chooser
  ).setFiles({ name: '.editorconfig', mimeType: '', buffer: Buffer.from('root = true\n') });
  await page.getByRole('treeitem', { name: '.editorconfig' }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('[*]');
  await expect(page.locator('.cm-content')).toContainText('root = true[*]');
  await waitSaved(page);
});

test('the theme toggle switches themes, and line numbers follow', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('mydoc:settings', JSON.stringify({ theme: 'light', lineNumbers: true })),
  );
  await freshApp(page);
  await page
    .getByRole('button', { name: 'New document', exact: true })
    .first()
    .click({ modifiers: ['Shift'] });
  await page.keyboard.type('one\ntwo');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  // The gutter uses the dark canvas, not CodeMirror's light grey default.
  const gutterBg = await page
    .locator('.cm-gutters')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(gutterBg).toBe('rgb(28, 29, 33)');
  // Line numbers sit right next to the text.
  const gap = await page.evaluate(() => {
    const gutter = document.querySelector('.cm-gutters')!.getBoundingClientRect();
    const text = document.querySelector('.cm-line')!.getBoundingClientRect();
    return text.left - gutter.right;
  });
  expect(gap).toBeLessThan(24);
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
});

test('the theme menu switches palettes, the gutter follows, and the choice survives a reload', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('mydoc:settings', JSON.stringify({ theme: 'dark', lineNumbers: true }));
    }
  });
  await freshApp(page);
  await page
    .getByRole('button', { name: 'New document', exact: true })
    .first()
    .click({ modifiers: ['Shift'] });
  await page.keyboard.type('one\ntwo');
  const html = page.locator('html');
  const colors = () =>
    page.evaluate(() => ({
      gutter: getComputedStyle(document.querySelector('.cm-gutters')!).backgroundColor,
      canvas: getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim(),
    }));

  await page.getByRole('button', { name: 'Change theme' }).click();
  await page.getByRole('menuitemradio', { name: 'Nord' }).click();
  await expect(html).toHaveAttribute('data-palette', 'nord');
  expect((await colors()).canvas).toBe('#2e3440');
  expect((await colors()).gutter).toBe('rgb(46, 52, 64)');

  // Light mode from the same menu keeps the palette.
  await page.getByRole('button', { name: 'Change theme' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Nord' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('menuitemradio', { name: 'Light' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  expect((await colors()).gutter).toBe('rgb(236, 239, 244)');

  // Applied before first paint on reload.
  await page.reload();
  await expect(html).toHaveAttribute('data-palette', 'nord');
  await expect(html).toHaveAttribute('data-theme', 'light');

  // Back to Classic from Settings removes the attribute.
  await page.goto('/#/settings');
  await page.getByRole('radio', { name: /Classic/ }).click();
  await expect(html).not.toHaveAttribute('data-palette', /.+/);
});

test('Settings has a Back button and Ctrl+Alt+Left/Right walk navigation history', async ({
  page,
}) => {
  await freshApp(page);
  await page.goto('/#/recent');
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/#\/recent$/);
  await page.keyboard.press('Control+Alt+ArrowRight');
  await expect(page).toHaveURL(/#\/settings$/);
  await page.keyboard.press('Control+Alt+ArrowLeft');
  await expect(page).toHaveURL(/#\/recent$/);
});
