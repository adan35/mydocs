/** Single source of truth for keyboard shortcuts (shown in menus, palette and help). */
export const SHORTCUTS = {
  palette: 'Mod+K',
  paletteAlt: 'Mod+Shift+P',
  quickOpen: 'Mod+P',
  search: 'Mod+Shift+F',
  newDoc: 'Alt+N',
  newFolder: 'Alt+Shift+N',
  save: 'Mod+S',
  find: 'Mod+F',
  bold: 'Mod+B',
  italic: 'Mod+I',
  link: 'Mod+Shift+K',
  toggleMode: 'Mod+E',
  splitView: 'Mod+Alt+E',
  toggleSidebar: 'Mod+\\',
  togglePanel: 'Mod+Alt+\\',
  closeTab: 'Alt+W',
  reopenTab: 'Alt+Shift+T',
  nextTab: 'Ctrl+Tab',
  focusMode: 'Mod+Shift+.',
  readingMode: 'Mod+Shift+R',
  rename: 'F2',
  dailyNote: 'Mod+Shift+D',
} as const;

export const SHORTCUT_GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'General',
    items: [
      ['Command palette', `${SHORTCUTS.palette} or ${SHORTCUTS.paletteAlt}`],
      ['Quick open', SHORTCUTS.quickOpen],
      ['Search everything', SHORTCUTS.search],
      ['New document', SHORTCUTS.newDoc],
      ['New folder', SHORTCUTS.newFolder],
      ["Today's daily note", SHORTCUTS.dailyNote],
      ['Toggle sidebar', SHORTCUTS.toggleSidebar],
      ['Toggle side panel', SHORTCUTS.togglePanel],
      ['Close overlays', 'Esc'],
    ],
  },
  {
    title: 'Documents',
    items: [
      ['Save now', SHORTCUTS.save],
      ['Find and replace', SHORTCUTS.find],
      ['Switch edit / preview', SHORTCUTS.toggleMode],
      ['Split view', SHORTCUTS.splitView],
      ['Focus mode', SHORTCUTS.focusMode],
      ['Reading mode', SHORTCUTS.readingMode],
      ['Close tab', SHORTCUTS.closeTab],
      ['Reopen closed tab', SHORTCUTS.reopenTab],
      ['Next tab', SHORTCUTS.nextTab],
      ['Rename (in the file tree)', SHORTCUTS.rename],
    ],
  },
  {
    title: 'Formatting',
    items: [
      ['Bold', SHORTCUTS.bold],
      ['Italic', SHORTCUTS.italic],
      ['Strikethrough', 'Mod+Shift+X'],
      ['Inline code', 'Mod+`'],
      ['Insert link', SHORTCUTS.link],
      ['Heading 1 / 2 / 3', 'Mod+Alt+1 / 2 / 3'],
      ['Bulleted list', 'Mod+Shift+8'],
      ['Numbered list', 'Mod+Shift+7'],
      ['Task list', 'Mod+Shift+9'],
      ['Code block', 'Mod+Alt+C'],
      ['Multiple cursors', 'Alt+Click'],
    ],
  },
];

/** Matches a KeyboardEvent against a shortcut string like "Mod+Shift+F". */
export function matches(e: KeyboardEvent, shortcut: string, isMac: boolean): boolean {
  const parts = shortcut.split('+');
  const key = parts[parts.length - 1]!.toLowerCase();
  const mod = parts.includes('Mod');
  const wantCtrl = parts.includes('Ctrl') || (mod && !isMac);
  const wantMeta = mod && isMac;
  if (e.ctrlKey !== wantCtrl || e.metaKey !== wantMeta) return false;
  if (e.altKey !== parts.includes('Alt') || e.shiftKey !== parts.includes('Shift')) return false;
  const code = e.code.toLowerCase();
  if (key.length === 1 && /[a-z0-9]/.test(key))
    return code === `key${key}` || code === `digit${key}`;
  if (key === '\\') return code === 'backslash';
  if (key === '.') return code === 'period';
  if (key === 'tab') return e.key === 'Tab';
  return e.key.toLowerCase() === key;
}
