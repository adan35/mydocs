import { expect, test, type Page } from '@playwright/test';
import { mockProvider } from './aon-mock';
import { freshApp, mod, setDoc, sourceText } from './helpers';

const goHome = (page: Page) => page.getByRole('button', { name: 'Home', exact: true }).click();

const newDoc = async (page: Page) => {
  await page.getByRole('button', { name: 'New document', exact: true }).first().click();
  await expect(page.locator('.cm-content')).toBeVisible();
};

test('meeting minutes are added under the notes and offer reminders', async ({ page }) => {
  const calls = await mockProvider(page, (body, n) =>
    n === 1
      ? '## Summary\nLaunch moves to the 14th.\n## Decisions\n- Move launch\n## Action items\n- [ ] Confirm venue — Priya — due 2026-10-30\n## Open questions\nNone'
      : 'Done.',
  );
  await freshApp(page);
  await newDoc(page);
  await setDoc(page, 'Weekly sync. Priya confirms the venue by Friday. Launch moves to the 14th.');
  await page.getByRole('button', { name: 'Write or rewrite with AON' }).click();
  await page.getByRole('menuitem', { name: 'Meeting minutes from these notes' }).click();
  const box = page.getByRole('region', { name: 'AON suggestion' });
  await expect(box).toContainText('Action items');
  expect(calls[0]!.messages[0]!.content).toContain('Action items');
  await box.getByRole('button', { name: 'Accept' }).click();
  // The minutes start on their own paragraph, below the notes.
  expect(await sourceText(page)).toMatch(/Launch moves to the 14th\.\n\n## Summary/);

  await page.getByRole('button', { name: 'Add reminders for action items' }).click();
  const panel = page.getByTestId('aon-panel');
  await expect(panel).toContainText('create a reminder note for each action item');
  await expect(panel).toContainText('Done.');
  expect(calls.at(-1)!.messages[0]!.content).toContain('Untitled.md');
});

test('tidy up shows a reviewable list, applies the ticked changes and can undo them', async ({
  page,
}) => {
  const calls = await mockProvider(page, () =>
    JSON.stringify({
      ops: [
        {
          kind: 'rename',
          path: 'Welcome to My Doc.md',
          name: 'Start here',
          reason: 'Clearer name',
        },
        { kind: 'tag', path: 'Welcome to My Doc.md', tag: 'guide', reason: 'It is a guide' },
        { kind: 'move', path: 'Welcome to My Doc.md', to: '../../etc', reason: 'unsafe' },
        {
          kind: 'move',
          path: 'Guides/Markdown guide.md',
          to: 'Reference',
          reason: 'Group references',
        },
      ],
    }),
  );
  await freshApp(page);
  await page.keyboard.press(`${mod}+k`);
  await page.getByRole('combobox').fill('Tidy up with AON');
  await page.getByRole('option', { name: /Tidy up with AON/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Tidy up with AON' });
  await expect(dialog.getByRole('checkbox')).toHaveCount(3);
  // Only what AON saw reaches it, as paths plus the start of each document.
  expect(calls[0]!.messages[0]!.content).toContain('Welcome to My Doc.md |');
  await dialog.getByRole('checkbox').nth(2).uncheck(); // keep the guide where it is
  await dialog.getByRole('button', { name: 'Apply 2 changes' }).click();
  await expect(dialog).toContainText('Applied 2 changes');
  const tree = page.getByRole('tree');
  await expect(tree.getByText('Start here.md')).toBeVisible();
  await expect(tree.getByText('Welcome to My Doc.md')).toBeHidden();

  await dialog.getByRole('button', { name: 'Undo all' }).click();
  await expect(dialog).toContainText('back where it was');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(tree.getByText('Welcome to My Doc.md')).toBeVisible();
});

test('capture turns pasted text into a filed document the user checks first', async ({ page }) => {
  const calls = await mockProvider(page, () =>
    JSON.stringify({
      title: 'Plumber visit',
      folder: 'Home',
      tags: ['home', 'repairs'],
      markdown: '# Plumber visit\n\n- Tuesday 9:00\n- Bring the old tap',
    }),
  );
  await freshApp(page);
  await goHome(page);
  await page.getByRole('button', { name: 'Capture', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Capture with AON' });
  await dialog
    .getByRole('textbox', { name: 'Text to capture' })
    .fill('plumber tuesday 9am bring old tap');
  await dialog.getByRole('button', { name: 'Organize with AON' }).click();
  await expect(dialog.getByLabel('Title')).toHaveValue('Plumber visit');
  await expect(dialog.getByLabel(/^Folder/)).toHaveValue('Home');
  expect(calls[0]!.messages[0]!.content).toContain('plumber tuesday 9am');

  await dialog.getByLabel('Title').fill('Plumber Tuesday');
  await dialog.getByRole('button', { name: 'Save document' }).click();
  await expect(page.locator('.cm-content')).toContainText('Bring the old tap');
  await expect(page.getByRole('tree').getByText('Plumber Tuesday.md')).toBeVisible();
  expect(await sourceText(page)).toContain('tags:');
});

test('the daily brief is written on request and kept for the day', async ({ page }) => {
  const calls = await mockProvider(page, () => '**Today**\n\nNothing is overdue.');
  await freshApp(page);
  await goHome(page);
  await page.getByRole('button', { name: 'Get my brief' }).click();
  await expect(page.getByLabel('AON', { exact: true }).last()).toContainText('Nothing is overdue.');
  expect(calls[0]!.messages[0]!.content).toContain('Documents changed in the last 3 days');
  expect(calls[0]!.messages[0]!.content).toContain('Welcome to My Doc.md');
  await page.reload();
  await expect(page.getByText('Nothing is overdue.')).toBeVisible();
  expect(calls).toHaveLength(1);
});

test('related suggestions only offer documents AON was given, and add a Related link', async ({
  page,
}) => {
  await mockProvider(page, (body) => {
    const first = /Candidates \(path \| start\):\n(.+?) \|/.exec(body.messages[0]!.content)?.[1];
    return JSON.stringify({
      related: [
        { path: first ?? 'x', why: 'Same topic' },
        { path: 'Invented/Nothing.md', why: 'made up' },
      ],
    });
  });
  await freshApp(page);
  await newDoc(page);
  await setDoc(page, '# Keyboard shortcuts and Markdown\n\nNotes on the guides.');
  await page.getByRole('tab', { name: 'Links' }).click();
  await page.getByRole('button', { name: 'Find notes worth linking' }).click();
  const list = page.getByRole('list', { name: 'Suggested links' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('Same topic');
  await list.getByRole('button', { name: 'Add link under Related' }).click();
  await expect.poll(async () => sourceText(page)).toContain('## Related');
  expect(await sourceText(page)).toMatch(/- \[\[.+\]\]\s*$/);
});

test('chat can list open tasks and unlinked documents', async ({ page }) => {
  const calls = await mockProvider(page, (_b, n) =>
    n === 1
      ? 'TOOL: {"tool":"tasks","args":{}}'
      : n === 2
        ? 'TOOL: {"tool":"orphans","args":{}}'
        : 'Checked both.',
  );
  await freshApp(page);
  await page.keyboard.press(`${mod}+j`);
  const panel = page.getByTestId('aon-panel');
  await panel.getByRole('textbox', { name: 'Message AON' }).fill('what is open?');
  await panel.getByRole('button', { name: 'Send' }).click();
  await expect(panel).toContainText('Checked both.');
  await expect(panel).toContainText('Looked at open tasks');
  expect(calls[1]!.messages.at(-1)!.content).toMatch(/<tool_result name="tasks">/);
  expect(calls[2]!.messages.at(-1)!.content).toMatch(/<tool_result name="orphans">/);
});
