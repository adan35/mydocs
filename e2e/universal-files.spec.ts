import { expect, test, type Page } from '@playwright/test';
import { writePackage } from '../src/lib/convert/package';
import { freshApp, withoutFileSystemAccess } from './helpers';

async function importFile(page: Page, name: string, buffer: Buffer) {
  await page.getByRole('button', { name: 'Import', exact: true }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Files…' }).click();
  await (await chooser).setFiles({ name, mimeType: 'application/octet-stream', buffer });
  await page.getByRole('treeitem', { name, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await withoutFileSystemAccess(page);
  await freshApp(page);
});

test('unknown binary content is inspectable and downloads unchanged', async ({ page }) => {
  const bytes = Buffer.from([0x4d, 0x5a, 0, 0xff, 0x10]);
  await importFile(page, 'sample.unknown', bytes);
  await expect(page.getByLabel('File byte preview')).toContainText('4d 5a 00 ff 10');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('sample.unknown');
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks)).toEqual(bytes);
});

test('audio has native playback controls with a byte fallback', async ({ page }) => {
  const wav = Buffer.alloc(44 + 2205 * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(22050, 24);
  wav.writeUInt32LE(44100, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  await importFile(page, 'sound.wav', wav);
  await expect(page.getByLabel('Play sound.wav')).toHaveAttribute('controls', '');
  await page.getByLabel('Play sound.wav').dispatchEvent('error', { bubbles: false });
  await expect(page.getByText(/codec cannot be played/)).toBeVisible();
  await expect(page.getByLabel('File byte preview')).toContainText('52 49 46 46');
});

test('OpenDocument text is displayed as inert text with its original available', async ({
  page,
}) => {
  const bytes = writePackage({
    'content.xml':
      '<office:document><text:p>Hello &lt;script&gt;alert(1)&lt;/script&gt;</text:p></office:document>',
  });
  await importFile(page, 'notes.odt', Buffer.from(bytes));
  await expect(page.getByRole('region', { name: 'Document text preview' })).toContainText(
    'Hello <script>alert(1)</script>',
  );
  await expect(
    page.getByRole('region', { name: 'Document text preview' }).locator('script'),
  ).toHaveCount(0);
});
