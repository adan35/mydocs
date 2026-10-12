/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { markdownToAst, astToMarkdown } from './markdown';
import { astToDocx, docxToAst, MEDIA_SRC } from './docx';
import { readPackage } from './package';

const fixture = readFileSync(resolve(process.cwd(), 'fixtures/report.md'), 'utf8');

// A 1x1 PNG.
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

describe('markdown ↔ ast', () => {
  it('round-trips the fixture without losing structure', () => {
    const ast = markdownToAst(fixture);
    expect(ast.meta.title).toBe('Quarterly report');
    expect(ast.meta.keywords).toEqual(['finance', 'q4']);
    const md = astToMarkdown(ast);
    const again = markdownToAst(md);
    expect(again.blocks).toEqual(ast.blocks);
    expect(md).toContain('| Pen | 007 | 1.50 |');
    expect(md).toContain('- [ ] open task');
    expect(md).toContain('   - keep tables');
  });
});

describe('docx', () => {
  it('writes real Word structure', () => {
    const { data, report } = astToDocx(markdownToAst(fixture));
    const pkg = readPackage(data);
    const doc = pkg.text('word/document.xml')!;
    expect(doc).toContain('w:val="Heading1"');
    expect(doc).toContain('w:val="Heading2"');
    expect(doc).toContain('<w:tbl>');
    expect(doc).toContain('<w:numPr>');
    expect(doc).toContain('<w:hyperlink');
    expect(pkg.text('docProps/core.xml')).toContain('<dc:title>Quarterly report</dc:title>');
    expect(report.kept.get('tables')).toBe(1);
  });

  it('reads its own output back to the same Markdown structure', () => {
    const ast = markdownToAst(fixture);
    const { data } = astToDocx(ast);
    const back = docxToAst(data);
    const md = astToMarkdown(back.ast);
    expect(md).toContain('# Quarterly report');
    expect(md).toContain('## Goals');
    expect(md).toContain('1. Ship the editor');
    expect(md).toMatch(/2\. Convert files\n {3}- keep tables\n {3}- keep lists\n3\. Measure/);
    expect(md).toContain('- [ ] open task\n- [x] done task');
    expect(md).toContain('**bold**');
    expect(md).toContain('*italic*');
    expect(md).toContain('~~gone~~');
    expect(md).toContain('`code`');
    expect(md).toContain('[link](https://example.com/docs)');
    expect(md).toContain('> A quote that spans two lines.');
    expect(md).toContain('```\nconst total = items.reduce((a, b) => a + b, 0);\n```');
    expect(md).toContain('| Pen | 007 | 1.50 |');
    expect(md).toContain('| :--- | ---: | :---: |');
    expect(back.ast.meta.title).toBe('Quarterly report');
    expect(back.ast.meta.author).toBe('Muhammad Adan');
  });

  it('embeds workspace images and extracts them again', () => {
    const ast = markdownToAst('![A dot](assets/dot.png)\n');
    const { data, report } = astToDocx(ast, {
      images: (src) => (src === 'assets/dot.png' ? PNG : undefined),
    });
    expect(report.kept.get('images')).toBe(1);
    const back = docxToAst(data);
    expect(back.media).toHaveLength(1);
    expect(back.media[0]!.mime).toBe('image/png');
    expect(astToMarkdown(back.ast)).toContain(`![A dot](${MEDIA_SRC}image1.png)`);
  });

  it('reports images it could not embed instead of dropping them silently', () => {
    const { report } = astToDocx(markdownToAst('![Missing](nowhere.png)\n'));
    expect(report.notes.map((n) => n.message).join()).toMatch(/not in this workspace/);
  });

  it('rejects files that are not Word documents', () => {
    expect(() => docxToAst(new Uint8Array([1, 2, 3]))).toThrow(/damaged|not an Office/);
  });
});

// CONVERT_DUMP=dir writes the fixture's export so Word, LibreOffice or python-docx can check it.
it.runIf(!!process.env.CONVERT_DUMP)('dumps the fixture export', async () => {
  const { writeFileSync } = await import('node:fs');
  const { data } = astToDocx(markdownToAst(fixture), {
    images: () => PNG,
  });
  writeFileSync(resolve(process.env.CONVERT_DUMP!, 'report.docx'), data);
});

describe('docx from Word-compatible tools', () => {
  it('reads a python-docx document: title, headings, lists, table, image, quote', () => {
    const data = new Uint8Array(readFileSync(resolve(process.cwd(), 'fixtures/field-notes.docx')));
    const { ast, media, report } = docxToAst(data);
    const md = astToMarkdown(ast);
    expect(ast.meta).toMatchObject({ title: 'Field notes', author: 'Ada Lovelace' });
    expect(md).toContain('# Field notes');
    expect(md).toContain('Observations with **bold** and *italic* text.');
    expect(md).toContain('# Sites');
    expect(md).toMatch(/1\. North ridge\n2\. River bend/);
    expect(md).toContain('- Quiet cove');
    expect(md).toContain('## Counts');
    expect(md).toContain('| Heron | 4 | 007 |');
    expect(md).toContain('> The end.');
    expect(media).toHaveLength(1);
    expect(report.lossless).toBe(true);
  });
});
