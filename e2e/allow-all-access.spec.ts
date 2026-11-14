import { expect, test } from '@playwright/test';
import { freshApp, waitSaved } from './helpers';

/**
 * Three files imported with permission the browser won't give back by itself (as after a
 * restart). One picked folder must restore all of them.
 */
test('Allow all restores many files with one folder pick', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const disks: Record<string, string> = { 'a.md': '# A\n', 'b.md': '# B\n', 'c.md': '# C\n' };
    w.__disks = disks;
    w.__picks = 0;
    const make = (name: string, allowed: boolean) => ({
      kind: 'file',
      name,
      getFile: async () => new File([disks[name]!], name, { lastModified: 1_700_000_000_000 }),
      createWritable: async () => {
        if (!allowed) throw new DOMException('denied', 'NotAllowedError');
        let next = '';
        return {
          write: async (t: string) => void (next = t),
          close: async () => void (disks[name] = next),
        };
      },
      queryPermission: async () => (allowed ? 'granted' : 'prompt'),
      requestPermission: async () => (allowed ? 'granted' : 'prompt'),
    });
    const originals = Object.keys(disks).map((n) => make(n, false));
    w.showOpenFilePicker = async () => originals;
    w.showDirectoryPicker = async () => {
      (w.__picks as number)++;
      return {
        kind: 'directory',
        name: 'projects',
        queryPermission: async () => 'granted',
        requestPermission: async () => 'granted',
        resolve: async (h: { name: string }) =>
          originals.includes(h as never) ? ['docs', h.name] : null,
        getDirectoryHandle: async () => ({
          getFileHandle: async (n: string) => make(n, true),
        }),
      };
    };
  });
  await freshApp(page);
  await page.getByRole('button', { name: 'Import' }).first().click();
  await page.getByRole('menuitem', { name: 'Files…' }).click();
  await expect(page.getByText(/^Imported 3 files/)).toBeVisible();

  const banner = page.getByRole('region', { name: 'Disk access' });
  await expect(banner).toContainText('3 linked files need permission');
  await banner.getByRole('button', { name: 'Allow all' }).click();

  await expect(banner).toBeHidden();
  await expect(page.getByText('Allowed access to 3 linked items.')).toBeVisible();
  expect(await page.evaluate(() => (window as never as { __picks: number }).__picks)).toBe(1);

  // Saving now reaches the file on disk.
  await page.getByRole('treeitem', { name: 'b.md' }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('edited');
  await waitSaved(page);
  await expect
    .poll(() =>
      page.evaluate(() => (window as never as { __disks: Record<string, string> }).__disks['b.md']),
    )
    .toContain('edited');
});

test('the details dialog explains the single choice and its button does the same', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const make = (name: string) => ({
      kind: 'file',
      name,
      getFile: async () => new File(['x'], name, { lastModified: 1 }),
      queryPermission: async () => 'prompt',
      requestPermission: async () => 'prompt',
    });
    const files = ['a.md', 'b.md'].map(make);
    w.showOpenFilePicker = async () => files;
    w.__picks = 0;
    w.showDirectoryPicker = async () => {
      (w.__picks as number)++;
      throw new DOMException('cancelled', 'AbortError');
    };
  });
  await freshApp(page);
  await page.getByRole('button', { name: 'Import' }).first().click();
  await page.getByRole('menuitem', { name: 'Files…' }).click();
  await expect(page.getByText(/^Imported 2 files/)).toBeVisible();
  await page
    .getByRole('region', { name: 'Disk access' })
    .getByRole('button', { name: 'Details' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Allow access to your files' });
  await expect(dialog).toContainText('2 linked items');
  await expect(dialog).toContainText('Choose the folder that contains them');
  await dialog.getByRole('button', { name: 'Allow all' }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => (window as never as { __picks: number }).__picks)).toBe(1);
  // The app stays usable: nothing is waiting on the browser.
  await expect(page.getByRole('region', { name: 'Disk access' })).toBeVisible();
});
