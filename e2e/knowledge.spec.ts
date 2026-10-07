import { expect, test } from '@playwright/test';
import { freshApp, mod, newDocInRoot, typeInEditor, waitSaved } from './helpers';

test("today's daily note opens with one shortcut and isn't duplicated", async ({ page }) => {
  await freshApp(page);
  await page.locator('body').press(`${mod}+Shift+D`);
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const name = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}.md`;
  await expect(page.getByRole('tab', { name: new RegExp(name) })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('treeitem', { name: 'Daily notes' })).toBeVisible();
  await typeInEditor(page, 'Called the vendor.');
  await waitSaved(page);
  await page.getByRole('treeitem', { name: 'Welcome to My Doc.md' }).click();
  await page.locator('body').press(`${mod}+Shift+D`);
  await expect(page.locator('.cm-content')).toContainText('Called the vendor.');
  await expect(
    page.getByRole('treeitem', { name: new RegExp(name.replace('.md', '')) }),
  ).toHaveCount(1);
});

test('unlinked mentions can be linked, and related documents and hover previews show', async ({
  page,
}) => {
  await freshApp(page);
  await newDocInRoot(page, 'Roadmap.md');
  await typeInEditor(page, '\nShip the beta in Q4. #planning');
  await waitSaved(page);
  await newDocInRoot(page, 'Standup.md');
  await typeInEditor(page, '\nWe reviewed the roadmap today. #planning');
  await waitSaved(page);

  await page.getByRole('treeitem', { name: 'Roadmap.md' }).click();
  await page.getByRole('tab', { name: 'Links' }).click();
  // Shared tag: Standup is related.
  await expect(page.getByRole('heading', { name: /Related/ })).toBeVisible();
  await page.getByRole('button', { name: /Unlinked mentions/ }).click();
  await page.getByRole('button', { name: 'Link the mention in Standup.md' }).click();
  await expect(page.getByRole('heading', { name: 'Backlinks · 1' })).toBeVisible();

  await page.getByRole('treeitem', { name: 'Standup.md' }).click();
  await expect(page.locator('.cm-content')).toContainText('[[Roadmap|roadmap]]');
  await page.getByRole('button', { name: 'Preview' }).click();
  await page.locator('.prose a.wiki-link').hover();
  await expect(page.getByRole('tooltip')).toContainText('Ship the beta in Q4.');
});

test('graph view shows linked documents and opens one on click', async ({ page }) => {
  await freshApp(page);
  await page.keyboard.press(`${mod}+k`);
  await page.keyboard.type('graph view');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Graph' })).toBeVisible();
  // The seed links the welcome guide to both guides.
  await expect(page.getByText(/3 documents · \d+ links?/)).toBeVisible();
  await page.getByText('Documents in this graph (3)').click();
  await page.getByRole('button', { name: /Keyboard shortcuts · / }).click();
  await expect(page.getByRole('tab', { name: /Keyboard shortcuts\.md/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  // Local graph from the palette.
  await page.keyboard.press(`${mod}+k`);
  await page.keyboard.type('local graph');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Graph · Keyboard shortcuts.md' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Graph of \d+ linked documents/ })).toBeVisible();
});
