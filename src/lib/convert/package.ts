/** Zip packages (DOCX, XLSX) and media helpers shared by the Office adapters. */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';

export const MAX_PACKAGE_BYTES = 200 * 1024 * 1024;

export class PackageError extends Error {
  override name = 'PackageError';
}

export interface Package {
  has(path: string): boolean;
  text(path: string): string | undefined;
  bytes(path: string): Uint8Array | undefined;
  paths(): string[];
}

export function readPackage(data: Uint8Array): Package {
  let files: Record<string, Uint8Array>;
  try {
    let total = 0;
    files = unzipSync(data, {
      filter: (f) => {
        total += f.originalSize;
        if (total > MAX_PACKAGE_BYTES) throw new PackageError('The file is too large to open.');
        return true;
      },
    });
  } catch (e) {
    if (e instanceof PackageError) throw e;
    throw new PackageError('This file is damaged or is not an Office document.');
  }
  const norm = (p: string) => p.replace(/^\//, '');
  return {
    has: (p) => norm(p) in files,
    text: (p) => {
      const f = files[norm(p)];
      return f ? strFromU8(f) : undefined;
    },
    bytes: (p) => files[norm(p)],
    paths: () => Object.keys(files),
  };
}

export function writePackage(parts: Record<string, string | Uint8Array>): Uint8Array {
  const z: Zippable = {};
  // [Content_Types].xml goes first; some readers expect it.
  const order = Object.keys(parts).sort((a, b) =>
    a === '[Content_Types].xml' ? -1 : b === '[Content_Types].xml' ? 1 : 0,
  );
  for (const p of order) {
    const v = parts[p]!;
    z[p] = typeof v === 'string' ? strToU8(v) : [v, { level: 0 }];
  }
  return zipSync(z, { level: 6 });
}

/** Resolves a relationship target relative to the part that owns it. */
export function resolveTarget(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

export interface ImageInfo {
  ext: 'png' | 'jpeg' | 'gif' | 'bmp' | 'webp' | 'svg';
  mime: string;
  width: number;
  height: number;
}

/** Reads an image's type and pixel size from its header. */
export function imageInfo(data: Uint8Array): ImageInfo | null {
  const u32 = (o: number) =>
    ((data[o]! << 24) | (data[o + 1]! << 16) | (data[o + 2]! << 8) | data[o + 3]!) >>> 0;
  const u16be = (o: number) => (data[o]! << 8) | data[o + 1]!;
  const u16le = (o: number) => data[o]! | (data[o + 1]! << 8);
  if (
    data.length > 24 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  )
    return { ext: 'png', mime: 'image/png', width: u32(16), height: u32(20) };
  if (data.length > 10 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46)
    return { ext: 'gif', mime: 'image/gif', width: u16le(6), height: u16le(8) };
  if (data.length > 26 && data[0] === 0x42 && data[1] === 0x4d)
    return {
      ext: 'bmp',
      mime: 'image/bmp',
      width: u16le(18) | (u16le(20) << 16),
      height: Math.abs((u16le(22) | (u16le(24) << 16)) << 0),
    };
  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    let o = 2;
    while (o + 9 < data.length) {
      if (data[o] !== 0xff) return null;
      const marker = data[o + 1]!;
      const len = u16be(o + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { ext: 'jpeg', mime: 'image/jpeg', width: u16be(o + 7), height: u16be(o + 5) };
      o += 2 + len;
    }
    return { ext: 'jpeg', mime: 'image/jpeg', width: 0, height: 0 };
  }
  if (data.length > 30 && String.fromCharCode(...data.slice(8, 12)) === 'WEBP') {
    const kind = String.fromCharCode(...data.slice(12, 16));
    if (kind === 'VP8X')
      return {
        ext: 'webp',
        mime: 'image/webp',
        width: 1 + (data[24]! | (data[25]! << 8) | (data[26]! << 16)),
        height: 1 + (data[27]! | (data[28]! << 8) | (data[29]! << 16)),
      };
    if (kind === 'VP8 ')
      return {
        ext: 'webp',
        mime: 'image/webp',
        width: u16le(26) & 0x3fff,
        height: u16le(28) & 0x3fff,
      };
    if (kind === 'VP8L') {
      const b = data.slice(21, 25);
      return {
        ext: 'webp',
        mime: 'image/webp',
        width: 1 + (((b[1]! & 0x3f) << 8) | b[0]!),
        height: 1 + (((b[3]! & 0xf) << 10) | (b[2]! << 2) | ((b[1]! & 0xc0) >> 6)),
      };
    }
  }
  const head = strFromU8(data.slice(0, 512)).trimStart();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) {
    const w = /\bwidth="(\d+(?:\.\d+)?)/.exec(head)?.[1];
    const h = /\bheight="(\d+(?:\.\d+)?)/.exec(head)?.[1];
    return { ext: 'svg', mime: 'image/svg+xml', width: Number(w ?? 300), height: Number(h ?? 150) };
  }
  return null;
}

/** ISO 8601 for Office metadata, without milliseconds. */
export const isoNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
