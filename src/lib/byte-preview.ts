/** Bounded, inert fallback for any binary format. Never executes file contents. */
export const PREVIEW_BYTES = 512;

export function bytePreview(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let offset = 0; offset < Math.min(bytes.length, PREVIEW_BYTES); offset += 16) {
    const row = bytes.subarray(offset, Math.min(offset + 16, PREVIEW_BYTES));
    const hex = [...row]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join(' ')
      .padEnd(47);
    const text = [...row].map((n) => (n >= 32 && n < 127 ? String.fromCharCode(n) : '.')).join('');
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex}  ${text}`);
  }
  return lines.join('\n');
}
