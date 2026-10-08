import { expect, test } from '@playwright/test';
import { freshApp, newDocInRoot, typeInEditor, waitSaved } from './helpers';

test('only one browser tab edits at a time, and handing over keeps every change', async ({
  page,
  context,
}) => {
  await freshApp(page);
  await newDocInRoot(page, 'Shared.md');
  await typeInEditor(page, 'Written in the first tab.');
  await waitSaved(page);

  // A second tab doesn't load the data while the first one owns it.
  const second = await context.newPage();
  await second.goto('/');
  await expect(
    second.getByRole('heading', { name: 'My Doc is open in another tab' }),
  ).toBeVisible();

  // Unsaved typing in the first tab survives the hand-over.
  await typeInEditor(page, ' And this was still being typed.');
  await second.getByRole('button', { name: 'Use here' }).click();
  await expect(page.getByRole('heading', { name: 'My Doc is open in another tab' })).toBeVisible();

  await second.getByRole('treeitem', { name: 'Shared.md' }).click();
  await expect(second.locator('.cm-content')).toContainText(
    'Written in the first tab. And this was still being typed.',
  );

  // Edit in the second tab, then take it back in the first: it reloads the newer text.
  await typeInEditor(second, ' Edited in the second tab.');
  await waitSaved(second);
  await page.getByRole('button', { name: 'Use here' }).click();
  await expect(
    second.getByRole('heading', { name: 'My Doc is open in another tab' }),
  ).toBeVisible();
  await page.getByRole('treeitem', { name: 'Shared.md' }).click();
  await expect(page.locator('.cm-content')).toContainText('Edited in the second tab.');
});
