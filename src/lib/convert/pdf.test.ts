// @vitest-environment node
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { zlibSync } from 'fflate';
import { markdownToAst } from './markdown';
import { astToPdf } from './pdf';

const NOW = new Date(Date.UTC(2026, 9, 12, 12, 0, 0));

/** pdf.js reads the file the way a viewer does, so these tests show real viewers can open it. */
async function read(data: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: data.slice(),
    useSystemFonts: true,
  }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    pages.push(tc.items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  return { doc, pages, text: pages.join('\n'), meta: await doc.getMetadata() };
}

const md = (src: string, images?: Record<string, Uint8Array>) =>
  astToPdf(markdownToAst(src), { now: NOW, images: (s) => images?.[s] });

/** A solid-color PNG built by hand: `type` 2 = RGB, 6 = RGBA. */
function png(width: number, height: number, type: 2 | 6, rgba: [number, number, number, number]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (name: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, body.length);
    out.set(new TextEncoder().encode(name), 4);
    out.set(body, 8);
    v.setUint32(8 + body.length, crc(out.subarray(4, 8 + body.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = type;
  const channels = type === 6 ? 4 : 3;
  const raw = new Uint8Array((1 + width * channels) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = y * (1 + width * channels) + 1 + x * channels;
      raw.set(rgba.slice(0, channels), o);
    }
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw)),
    chunk('IEND', new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe('astToPdf', () => {
  it('writes text that a PDF reader can extract, in order, with the document properties', async () => {
    const { data, report } = md(
      '---\ntitle: Field notes\nauthor: Ada\n---\n\n# Field notes\n\nHeron counts for **spring** and *autumn*.\n\n## Sites\n\n1. North ridge\n2. River bend\n\n- Quiet cove\n  - Reeds\n- [x] Done\n- [ ] Open\n\n> Quoted words\n\n---\n\n`code` and a [link](https://example.com/a?b=1).',
    );
    expect(new TextDecoder().decode(data.slice(0, 8))).toBe('%PDF-1.5');
    const { text, meta, doc } = await read(data);
    const flat = text.replace(/\s+/g, '');
    for (const s of [
      'Field notes',
      'Heron counts for spring and autumn.',
      'North ridge',
      'River bend',
      'Quiet cove',
      'Reeds',
      'Quoted words',
      'code',
      'link',
    ])
      expect(flat).toContain(s.replace(/\s+/g, ''));
    expect(text.indexOf('Sites')).toBeGreaterThan(text.indexOf('Heron counts'));
    expect((meta.info as { Title?: string }).Title).toBe('Field notes');
    expect((meta.info as { Author?: string }).Author).toBe('Ada');
    expect(doc.numPages).toBe(1);
    expect(report.lossless).toBe(true);
  });

  it('keeps web links clickable and adds bookmarks for headings', async () => {
    const { data } = md(
      '# One\n\n## Two\n\n# Three\n\nSee [the site](https://example.com/x) and [another note](other.md).',
    );
    const { doc } = await read(data);
    const page = await doc.getPage(1);
    const annots = await page.getAnnotations();
    expect(annots).toHaveLength(1);
    expect(annots[0].url).toBe('https://example.com/x');
    const outline = await doc.getOutline();
    expect(outline?.map((o) => o.title)).toEqual(['One', 'Three']);
    expect(outline![0]!.items.map((o) => o.title)).toEqual(['Two']);
  });

  it('flows long documents over pages and repeats table headers', async () => {
    const rows = Array.from({ length: 90 }, (_, i) => `| Row ${i + 1} | value ${i + 1} |`).join(
      '\n',
    );
    const paras = Array.from(
      { length: 40 },
      (_, i) => `Paragraph ${i + 1} ${'lorem ipsum '.repeat(30)}`,
    );
    const { data, report } = md(
      `# Long\n\n${paras.join('\n\n')}\n\n| Name | Value |\n| --- | ---: |\n${rows}\n`,
    );
    const { pages, doc } = await read(data);
    expect(doc.numPages).toBeGreaterThan(4);
    expect(pages[0]).toContain('Paragraph 1 ');
    const last = pages[pages.length - 1]!;
    expect(last).toContain('Row 90');
    // The header row appears again on continuation pages.
    const tablePages = pages.filter((p) => p.includes('Value') && p.includes('Row'));
    expect(tablePages.length).toBeGreaterThan(1);
    expect(report.kept.get('pages')).toBe(doc.numPages);
    // Page numbers.
    expect(last).toContain(`${doc.numPages} / ${doc.numPages}`);
  });

  it('wraps words wider than the page and very long code lines', async () => {
    const { data } = md(`${'x'.repeat(300)}\n\n\`\`\`\n${'y'.repeat(300)}\n\`\`\`\n`);
    const { text } = await read(data);
    expect(text.replace(/\s/g, '').match(/x/g)).toHaveLength(300);
    expect(text.replace(/\s/g, '').match(/y/g)).toHaveLength(300);
  });

  it('writes Western European text and reports characters the fonts lack', async () => {
    const ok = md('Café Zürich – “quoted” € 5 • Ñandú');
    const okText = (await read(ok.data)).text;
    expect(okText).toContain('Café Zürich');
    expect(okText).toContain('€ 5');
    expect(ok.report.lossless).toBe(true);

    const { data, report } = md('Hello 日本語 and 😀');
    expect((await read(data)).text).toContain('Hello');
    const note = report.notes.find((n) => /built-in fonts/.test(n.message));
    expect(note?.severity).toBe('warning');
    expect(note?.message).toMatch(/^4 characters/);
  });

  it('embeds PNG images, with transparency, and describes the ones it cannot', async () => {
    const images = {
      'a.png': png(40, 30, 2, [200, 40, 40, 255]),
      'b.png': png(40, 30, 6, [20, 90, 200, 128]),
    };
    const { data, report } = md(
      '![red](a.png)\n\n![blue](b.png)\n\n![gone](missing.png)\n\n![web](https://example.com/x.png)\n',
      images,
    );
    expect(report.kept.get('images')).toBe(2);
    expect(report.notes.map((n) => n.message).join('\n')).toMatch(/not in this workspace/);
    expect(report.notes.map((n) => n.message).join('\n')).toMatch(/from the web/);
    const { doc, text } = await read(data);
    expect(text).toContain('[gone]');
    const ops = await (await doc.getPage(1)).getOperatorList();
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const painted = ops.fnArray.filter((f) => f === pdfjs.OPS.paintImageXObject).length;
    expect(painted).toBe(2);
  });

  it('writes tables whose cells wrap', async () => {
    const { data } = md(
      `| Item | Notes |\n| :-- | --: |\n| Pen | ${'a long note that has to wrap '.repeat(12)} |\n| Ink | short |\n`,
    );
    const { text } = await read(data);
    expect(text).toContain('Pen');
    expect(text).toContain('short');
    expect((text.match(/a long note/g) ?? []).length).toBe(12);
  });

  it('is repeatable for the same input and date', () => {
    const a = md('# Same\n\ntext').data;
    const b = md('# Same\n\ntext').data;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('writes sample files for manual inspection when asked', () => {
    if (!process.env.PDF_SAMPLES) return;
    mkdirSync(process.env.PDF_SAMPLES, { recursive: true });
    const images = {
      'a.png': png(120, 80, 2, [200, 40, 40, 255]),
      'b.png': png(120, 80, 6, [20, 90, 200, 128]),
    };
    const { data } = md(
      `---\ntitle: Sample\n---\n\n# Sample document\n\nIntro with **bold**, *italic*, ~~strike~~, \`code\`, a [link](https://example.com), super^2^ and sub~2~.\n\n## Lists\n\n1. First\n2. Second\n   - Nested bullet\n   - Another with a very long line that should wrap onto the next line nicely and keep its indent\n3. Third\n\n- [x] Done task\n- [ ] Open task\n\n> A quote that spans\n> two lines of text.\n\n## Code\n\n\`\`\`ts\nconst x: number = 1;\nfunction hi(name: string) {\n  return \`hello \${name}\`;\n}\n\`\`\`\n\n## Table\n\n| Species | Count | Note |\n| :-- | --: | :-: |\n| Heron | 4 | Seen at dawn near the north ridge |\n| Kestrel | 12 | Nesting |\n\n![red](a.png)\n\n![blue](b.png)\n\n---\n\nThe end. Café – “quotes” € 5.\n`,
      images,
    );
    writeFileSync(`${process.env.PDF_SAMPLES}/sample.pdf`, data);
    const rows = Array.from(
      { length: 60 },
      (_, i) => `| Row ${i + 1} | value ${i + 1} | ${'note '.repeat(i % 7)} |`,
    ).join('\n');
    const paras = Array.from(
      { length: 14 },
      (_, i) => `Paragraph ${i + 1} ${'lorem ipsum dolor sit amet '.repeat(25)}`,
    );
    writeFileSync(
      `${process.env.PDF_SAMPLES}/long.pdf`,
      md(
        `# Long\n\n${paras.join('\n\n')}\n\n## Data\n\n| Name | Value | Note |\n| --- | ---: | --- |\n${rows}\n\n> ${'quoted '.repeat(300)}\n\n\`\`\`\n${Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join('\n')}\n\`\`\`\n`,
      ).data,
    );
  });
});
