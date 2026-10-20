import { expect, test, type Locator, type Page } from '@playwright/test';
import { freshApp, mode, sourceText, withoutFileSystemAccess } from './helpers';

test.beforeEach(({ page }) => withoutFileSystemAccess(page));

async function dragFile(page: Page, target: Locator, name: string, text: string, altKey = false) {
  await expect(target).toBeVisible();
  const dataTransfer = await page.evaluateHandle(
    ({ name, text }) => {
      const data = new DataTransfer();
      data.items.add(new File([text], name, { type: 'text/plain' }));
      return data;
    },
    { name, text },
  );
  await target.dispatchEvent('dragenter', { dataTransfer, altKey });
  await target.dispatchEvent('dragover', { dataTransfer, altKey });
  return {
    drop: () => target.dispatchEvent('drop', { dataTransfer, altKey }),
    leave: () => target.dispatchEvent('dragleave', { dataTransfer, clientX: 0, clientY: 0 }),
  };
}

test('document drops import separate files, and Alt-drop explicitly attaches', async ({ page }) => {
  await freshApp(page);
  await mode(page, 'Source');
  const original = await sourceText(page);
  const originalTab = page
    .getByRole('tablist', { name: 'Open documents' })
    .getByRole('tab', { selected: true });
  const originalId = await originalTab.getAttribute('data-tab-id');
  const dropped = await dragFile(
    page,
    page.locator('.cm-content'),
    'separate.txt',
    'Separate file',
  );
  await expect(page.getByTestId('drop-overlay')).toContainText('Drop files or folders to import');
  await expect(page.getByTestId('drop-overlay')).toContainText('Hold Alt to attach');
  await dropped.drop();
  await expect(page.getByText('Imported 1 file.', { exact: true })).toBeVisible();
  await expect(page.locator('.cm-content')).toHaveText('Separate file');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator(`[data-tab-id="${originalId}"]`).click();
  await expect.poll(() => sourceText(page)).toBe(original);

  const attached = await dragFile(
    page,
    page.locator('.cm-content'),
    'attachment.txt',
    'Attached',
    true,
  );
  await expect(page.getByTestId('drop-overlay')).toContainText('Drop to attach to this document');
  await attached.drop();
  await expect(page.locator('.cm-content')).toContainText(
    '[attachment.txt](./assets/attachment.txt)',
  );
  await expect(page.getByTestId('drop-overlay')).toBeHidden();
  await expect(page.getByRole('treeitem', { name: 'separate.txt' })).toBeVisible();
});

test('file drops work on tabs, portalled menus and settings without reordering tabs', async ({
  page,
}) => {
  await freshApp(page);
  await page.getByRole('treeitem', { name: 'Guides' }).click();
  await page.getByRole('treeitem', { name: 'Markdown guide.md' }).click();
  const tabs = page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
  const oldTabs = await tabs.evaluateAll((tabs) =>
    tabs.map((tab) => tab.getAttribute('data-tab-id')),
  );
  const onTab = await dragFile(page, tabs.last(), 'tab-drop.txt', 'Tab drop');
  await onTab.drop();
  await expect(page.locator('.cm-content')).toHaveText('Tab drop');
  expect(
    await tabs.evaluateAll((tabs) =>
      tabs.slice(0, -1).map((tab) => tab.getAttribute('data-tab-id')),
    ),
  ).toEqual(oldTabs);

  await page.getByRole('button', { name: 'Import', exact: true }).first().click();
  const onMenu = await dragFile(
    page,
    page.getByRole('menuitem', { name: 'Files…' }),
    'menu-drop.txt',
    'Menu drop',
  );
  await onMenu.drop();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.locator('.cm-content')).toHaveText('Menu drop');

  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  const onSettings = await dragFile(
    page,
    page.getByRole('heading', { name: 'Settings', exact: true }),
    'settings-drop.txt',
    'Settings drop',
  );
  await onSettings.drop();
  await expect(page.locator('.cm-content')).toHaveText('Settings drop');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('file drops choose the folder under the pointer in the sidebar and file list', async ({
  page,
}) => {
  await freshApp(page);
  const onSidebar = await dragFile(
    page,
    page.getByRole('treeitem', { name: 'Guides' }),
    'sidebar-drop.txt',
    'Sidebar folder drop',
  );
  await expect(page.getByTestId('drop-overlay')).toContainText('They go into Guides');
  await onSidebar.drop();
  await expect(page.locator('.cm-content')).toHaveText('Sidebar folder drop');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Guides');

  await page.getByRole('button', { name: 'Files', exact: true }).first().click();
  const onFolder = await dragFile(
    page,
    page.getByRole('main').getByRole('button', { name: /^Guides/ }),
    'folder-drop.txt',
    'File list folder drop',
  );
  await expect(page.getByTestId('drop-overlay')).toContainText('They go into Guides');
  await onFolder.drop();
  await expect(page.locator('.cm-content')).toHaveText('File list folder drop');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Guides');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('phone navigation and spreadsheet surfaces accept drops; leaving clears the overlay', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshApp(page);
  const onNav = await dragFile(
    page,
    page.getByRole('navigation', { name: 'Main' }),
    'phone.csv',
    'Name,Value\nOne,1',
  );
  await expect(page.getByTestId('drop-overlay')).toBeVisible();
  await onNav.leave();
  await expect(page.getByTestId('drop-overlay')).toBeHidden();
  await onNav.drop();
  await expect(page.getByTestId('sheet-grid')).toBeVisible();
  const onSheet = await dragFile(
    page,
    page.getByTestId('sheet-grid'),
    'sheet-drop.txt',
    'Dropped over sheet',
  );
  await onSheet.drop();
  await expect(page.locator('.cm-content')).toHaveText('Dropped over sheet');
  await expect(page.getByTestId('drop-overlay')).toBeHidden();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(0);
});

test('internal file moves and tab reordering keep their original drag behavior', async ({
  page,
}) => {
  await freshApp(page);
  await page
    .getByRole('treeitem', { name: 'Welcome to My Doc.md' })
    .dragTo(page.getByRole('treeitem', { name: 'Guides' }));
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Guides');
  await expect(page.getByTestId('drop-overlay')).toBeHidden();
  const folder = page.getByRole('treeitem', { name: 'Guides' });
  if ((await folder.getAttribute('aria-expanded')) !== 'true') await folder.click();
  await page.getByRole('treeitem', { name: 'Markdown guide.md' }).click();
  const tabs = page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
  const before = await tabs.evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-tab-id')),
  );
  await tabs.first().dragTo(tabs.last());
  await expect
    .poll(() => tabs.evaluateAll((items) => items.map((item) => item.getAttribute('data-tab-id'))))
    .toEqual([...before].reverse());
  await expect(page.getByTestId('drop-overlay')).toBeHidden();
});
