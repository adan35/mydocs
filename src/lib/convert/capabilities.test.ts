/// <reference types="node" />
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { capabilityMarkdown, CONVERSIONS, FORMATS } from './capabilities';

const DOC = resolve(process.cwd(), 'docs/FORMATS.md');
const HEADER =
  '<!-- Generated from src/lib/convert/capabilities.ts. Run `UPDATE_FORMATS=1 npx vitest run capabilities` after changing it. -->\n\n';

describe('capability matrix', () => {
  it('lists a conversion only between known formats', () => {
    const ids = new Set(FORMATS.map((f) => f.id));
    for (const c of CONVERSIONS) {
      expect(ids.has(c.from)).toBe(true);
      expect(ids.has(c.to)).toBe(true);
    }
  });

  it('matches docs/FORMATS.md', () => {
    const doc = HEADER + capabilityMarkdown();
    if (process.env.UPDATE_FORMATS || !existsSync(DOC)) writeFileSync(DOC, doc);
    expect(readFileSync(DOC, 'utf8')).toBe(doc);
  });
});
