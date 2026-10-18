/**
 * Images for the PDF writer. JPEG files are embedded as they are; PNG pixel data is passed
 * through (or, with transparency, split into color and mask) without being decoded to
 * pictures, so quality is untouched and no canvas is needed (this runs in a worker).
 */
import { unzlibSync, zlibSync } from 'fflate';
import { imageInfo } from './package';

/** Where image objects go: the PDF file being written. */
export interface ObjectSink {
  rawStream(dict: string, body: Uint8Array): number;
}

export interface EmbeddedImage {
  /** Object number of the image XObject. */
  id: number;
  /** Pixel size. */
  width: number;
  height: number;
}

export type ImageResult = EmbeddedImage | { unsupported: string };

const u32 = (d: Uint8Array, o: number) =>
  ((d[o]! << 24) | (d[o + 1]! << 16) | (d[o + 2]! << 8) | d[o + 3]!) >>> 0;

export function embedImage(sink: ObjectSink, data: Uint8Array): ImageResult {
  const info = imageInfo(data);
  if (!info) return { unsupported: 'an unknown format' };
  if (info.ext === 'jpeg') return embedJpeg(sink, data);
  if (info.ext === 'png') return embedPng(sink, data);
  return { unsupported: info.ext.toUpperCase() };
}

function embedJpeg(sink: ObjectSink, d: Uint8Array): ImageResult {
  let o = 2;
  let comps = 0;
  let bits = 8;
  let width = 0;
  let height = 0;
  let adobe = false;
  while (o + 9 < d.length) {
    if (d[o] !== 0xff) break;
    const marker = d[o + 1]!;
    const len = (d[o + 2]! << 8) | d[o + 3]!;
    if (
      marker === 0xee &&
      len >= 12 &&
      String.fromCharCode(...d.subarray(o + 4, o + 9)) === 'Adobe'
    )
      adobe = true;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      bits = d[o + 4]!;
      height = (d[o + 5]! << 8) | d[o + 6]!;
      width = (d[o + 7]! << 8) | d[o + 8]!;
      comps = d[o + 9]!;
      break;
    }
    o += 2 + len;
  }
  if (!width || !height || ![1, 3, 4].includes(comps)) return { unsupported: 'this kind of JPEG' };
  const space = comps === 1 ? '/DeviceGray' : comps === 3 ? '/DeviceRGB' : '/DeviceCMYK';
  // Adobe CMYK JPEGs store inverted values.
  const decode = comps === 4 && adobe ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
  const id = sink.rawStream(
    `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${space} /BitsPerComponent ${bits} /Filter /DCTDecode${decode}`,
    d,
  );
  return { id, width, height };
}

function embedPng(sink: ObjectSink, d: Uint8Array): ImageResult {
  let o = 8;
  let width = 0;
  let height = 0;
  let depth = 8;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (o + 8 <= d.length) {
    const len = u32(d, o);
    const type = String.fromCharCode(d[o + 4]!, d[o + 5]!, d[o + 6]!, d[o + 7]!);
    const body = d.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = u32(body, 0);
      height = u32(body, 4);
      depth = body[8]!;
      colorType = body[9]!;
      interlace = body[12]!;
    } else if (type === 'PLTE') palette = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  if (!width || !height || !idat.length) return { unsupported: 'a damaged PNG' };
  if (interlace) return { unsupported: 'an interlaced PNG' };
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) return { unsupported: 'this kind of PNG' };

  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of idat) {
    joined.set(c, at);
    at += c.length;
  }

  const base = `/Type /XObject /Subtype /Image /Width ${width} /Height ${height}`;
  if (colorType === 4 || colorType === 6) {
    if (depth !== 8 && depth !== 16) return { unsupported: 'this kind of PNG' };
    // Pixels have an alpha channel: undo the PNG row filters, then store color and alpha apart.
    let raw: Uint8Array;
    try {
      raw = unzlibSync(joined);
    } catch {
      return { unsupported: 'a damaged PNG' };
    }
    const bytes = depth / 8;
    const bpp = channels * bytes;
    const stride = width * bpp;
    if (raw.length < (stride + 1) * height) return { unsupported: 'a damaged PNG' };
    const pixels = unfilter(raw, width, height, bpp);
    const colorChannels = channels - 1;
    const color = new Uint8Array(width * height * colorChannels * bytes);
    const alpha = new Uint8Array(width * height * bytes);
    let ci = 0;
    let ai = 0;
    for (let p = 0; p < width * height; p++) {
      const s = p * bpp;
      for (let b = 0; b < colorChannels * bytes; b++) color[ci++] = pixels[s + b]!;
      for (let b = 0; b < bytes; b++) alpha[ai++] = pixels[s + colorChannels * bytes + b]!;
    }
    const mask = sink.rawStream(
      `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent ${depth} /Filter /FlateDecode`,
      zlibSync(alpha, { level: 6 }),
    );
    const id = sink.rawStream(
      `${base} /ColorSpace ${colorChannels === 1 ? '/DeviceGray' : '/DeviceRGB'} /BitsPerComponent ${depth} /Filter /FlateDecode /SMask ${mask} 0 R`,
      zlibSync(color, { level: 6 }),
    );
    return { id, width, height };
  }

  let space: string;
  if (colorType === 3) {
    if (!palette) return { unsupported: 'a damaged PNG' };
    let hex = '';
    for (const b of palette) hex += b.toString(16).padStart(2, '0');
    space = `[/Indexed /DeviceRGB ${palette.length / 3 - 1} <${hex}>]`;
  } else space = colorType === 0 ? '/DeviceGray' : '/DeviceRGB';
  // The PNG's own compressed rows are valid Flate data with the PNG predictor.
  const id = sink.rawStream(
    `${base} /ColorSpace ${space} /BitsPerComponent ${depth} /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors ${colorType === 2 ? 3 : 1} /BitsPerComponent ${depth} /Columns ${width} >>`,
    joined,
  );
  return { id, width, height };
}

/** Reverses PNG scanline filters. `raw` has one filter byte before each row. */
function unfilter(raw: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const prev = dst - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp]! : 0;
      const b = y > 0 ? out[prev + x]! : 0;
      const c = y > 0 && x >= bpp ? out[prev + x - bpp]! : 0;
      let v = raw[src + x]!;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[dst + x] = v & 0xff;
    }
  }
  return out;
}
