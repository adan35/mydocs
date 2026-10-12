import { expect, test } from '@playwright/test';

test('phone layout uses bottom navigation and full-screen views', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to My Doc' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav).toBeVisible();
  await nav.getByRole('button', { name: 'Files' }).click();
  await page.getByRole('main').getByRole('button', { name: 'Guides', exact: true }).click();
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Markdown guide.md', exact: true })
    .click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('.prose h1')).toHaveText(/Markdown guide/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('phone: usable filter box, and toasts never cover an open sheet', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to My Doc' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('button', { name: 'Files' }).click();
  const filter = page.getByRole('searchbox', { name: 'Filter by name' });
  expect((await filter.boundingBox())!.width).toBeGreaterThan(200);

  // Trash a document (shows an Undo toast), then open the More sheet straight away.
  await page.getByRole('main').getByRole('button', { name: 'Guides', exact: true }).click();
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Markdown guide.md', exact: true })
    .click();
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
  await expect(page.getByText(/moved to Trash/)).toBeVisible();
  await nav.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});

test('phone: the PDF export preview fits the dialog', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to My Doc' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Files' })
    .click();
  await page.getByRole('main').getByRole('button', { name: 'Guides', exact: true }).click();
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Markdown guide.md', exact: true })
    .click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: /Convert or export/ }).click();
  const dialog = page.getByRole('dialog', { name: /Convert or export/ });
  await dialog.getByRole('radio', { name: /^PDF/ }).click();
  const preview = dialog.getByTestId('pdf-preview');
  await expect(preview.locator('canvas').first()).toBeVisible();
  const fit = await preview.evaluate((el) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
    page: el.querySelector('[data-page]')!.getBoundingClientRect().width,
  }));
  expect(fit.scroll).toBeLessThanOrEqual(fit.client);
  expect(fit.page).toBeLessThanOrEqual(fit.client);
});
