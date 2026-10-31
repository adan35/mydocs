import { expect, type Page } from '@playwright/test';

export const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Fresh app: first launch seeds the workspace and opens the welcome guide. */
export async function freshApp(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to My Doc' })).toBeVisible();
}

export async function prompt(page: Page, value: string) {
  const dialog = page.getByRole('dialog');
  const input = dialog.getByRole('textbox');
  await input.fill(value);
  await input.press('Enter');
  await expect(dialog).toBeHidden();
}

export async function typeInEditor(page: Page, text: string) {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.type(text);
}

export async function waitSaved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /Saved/ }).first()).toBeVisible();
}

export async function newDocInRoot(page: Page, name: string) {
  await page
    .getByRole('button', { name: 'New document', exact: true })
    .first()
    .click({ modifiers: ['Shift'] });
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button').last().click();
  await prompt(page, name);
}

/**
 * Hides the File System Access API so imports use the plain file input, as in Firefox
 * and Safari (and so Playwright's file chooser can answer the picker).
 */
export async function withoutFileSystemAccess(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.showOpenFilePicker;
    delete w.showDirectoryPicker;
  });
}

/** Replaces the whole document in the source editor (no auto-indent or bracket closing). */
export async function setDoc(page: Page, text: string) {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.insertText(text);
}

/** The source text of the open document. */
export async function sourceText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const lines = [...document.querySelectorAll('.cm-content .cm-line')].map(
      (l) => l.textContent ?? '',
    );
    return lines.join('\n');
  });
}

export async function mode(page: Page, name: 'Source' | 'Split' | 'Rich' | 'Read' | 'Sheet') {
  await page
    .getByRole('group', { name: 'View mode' })
    .getByRole('button', { name, exact: true })
    .click();
}

/**
 * Stands in for the File System Access API: the picker returns one fake file whose
 * writes land in `window.__disk`. With `prompt`, the first `dismissals` permission requests
 * (one right after import, one when the document is first clicked) are dismissed and the
 * next one is granted. `changeDisk` edits the file as another app would.
 */
export async function fakeDisk(
  page: Page,
  name: string,
  text: string,
  permission: PermissionState,
  dismissals = 2,
) {
  await page.addInitScript(
    ({ name, text, permission, dismissals }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__disk = text;
      w.__diskTime = 1_700_000_000_000;
      let state = permission;
      let asked = 0;
      const handle = {
        kind: 'file',
        name,
        getFile: async () => {
          if (w.__diskGone) throw new DOMException('gone', 'NotFoundError');
          return new File([w.__disk as string], name, { lastModified: w.__diskTime as number });
        },
        createWritable: async () => {
          if (w.__diskGone) throw new DOMException('gone', 'NotFoundError');
          if (state !== 'granted') throw new DOMException('denied', 'NotAllowedError');
          let next = '';
          return {
            write: async (t: string) => void (next = t),
            close: async () => {
              w.__disk = next;
              w.__diskTime = (w.__diskTime as number) + 1000;
            },
          };
        },
        queryPermission: async () => state,
        // The first request is the one right after import; model the user dismissing it.
        requestPermission: async () => {
          if (asked++ >= dismissals) state = 'granted';
          return state;
        },
      };
      w.showOpenFilePicker = async () => [handle];
    },
    { name, text, permission, dismissals },
  );
}

export async function importViaPicker(page: Page, name: string) {
  await page.getByRole('button', { name: 'Import' }).first().click();
  await page.getByRole('menuitem', { name: 'Files…' }).click();
  await expect(page.getByText(/^Imported 1 file/)).toBeVisible();
  await page.getByRole('treeitem', { name }).click();
}

export const disk = (page: Page) =>
  page.evaluate(() => (window as unknown as { __disk: string }).__disk);

/** Changes the fake file on disk, as another app saving it would. */
export async function changeDisk(page: Page, text: string) {
  await page.evaluate((t) => {
    const w = window as unknown as Record<string, unknown>;
    w.__disk = t;
    w.__diskTime = (w.__diskTime as number) + 1000;
  }, text);
}

/** Deletes the fake file on disk, as the file explorer would. */
export async function deleteFromDisk(page: Page) {
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__diskGone = true;
  });
}
