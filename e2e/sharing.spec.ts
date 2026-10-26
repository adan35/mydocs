import { expect, test, type Browser } from '@playwright/test';
import { freshApp, mod, mode } from './helpers';

/**
 * Two people editing one document through the real Worker. Needs the Worker running with
 * DEV_AUTH=1 and the app built with VITE_API_URL pointing at it (docs/SHARING.md), so it
 * is skipped unless SHARING_API is set:
 *   SHARING_API=http://localhost:8787 VITE_API_URL=http://localhost:8787 \
 *   VITE_GOOGLE_CLIENT_ID=x npx playwright test sharing
 */
const API = process.env.SHARING_API;
test.skip(!API, 'needs the local Worker (see docs/SHARING.md)');
test.describe.configure({ mode: 'serial' });

async function signedIn(browser: Browser, name: string | null) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  if (name) {
    const email = `${name}${Date.now()}@example.com`;
    const r = await fetch(`${API}/api/auth/dev`, {
      method: 'POST',
      body: JSON.stringify({ email, name }),
    });
    const { token, user } = (await r.json()) as { token: string; user: unknown };
    await page.addInitScript((v) => localStorage.setItem('mydoc:account', JSON.stringify(v)), {
      token,
      user,
    });
  }
  return page;
}

test('two people edit the same document live, and a viewer cannot', async ({ browser }) => {
  const alice = await signedIn(browser, 'alice');
  await freshApp(alice);
  await mode(alice, 'Source');
  await alice.getByRole('button', { name: 'Share', exact: true }).click();
  const dialog = alice.getByRole('dialog', { name: 'Share' });
  await dialog.getByRole('button', { name: 'Share this document' }).click();
  await dialog.getByLabel('Link access').selectOption('edit');
  const editLink = await dialog.getByLabel('Share link').inputValue();
  expect(editLink).toContain('#/s/');
  await dialog.getByLabel('Link access').selectOption('view');
  const viewLink = await dialog.getByLabel('Share link').inputValue();
  expect(viewLink).toBe(editLink); // the same key; the link's rights are set by the owner
  await dialog.getByLabel('Link access').selectOption('edit');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(alice.getByRole('button', { name: /^Live/ })).toBeVisible();

  // Bob opens the edit link.
  const bob = await signedIn(browser, 'bob');
  await bob.goto(editLink);
  await bob.getByRole('button', { name: 'Open in My Doc' }).click();
  await mode(bob, 'Source');
  await expect(bob.locator('.cm-content')).toContainText('Welcome to My Doc');
  await expect(bob.getByRole('button', { name: /^Live/ })).toBeVisible();

  // Alice types; Bob sees it. Bob types; Alice sees it.
  await alice.locator('.cm-content').click();
  await alice.keyboard.press(`${mod}+End`);
  await alice.keyboard.type('\nHello from Alice');
  await expect(bob.locator('.cm-content')).toContainText('Hello from Alice');
  await bob.locator('.cm-content').click();
  await bob.keyboard.press(`${mod}+End`);
  await bob.keyboard.type('\nHello from Bob');
  await expect(alice.locator('.cm-content')).toContainText('Hello from Bob');
  await expect(alice.getByRole('button', { name: 'Live · 2' })).toBeVisible();

  // Both copies were also saved on their own devices.
  await expect(alice.getByRole('status').filter({ hasText: 'Saved' }).first()).toBeVisible();

  // Carol is not signed in: the edit link only lets her read.
  const carol = await signedIn(browser, null);
  await carol.goto(editLink);
  await carol.getByRole('button', { name: 'Open in My Doc' }).click();
  await mode(carol, 'Source');
  await expect(carol.locator('.cm-content')).toContainText('Hello from Bob');
  await expect(carol.getByRole('button', { name: 'View only' })).toBeVisible();
  await carol.locator('.cm-content').click();
  await carol.keyboard.press(`${mod}+End`);
  await carol.keyboard.type('CAROL WAS HERE');
  await expect(carol.locator('.cm-content')).not.toContainText('CAROL WAS HERE');
  await expect(alice.locator('.cm-content')).not.toContainText('CAROL WAS HERE');

  // Turning the link off cuts Carol off.
  await alice.getByRole('button', { name: /^Live/ }).click();
  await alice.getByRole('dialog').getByLabel('Link access').selectOption('off');
  await expect(carol.getByRole('button', { name: 'No access' })).toBeVisible();
});
