import { expect, test, type Page } from '@playwright/test';
import { freshApp, mod, newDocInRoot } from './helpers';

const row = (page: Page, name: string) => page.getByRole('treeitem', { name: `${name}.md` });
const nav = (page: Page) => page.getByRole('navigation', { name: 'Workspace' });

async function four(page: Page) {
  await freshApp(page);
  for (const n of ['Alpha', 'Bravo', 'Charlie', 'Delta']) await newDocInRoot(page, n);
}

test('shift+click selects a range, ctrl+click toggles, Escape clears', async ({ page }) => {
  await four(page);
  await row(page, 'Alpha').click();
  await row(page, 'Charlie').click({ modifiers: ['Shift'] });
  await expect(page.getByText('3 selected')).toBeVisible();
  for (const n of ['Alpha', 'Bravo', 'Charlie'])
    await expect(row(page, n)).toHaveAttribute('aria-selected', 'true');
  await expect(row(page, 'Delta')).toHaveAttribute('aria-selected', 'false');

  await row(page, 'Bravo').click({ modifiers: [mod] });
  await expect(page.getByText('2 selected')).toBeVisible();
  await expect(row(page, 'Bravo')).toHaveAttribute('aria-selected', 'false');

  await row(page, 'Alpha').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByText(/\d selected/)).toHaveCount(0);
});

test('a selection can be dragged to Favorites and Trash together', async ({ page }) => {
  await four(page);
  await row(page, 'Alpha').click();
  await row(page, 'Bravo').click({ modifiers: ['Shift'] });
  await row(page, 'Alpha').dragTo(
    nav(page).getByRole('button', { name: 'Favorites', exact: true }),
  );
  await expect(nav(page).getByRole('button', { name: 'Alpha.md', exact: true })).toBeVisible();
  await expect(nav(page).getByRole('button', { name: 'Bravo.md', exact: true })).toBeVisible();
  await expect(nav(page).getByRole('button', { name: 'Charlie.md', exact: true })).toHaveCount(0);

  await row(page, 'Bravo').dragTo(nav(page).getByRole('button', { name: /^Trash/ }));
  await expect(row(page, 'Alpha')).toHaveCount(0);
  await expect(row(page, 'Bravo')).toHaveCount(0);
  await expect(row(page, 'Charlie')).toBeVisible();
  await expect(page.getByText('2 items moved to Trash.')).toBeVisible();
});

test('bulk actions from the toolbar, context menu and Delete key', async ({ page }) => {
  await four(page);
  await row(page, 'Alpha').click();
  await row(page, 'Charlie').click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Add selected to favorites' }).click();
  await expect(nav(page).getByRole('button', { name: 'Charlie.md', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove selected from favorites' })).toBeVisible();

  await row(page, 'Bravo').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Move to…' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Remove from favorites' }).click();
  await expect(nav(page).getByRole('button', { name: 'Alpha.md', exact: true })).toHaveCount(0);

  await row(page, 'Bravo').focus();
  await page.keyboard.press('Delete');
  await expect(row(page, 'Alpha')).toHaveCount(0);
  await expect(row(page, 'Charlie')).toHaveCount(0);
  await expect(row(page, 'Delta')).toBeVisible();
});

test('ctrl+click keeps the open document in the selection; keyboard extends it', async ({
  page,
}) => {
  await four(page);
  await row(page, 'Alpha').click();
  await row(page, 'Charlie').click({ modifiers: [mod] });
  await expect(page.getByText('2 selected')).toBeVisible();
  await row(page, 'Delta').click();
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Shift+ArrowUp');
  await expect(page.getByText('3 selected')).toBeVisible();
  await expect(row(page, 'Bravo')).toHaveAttribute('aria-selected', 'true');
});
