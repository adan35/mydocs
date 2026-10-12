import { test, expect, type Page } from '@playwright/test';
import { freshApp, mod, mode, newDocInRoot, setDoc, sourceText, waitSaved } from './helpers';

const DOC = `# Plan

## Goals

Intro paragraph with a [link](https://example.com/docs) and **bold** text.

- first item
- second item
  - nested item
- [ ] open task

1. one
2. two

| Name | Qty |
| ---- | --- |
| Pen  | 007 |
| Cup  | 2   |

\`\`\`ts
const a = 1;
\`\`\`

Last paragraph.
`;

/** Reads the document back from the editor after switching to Source. */
async function source(page: Page) {
  await mode(page, 'Source');
  return sourceText(page);
}

async function setup(page: Page) {
  await freshApp(page);
  await newDocInRoot(page, 'Rich');
  await setDoc(page, DOC);
  await waitSaved(page);
  await mode(page, 'Rich');
}

const prose = (page: Page) => page.locator('article.prose');

test.describe('rich editing', () => {
  test('editing an H2 keeps it an H2 in the same place, after saving and reopening', async ({
    page,
  }) => {
    await setup(page);
    const h2 = prose(page).locator('h2', { hasText: 'Goals' });
    await h2.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' for Q4');
    await page.keyboard.press('Tab'); // leave the block
    await prose(page).locator('p', { hasText: 'Last paragraph' }).click();
    await waitSaved(page);
    await page.reload();
    await expect(prose(page).locator('h2')).toHaveText(/Goals for Q4/);
    const text = await source(page);
    expect(text.split('\n')[2]).toBe('## Goals for Q4');
    expect(text).toContain(
      'Intro paragraph with a [link](https://example.com/docs) and **bold** text.',
    );
  });

  test('list items keep their marker, nesting and task state', async ({ page }) => {
    await setup(page);
    await prose(page)
      .locator('.li-text', { hasText: /^nested item$/ })
      .click();
    await page.keyboard.press('End');
    await page.keyboard.type(' (edited)');
    await prose(page).locator('.li-text', { hasText: 'open task' }).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' now');
    await prose(page).locator('p', { hasText: 'Last paragraph' }).click();
    const text = await source(page);
    expect(text).toContain('  - nested item (edited)');
    expect(text).toContain('- [ ] open task now');
    expect(text).toContain('1. one\n2. two');
  });

  test('a table cell edit changes only that cell', async ({ page }) => {
    await setup(page);
    const cell = prose(page).locator('td', { hasText: 'Cup' });
    await cell.click();
    await page.keyboard.press(`${mod}+a`);
    await page.keyboard.type('Mug');
    await page.keyboard.press('Enter'); // moves down a row (none) and leaves the cell
    await prose(page).locator('p', { hasText: 'Last paragraph' }).click();
    const text = await source(page);
    expect(text).toContain('| Mug  | 2   |');
    expect(text).toContain('| Pen  | 007 |');
  });

  test('editing a link label keeps its destination', async ({ page }) => {
    await setup(page);
    const link = prose(page).locator('a', { hasText: 'link' }).first();
    await link.dblclick();
    await page.keyboard.type('guide');
    await prose(page).locator('p', { hasText: 'Last paragraph' }).click();
    const text = await source(page);
    expect(text).toContain('[guide](https://example.com/docs)');
  });

  test('a code block is edited as code and keeps its language', async ({ page }) => {
    await setup(page);
    await prose(page).locator('.code-block').click();
    const ta = page.getByRole('textbox', { name: /Edit ts block/ });
    await expect(ta).toBeVisible();
    await ta.press('End');
    await ta.press(`${mod}+End`);
    await ta.type('\nconst b = 2;');
    await ta.press(`${mod}+Enter`);
    const text = await source(page);
    expect(text).toContain('```ts\nconst a = 1;\nconst b = 2;\n```');
  });

  test('Enter splits a paragraph into two, and undo restores it in one step', async ({ page }) => {
    await setup(page);
    const p = prose(page).locator('p', { hasText: 'Last paragraph' });
    await p.click();
    await page.keyboard.press('End');
    for (let i = 0; i < 'paragraph.'.length; i++) await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    await expect(prose(page).locator('p', { hasText: /^paragraph\.$/ })).toBeVisible();
    let text = await source(page);
    expect(text).toContain('Last\n\nparagraph.');
    await page.locator('.cm-content').click();
    await page.keyboard.press(`${mod}+z`);
    text = await source(page);
    expect(text).toContain('Last paragraph.');
  });

  test('switching modes repeatedly changes nothing and creates no duplicates', async ({ page }) => {
    await setup(page);
    for (const m of ['Source', 'Rich', 'Read', 'Split', 'Rich', 'Source'] as const)
      await mode(page, m);
    const text = await source(page);
    expect(text).toBe(DOC);
  });

  test('the paragraph style control changes a block type explicitly', async ({ page }) => {
    await setup(page);
    await prose(page).locator('p', { hasText: 'Last paragraph' }).click();
    await page.getByRole('combobox', { name: 'Paragraph style' }).selectOption('h3');
    await expect(prose(page).locator('h3', { hasText: 'Last paragraph.' })).toBeVisible();
    const text = await source(page);
    expect(text).toContain('### Last paragraph.');
  });
});
