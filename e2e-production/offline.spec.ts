import { expect, test } from '@playwright/test';
import { freshApp, setDoc, waitSaved } from '../e2e/helpers';

test('the production app reloads and saves documents offline with its real service worker', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await freshApp(page);
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await setDoc(page, '# Offline document\n\nSaved before going offline.');
  await waitSaved(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('Saved before going offline.');
  await setDoc(page, '# Offline document\n\nEdits made offline also survive a reload.');
  await waitSaved(page);
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText(
    'Edits made offline also survive a reload.',
  );
  expect(errors).toEqual([]);
});
