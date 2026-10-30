import { useEffect, useState } from 'react';
import type { ColorScope } from './ColorPicker';
import type { PaintScope } from './SheetRibbon';
import type { Selection } from './SheetGrid';

export const PAINT_SCOPES: ColorScope<PaintScope>[] = [
  { value: 'cells', label: 'Selected cells' },
  { value: 'rows', label: 'Entire row' },
  { value: 'cols', label: 'Entire column' },
];

/** What a color is applied to by default: rows or columns picked by their headers, else the cells. */
export function defaultScope(sel: Selection): PaintScope {
  if (sel.scope === 'rows') return 'rows';
  if (sel.scope === 'cols' || sel.scope === 'all') return 'cols';
  return 'cells';
}

/** The scope the color picker shows: the default for the selection, until one is chosen. */
export function usePaintScope(sel: Selection) {
  const [choice, setChoice] = useState<PaintScope | null>(null);
  useEffect(() => setChoice(null), [sel.r, sel.c, sel.to?.r, sel.to?.c, sel.scope]);
  return [choice ?? defaultScope(sel), setChoice] as const;
}
