import { expect, test, type Page } from '@playwright/test';
import { freshApp, mod } from './helpers';

// A 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function openNotes(page: Page) {
  await page
    .getByRole('link', { name: 'Notes' })
    .or(page.getByRole('button', { name: 'Notes' }))
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Notes', level: 1 })).toBeVisible();
}

async function addNote(page: Page, title: string, body: string) {
  await page.getByRole('button', { name: 'Take a note…' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill(title);
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill(body);
  await page.getByTestId('note-composer').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('note-card').filter({ hasText: title })).toBeVisible();
}

const card = (page: Page, text: string) => page.getByTestId('note-card').filter({ hasText: text });

test.beforeEach(async ({ page }) => {
  await freshApp(page);
  await openNotes(page);
});

test('writes a note, keeps it after a reload, and edits it in place', async ({ page }) => {
  await addNote(page, 'Groceries', 'milk and eggs');
  await page.reload();
  await expect(card(page, 'Groceries')).toContainText('milk and eggs');

  await card(page, 'Groceries')
    .getByRole('button', { name: /Open note/ })
    .click();
  const dialog = page.getByTestId('note-dialog');
  await dialog.getByRole('textbox', { name: 'Note', exact: true }).fill('milk, eggs and bread');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(card(page, 'Groceries')).toContainText('bread');
  // It is an ordinary document in the Notes folder.
  await page.getByRole('treeitem', { name: 'Notes' }).first().click();
  await expect(page.getByRole('treeitem', { name: 'Groceries.md' })).toBeVisible();
});

test('checklists: add items, check one, see the completed count', async ({ page }) => {
  await page.getByRole('button', { name: 'New list' }).click();
  const form = page.getByTestId('note-composer');
  await form.getByRole('textbox', { name: 'Title' }).fill('Trip');
  await form.getByRole('textbox', { name: 'List item' }).fill('passport');
  await page.keyboard.press('Enter');
  await page.keyboard.type('tickets');
  await form.getByRole('button', { name: 'Close' }).click();
  const trip = card(page, 'Trip');
  await expect(trip.getByRole('checkbox')).toHaveCount(2);
  await trip.getByRole('checkbox', { name: /passport/ }).click();
  await expect(trip).toContainText('1 completed item');
  await expect(trip.getByRole('checkbox')).toHaveCount(1);
});

test('pin, color, label, archive and search', async ({ page }) => {
  await addNote(page, 'Alpha', 'first');
  await addNote(page, 'Beta', 'second');
  await card(page, 'Beta').hover();
  await card(page, 'Beta').getByRole('button', { name: 'Pin note' }).click();
  await expect(page.getByRole('region', { name: 'Pinned notes' })).toContainText('Beta');

  await card(page, 'Alpha').hover();
  await card(page, 'Alpha').getByRole('button', { name: 'Background options' }).click();
  await page.getByRole('menuitemradio', { name: 'Mint' }).click();
  await expect(card(page, 'Alpha')).toHaveAttribute('data-color', 'mint');

  await card(page, 'Alpha').getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Add label' }).click();
  await page.getByRole('menuitem', { name: 'Create label…' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Work stuff');
  await page.keyboard.press('Enter');
  await expect(card(page, 'Alpha')).toContainText('work-stuff');
  await page
    .getByRole('navigation', { name: 'Notes sections' })
    .getByRole('button', { name: 'work-stuff' })
    .click();
  await expect(card(page, 'Alpha')).toBeVisible();
  await expect(card(page, 'Beta')).toHaveCount(0);
  await openNotes(page);

  await page.getByRole('searchbox', { name: 'Search notes' }).fill('second');
  await expect(card(page, 'Beta')).toBeVisible();
  await expect(card(page, 'Alpha')).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search notes' }).fill('');

  await card(page, 'Alpha').hover();
  await card(page, 'Alpha').getByRole('button', { name: 'Archive' }).click();
  await expect(card(page, 'Alpha')).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Notes sections' })
    .getByRole('button', { name: 'Archive' })
    .click();
  await expect(card(page, 'Alpha')).toBeVisible();
});

test('delete goes to Trash and can be restored', async ({ page }) => {
  await addNote(page, 'Temp', 'short lived');
  await card(page, 'Temp').getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Delete note' }).click();
  await expect(card(page, 'Temp')).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Notes sections' })
    .getByRole('button', { name: /^Trash/ })
    .click();
  await expect(card(page, 'Temp')).toBeVisible();
  await card(page, 'Temp').getByRole('button', { name: 'Restore note' }).click();
  await openNotes(page);
  await expect(card(page, 'Temp')).toBeVisible();
});

test('reminders: set one, and a past one fires', async ({ page }) => {
  await addNote(page, 'Call Sam', 'about the lease');
  await card(page, 'Call Sam').getByRole('button', { name: 'Remind me' }).click();
  await page.getByRole('menuitem', { name: /Tomorrow morning/ }).click();
  await expect(card(page, 'Call Sam')).toContainText('Tomorrow');
  await page
    .getByRole('navigation', { name: 'Notes sections' })
    .getByRole('button', { name: 'Reminders' })
    .click();
  await expect(card(page, 'Call Sam')).toBeVisible();

  await card(page, 'Call Sam').getByRole('button', { name: 'Remind me' }).click();
  await page.getByRole('menuitem', { name: 'Pick date & time…' }).click();
  await page.getByLabel('Date and time').fill('2020-01-01T09:00');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Reminder: Call Sam')).toBeVisible();
});

test('images attach to a note', async ({ page }) => {
  await addNote(page, 'Pic', 'with a picture');
  await card(page, 'Pic').locator('input[type=file]').setInputFiles({
    name: 'dot.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expect(card(page, 'Pic').locator('img')).toHaveCount(1);
});

test('drag a note to reorder, and quick capture from anywhere', async ({ page }) => {
  await addNote(page, 'One', 'a');
  await addNote(page, 'Two', 'b');
  const titles = () => page.getByTestId('note-card').locator('h3').allTextContents();
  expect(await titles()).toEqual(['Two', 'One']);
  await card(page, 'One').dragTo(card(page, 'Two'));
  await expect.poll(titles).toEqual(['One', 'Two']);

  await page
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('button', { name: 'Home' })
    .click();
  await page.keyboard.press('Alt+K');
  const quick = page.getByTestId('note-dialog');
  await quick.getByRole('textbox', { name: 'Title' }).fill('Idea');
  await quick.getByRole('textbox', { name: 'Note', exact: true }).fill('captured fast');
  await page.keyboard.press('Escape');
  await expect(page.getByText('Note saved.')).toBeVisible();
  await openNotes(page);
  await expect(card(page, 'Idea')).toBeVisible();
  void mod;
});
