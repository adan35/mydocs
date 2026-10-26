import { test, expect, type Page } from '@playwright/test';
import { freshApp, mode, newDocInRoot, setDoc, sourceText, waitSaved } from './helpers';

const DOC = `# Plan

Alpha paragraph.

Beta paragraph with words.

- one
- two

Gamma paragraph.
`;

async function setup(page: Page, m: 'Rich' | 'Source') {
  await freshApp(page);
  await newDocInRoot(page, 'Bar');
  await setDoc(page, DOC);
  await waitSaved(page);
  await mode(page, m);
}
const tool = (page: Page, name: string) =>
  page.getByTestId('ribbon').getByRole('button', { name, exact: true });
const src = async (page: Page) => {
  await mode(page, 'Source');
  return sourceText(page);
};

test.describe('toolbar', () => {
  test('rich: inline code wraps the selection, the word at the caret, and toggles off', async ({
    page,
  }) => {
    await setup(page, 'Rich');
    const beta = page.locator('article.prose p', { hasText: 'Beta paragraph' });
    await beta.click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+Control+ArrowRight');
    await tool(page, 'Inline code').click(); // selection
    await expect(beta.locator('code')).toHaveText('Beta');
    await tool(page, 'Inline code').click(); // toggles off
    await expect(beta.locator('code')).toHaveCount(0);
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft'); // caret inside "words."
    await page.keyboard.press('ArrowLeft');
    await tool(page, 'Inline code').click(); // no selection: the word
    await expect(beta.locator('code')).toHaveText('words');
    await page.locator('article.prose p', { hasText: 'Gamma' }).click();
    expect(await src(page)).toContain('with `words`.');
  });

  test('rich: move down and up act on list items and can be repeated', async ({ page }) => {
    await setup(page, 'Rich');
    await page.locator('article.prose li', { hasText: 'one' }).click();
    await tool(page, 'Move down').click();
    await tool(page, 'Move down').click(); // already last: nothing more to do
    expect(await src(page)).toContain('- two\n- one\n\nGamma');
    await mode(page, 'Rich');
    await page.locator('article.prose li', { hasText: 'one' }).click();
    await tool(page, 'Move up').click();
    await tool(page, 'Move up').click(); // already first
    expect(await src(page)).toContain('- one\n- two\n\nGamma');
  });

  test('rich: numbered items keep their numbers when moved', async ({ page }) => {
    await freshApp(page);
    await newDocInRoot(page, 'Numbers');
    await setDoc(page, '1. a\n2. b\n3. c\n');
    await waitSaved(page);
    await mode(page, 'Rich');
    await page.locator('article.prose li', { hasText: 'a' }).click();
    await tool(page, 'Move down').click();
    await tool(page, 'Move down').click();
    expect(await src(page)).toContain('1. b\n2. c\n3. a');
  });

  test('rich: move down and up', async ({ page }) => {
    await setup(page, 'Rich');
    await page.locator('article.prose p', { hasText: 'Alpha' }).click();
    await tool(page, 'Move down').click();
    await tool(page, 'Move down').click(); // still focused: Alpha moves on past the list
    expect(await src(page)).toContain('- two\n\nAlpha paragraph.');
    await mode(page, 'Rich');
    await page.locator('article.prose p', { hasText: 'Alpha' }).click();
    await tool(page, 'Move up').click();
    expect(await src(page)).toContain('Beta paragraph with words.\n\nAlpha paragraph.\n\n- one');
  });

  test('source: move and delete act on the selected lines', async ({ page }) => {
    await setup(page, 'Source');
    await page.locator('.cm-content').getByText('Alpha paragraph.').click();
    await tool(page, 'Move down').click();
    expect((await sourceText(page)).split('\n').slice(0, 4)).toEqual([
      '# Plan',
      '',
      '',
      'Alpha paragraph.',
    ]);
    await tool(page, 'Move up').click();
    await tool(page, 'Delete').click();
    expect(await sourceText(page)).not.toContain('Alpha');
  });

  test('button names can be shown, from the toolbar, and are remembered', async ({ page }) => {
    await setup(page, 'Source');
    const bar = page.getByTestId('ribbon');
    await expect(bar.getByText('Move up', { exact: true })).toHaveCount(0);
    await bar.getByRole('button', { name: 'Show button labels' }).click();
    await expect(bar.getByText('Move up', { exact: true })).toBeVisible();
    await expect(bar.getByText('Inline code', { exact: true })).toBeVisible();
    await page.reload();
    await expect(
      page.getByTestId('ribbon').getByText('Inline code', { exact: true }),
    ).toBeVisible();
    await page.getByTestId('ribbon').getByRole('button', { name: 'Hide button labels' }).click();
    await expect(page.getByTestId('ribbon').getByText('Inline code', { exact: true })).toHaveCount(
      0,
    );
  });

  test('rich: delete block', async ({ page }) => {
    await setup(page, 'Rich');
    await page.locator('article.prose p', { hasText: 'Beta' }).click();
    await tool(page, 'Delete').click();
    expect(await src(page)).not.toContain('Beta');
  });

  test('rich: code block, equation, divider, table', async ({ page }) => {
    await setup(page, 'Rich');
    await page.locator('article.prose p', { hasText: 'Alpha' }).click();
    await tool(page, 'Code block').click();
    await tool(page, 'Equation').click();
    await tool(page, 'Divider').click();
    const t = await src(page);
    expect(t).toContain('```');
    expect(t).toContain('$$');
    expect(t).toMatch(/\n---\n/);
  });

  test('source: every formatting tool changes the document', async ({ page }) => {
    await setup(page, 'Source');
    for (const [name, re] of [
      ['Bold', /\*\*/],
      ['Italic', /\*[^*]/],
      ['Strikethrough', /~~/],
      ['Inline code', /`/],
      ['Code block', /```/],
      ['Equation', /\$\$/],
      ['Divider', /\n---\n/],
    ] as const) {
      const before = await sourceText(page);
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+End');
      await tool(page, name).click();
      const after = await sourceText(page);
      expect(after, name).not.toBe(before);
      expect(after, name).toMatch(re);
    }
  });
});
