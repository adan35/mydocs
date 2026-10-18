import { describe, expect, it } from 'vitest';
import { writePackage } from './convert/package';
import { officeText } from './office-text';
import { bytePreview, PREVIEW_BYTES } from './byte-preview';
import { mediaKindOf, mimeOf } from '@/domain/names';
import { textFromBytes } from '@/app/importer';

describe('universal file previews', () => {
  it('keeps binary files inert and bounds the preview', () => {
    expect(bytePreview(new Uint8Array([0x4d, 0x5a, 0, 0xff]))).toContain('4d 5a 00 ff');
    expect(bytePreview(new Uint8Array([60, 115, 99, 114, 105, 112, 116, 62]))).toContain(
      '<script>',
    );
    expect(bytePreview(new Uint8Array(PREVIEW_BYTES + 1024)).split('\n')).toHaveLength(32);
    expect(bytePreview(new Uint8Array())).toBe('');
  });

  it('recognizes media without treating an ASCII media payload as editable text', () => {
    expect(mediaKindOf('TRACK.MP3')).toBe('audio');
    expect(mediaKindOf('clip.webm')).toBe('video');
    expect(mimeOf('clip.mp4')).toBe('video/mp4');
    expect(mediaKindOf('notes.md')).toBeNull();
    expect(textFromBytes(new TextEncoder().encode('ID3payload'), 'track.mp3')).toBeNull();
    expect(textFromBytes(new TextEncoder().encode('notes'), 'notes.custom')).toBe('notes');
  });

  it('reads presentation slides in presentation order rather than filename order', () => {
    const bytes = writePackage({
      'ppt/presentation.xml':
        '<p:presentation><p:sldIdLst><p:sldId id="1" r:id="r2"/><p:sldId id="2" r:id="r1"/></p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels':
        '<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/><Relationship Id="r2" Target="slides/slide2.xml"/></Relationships>',
      'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>Second &amp; last</a:t></a:r></a:p></p:sld>',
      'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>First slide</a:t></a:r></a:p></p:sld>',
    });
    expect(officeText(bytes, 'deck.pptx')).toEqual([
      'Slide 1',
      'First slide',
      'Slide 2',
      'Second & last',
    ]);
  });

  it('reads OpenDocument text and spreadsheet cell content', () => {
    expect(
      officeText(
        writePackage({
          'content.xml': '<office:document><text:p>Hello &lt;world&gt;</text:p></office:document>',
        }),
        'note.odt',
      ),
    ).toEqual(['Hello <world>']);
    expect(
      officeText(
        writePackage({
          'content.xml':
            '<office:document><table:table table:name="Budget"><table:table-row><table:table-cell><text:p>Revenue</text:p></table:table-cell><table:table-cell office:value="42"/></table:table-row></table:table></office:document>',
        }),
        'budget.ods',
      ),
    ).toEqual(['Budget', 'Revenue | 42']);
    expect(() => officeText(new Uint8Array([1, 2, 3]), 'broken.odt')).toThrow();
  });
});
