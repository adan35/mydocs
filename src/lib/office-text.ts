import { extensionOf } from '@/domain/names';
import { readPackage, resolveTarget } from './convert/package';
import { attr, descendants, isEl, local, parseXml, textOf, type XmlElement } from './convert/xml';

export const OFFICE_TEXT_EXTENSIONS = new Set(['pptx', 'odt', 'ods', 'odp']);

/** Text-only preview: preserves content, without claiming to reproduce page layout. */
export function officeText(data: Uint8Array, name: string): string[] {
  const ext = extensionOf(name);
  if (!OFFICE_TEXT_EXTENSIONS.has(ext)) return [];
  const pkg = readPackage(data);
  const xml = (path: string) => {
    const text = pkg.text(path);
    if (!text) throw new Error(`The document is missing ${path}.`);
    if (text.length > 4 * 1024 * 1024)
      throw new Error('The document is too large for a text preview.');
    return parseXml(text);
  };
  if (ext === 'pptx') {
    const relationships = new Map(
      descendants(xml('ppt/_rels/presentation.xml.rels'), 'Relationship')
        .filter((r) => attr(r, 'TargetMode') !== 'External')
        .map((r) => [attr(r, 'Id'), attr(r, 'Target')]),
    );
    const slides = descendants(xml('ppt/presentation.xml'), 'sldId');
    return slides.flatMap((slide, i) => {
      const target = relationships.get(slide.attrs['r:id']);
      if (!target) return [];
      const root = xml(resolveTarget('ppt/presentation.xml', target));
      return [
        `Slide ${i + 1}`,
        ...descendants(root, 'p')
          .map((p) => descendants(p, 't').map(textOf).join(''))
          .filter(Boolean),
      ];
    });
  }
  const root = xml('content.xml');
  if (ext === 'ods') {
    return descendants(root, 'table')
      .flatMap((table) => [
        attr(table, 'name') || 'Sheet',
        ...descendants(table, 'table-row').map((row) =>
          descendants(row, 'table-cell')
            .map(
              (cell) => descendants(cell, 'p').map(textOf).join(' ') || attr(cell, 'value') || '',
            )
            .join(' | '),
        ),
      ])
      .filter(Boolean);
  }
  const paragraphs: string[] = [];
  const walk = (element: XmlElement) => {
    for (const child of element.children) {
      if (!isEl(child)) continue;
      if (local(child.name) === 'p' || local(child.name) === 'h') {
        const text = textOf(child);
        if (text) paragraphs.push(text);
      } else walk(child);
    }
  };
  walk(root);
  return paragraphs;
}
