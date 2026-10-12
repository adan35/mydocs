import { expect, test } from '@playwright/test';
import { freshApp, mod, newDocInRoot, setDoc, typeInEditor, waitSaved } from './helpers';

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
  await page.getByRole('button', { name: 'Read', exact: true }).click();
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

test('graph finds documents, shows missing and suggested links, and creates a missing one', async ({
  page,
}) => {
  await freshApp(page);
  await newDocInRoot(page, 'Garden');
  await setDoc(page, '# Garden\n\nPlans live in [[Compost]] and [[Seeds]].');
  await waitSaved(page);
  await newDocInRoot(page, 'Seeds');
  await setDoc(page, '# Seeds\n\nOrdered in spring, ahead of the Harvest.');
  await waitSaved(page);
  await newDocInRoot(page, 'Harvest');
  await setDoc(page, '# Harvest\n\nIn autumn.');
  await waitSaved(page);
  await page.keyboard.press(`${mod}+k`);
  await page.keyboard.type('graph view');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Graph' })).toBeVisible();

  // Search selects the match and shows what it links to.
  await page.getByRole('textbox', { name: 'Find in graph' }).fill('gard');
  await expect(page.getByTestId('graph-matches')).toHaveText('1 found');
  await page.getByRole('textbox', { name: 'Find in graph' }).press('Enter');
  const card = page.getByTestId('graph-selection');
  await expect(card).toContainText('Garden');
  await expect(card).toContainText('1 link out · 0 backlinks');

  // Missing documents appear only when asked for, as their own kind of node.
  await expect(page.getByText(/not created yet/)).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Missing documents' }).check();
  await expect(page.getByText(/1 not created yet/)).toBeVisible();
  await page.getByRole('checkbox', { name: 'Suggested links' }).check();
  // Seeds names Harvest in plain text without linking to it: a suggestion.
  await expect(page.getByText(/1 suggested/)).toBeVisible();

  await page.getByText(/Documents in this graph/).click();
  await page.getByRole('button', { name: /Compost · not created yet/ }).click();
  await expect(card).toContainText('Linked from 1 document');
  await card.getByRole('button', { name: 'Create document' }).click();
  await expect(page.getByRole('treeitem', { name: 'Compost.md' })).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('# Compost');
});
