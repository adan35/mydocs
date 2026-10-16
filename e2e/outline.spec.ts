import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { freshApp, mode, newDocInRoot, setDoc, withoutFileSystemAccess } from './helpers';

test.beforeEach(({ page }) => withoutFileSystemAccess(page));

async function importFile(page: Page, name: string, mimeType: string, buffer?: Buffer) {
  await page.getByRole('button', { name: 'Import' }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Files…' }).click();
  await (
    await chooser
  ).setFiles({
    name,
    mimeType,
    buffer: buffer ?? readFileSync(resolve(process.cwd(), 'fixtures', name)),
  });
  await expect(page.getByText(/Imported 1 file/).last()).toBeVisible();
  await page.getByRole('treeitem', { name }).click();
}

async function openOutline(page: Page) {
  const tab = page.getByRole('tab', { name: 'Outline' });
  if (!(await tab.isVisible()))
    await page.getByRole('button', { name: 'Toggle side panel' }).click();
  await tab.click();
  return page.getByRole('navigation', { name: 'Outline' });
}

const filler = (n: number) =>
  Array.from({ length: n }, () => 'Some words in a paragraph.\n').join('\n');
const doc =
  '# Guide\n\nIntro text here.\n\n' +
  [1, 2, 3, 4, 5]
    .map((i) => `## Part ${i}\n\n${filler(12)}\n### Detail ${i}\n\n${filler(8)}\n`)
    .join('');

test('the outline shows levels, section sizes and the section in view, in every mode', async ({
  page,
}) => {
  await freshApp(page);
  await newDocInRoot(page, 'Guide');
  await setDoc(page, doc);
  const outline = await openOutline(page);
  await expect(page.getByTestId('outline-summary')).toHaveText(/11 headings · \d+ words/);
  const part3 = outline.getByRole('button', { name: 'Part 3', exact: true });
  await expect(part3).toContainText('H2');
  await expect(part3).toContainText(/\d+ w/);

  for (const m of ['Source', 'Read', 'Rich', 'Split'] as const) {
    await mode(page, m);
    await outline.getByRole('button', { name: 'Detail 4', exact: true }).click();
    await expect(outline.locator('[aria-current="location"]')).toContainText('Detail 4');
  }

  // Collapsing a section hides its subsections; the filter finds any heading.
  await outline.getByRole('button', { name: 'Collapse Part 2' }).click();
  await expect(outline.getByRole('button', { name: 'Detail 2', exact: true })).toBeHidden();
  await outline.getByRole('button', { name: 'Collapse all' }).click();
  await expect(outline.getByRole('button', { name: 'Guide', exact: true })).toBeVisible();
  await expect(outline.getByRole('button', { name: 'Part 1', exact: true })).toBeHidden();
  await outline.getByRole('button', { name: 'Expand all' }).click();
  await expect(outline.getByRole('button', { name: 'Detail 2', exact: true })).toBeVisible();
});

test('Word, Excel, PDF, CSV and source files get an outline too', async ({ page }) => {
  await freshApp(page);

  await importFile(
    page,
    'field-notes.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  let outline = await openOutline(page);
  await expect(page.getByTestId('outline-summary')).toContainText('headings');
  await outline.getByRole('button', { name: 'Sites', exact: true }).click();
  await expect(outline.locator('[aria-current="location"]')).toContainText('Sites');

  await importFile(
    page,
    'sales.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  outline = await openOutline(page);
  await expect(page.getByTestId('outline-summary')).toContainText('sheet');
  await expect(outline.locator('[aria-current="location"]')).toBeVisible();

  await importFile(page, 'field-notes.pdf', 'application/pdf');
  outline = await openOutline(page);
  await expect(page.getByTestId('outline-summary')).toContainText(/page|bookmark/);
  await expect(outline.locator('[aria-current="location"]')).toBeVisible();

  await importFile(page, 'inventory.csv', 'text/csv');
  outline = await openOutline(page);
  await expect(page.getByTestId('outline-summary')).toContainText('columns');
  await outline.getByRole('button').nth(1).click();
  await expect(page.getByTestId('formula-bar')).toBeVisible();

  const code = Buffer.from(
    'export class Store {\n  load() {}\n}\n\nexport function open(id: string) {\n  return id;\n}\n\nconst close = async () => {};\n',
  );
  await importFile(page, 'store.ts', 'text/plain', code);
  outline = await openOutline(page);
  await expect(page.getByTestId('outline-summary')).toHaveText('3 symbols');
  await expect(outline.getByRole('button', { name: 'open', exact: true })).toContainText('fn');
});
