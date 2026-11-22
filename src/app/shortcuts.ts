/** Single source of truth for keyboard shortcuts (shown in menus, palette and help). */
/**
 * Every shortcut avoids keys Chrome, Edge and Firefox keep for themselves (Ctrl+T, N, W, Tab, P, J,
 * E, D...) so it works the same in a browser tab and in the installed apps. Alt+letter is the app's
 * own layer, with the letter matching the word (Alt+S Search, Alt+T Templates, Alt+A Ask AON).
 * Avoid Alt+D, Alt+E and Alt+F: Chrome on Windows uses them for the address bar and its menu.
 */
export const SHORTCUTS = {
  palette: 'Mod+K',
  paletteAlt: 'Mod+Shift+P',
  shortcuts: 'Mod+/',
  quickOpen: 'Alt+S',
  search: 'Mod+Shift+F',
  newDoc: 'Alt+N',
  newFolder: 'Alt+Shift+N',
  templates: 'Alt+T',
  save: 'Mod+S',
  find: 'Mod+F',
  bold: 'Mod+B',
  italic: 'Mod+I',
  link: 'Mod+Shift+K',
  toggleMode: 'Mod+Alt+S',
  splitView: 'Mod+Alt+E',
  richMode: 'Mod+Alt+R',
  toggleSidebar: 'Mod+\\',
  togglePanel: 'Mod+Alt+\\',
  closeTab: 'Alt+W',
  reopenTab: 'Alt+Shift+W',
  nextTab: 'Alt+.',
  prevTab: 'Alt+,',
  nextFile: 'Ctrl+Alt+Down',
  prevFile: 'Ctrl+Alt+Up',
  back: 'Ctrl+Alt+Left',
  forward: 'Ctrl+Alt+Right',
  focusMode: 'Mod+Shift+.',
  readingMode: 'Alt+R',
  rename: 'F2',
  dailyNote: 'Alt+Shift+D',
  quickNote: 'Alt+K',
  quickList: 'Alt+Shift+K',
  aon: 'Alt+A',
} as const;

/**
 * Earlier keys that still work where the browser lets them through (and always in the installed
 * apps), so people who learned them aren't stranded. They aren't shown anywhere.
 */
export const OLD_SHORTCUTS: Partial<Record<keyof typeof SHORTCUTS, string[]>> = {
  quickOpen: ['Mod+P'],
  templates: ['Mod+T'],
  toggleMode: ['Mod+E'],
  readingMode: ['Mod+Shift+R'],
  dailyNote: ['Mod+Shift+D'],
  reopenTab: ['Alt+Shift+T'],
  nextTab: ['Ctrl+Tab'],
  prevTab: ['Ctrl+Shift+Tab'],
  aon: ['Mod+J'],
  shortcuts: ['Shift+?'],
};

export const SHORTCUT_GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'General',
    items: [
      ['Command palette', `${SHORTCUTS.palette} or ${SHORTCUTS.paletteAlt}`],
      ['Show all keyboard shortcuts', SHORTCUTS.shortcuts],
      ['Search files by name (quick open)', SHORTCUTS.quickOpen],
      ['Search everything', SHORTCUTS.search],
      ['New document', SHORTCUTS.newDoc],
      ['New folder', SHORTCUTS.newFolder],
      ['New from template', SHORTCUTS.templates],
      ["Today's daily note", SHORTCUTS.dailyNote],
      ['Quick note', SHORTCUTS.quickNote],
      ['Quick checklist', SHORTCUTS.quickList],
      ['Toggle sidebar', SHORTCUTS.toggleSidebar],
      ['Toggle side panel', SHORTCUTS.togglePanel],
      ['Ask AON', SHORTCUTS.aon],
      ['Select all (in the focused pane)', 'Mod+A'],
      ['Close overlays', 'Esc'],
    ],
  },
  {
    title: 'Notes',
    items: [
      ['Quick note / checklist, from anywhere', `${SHORTCUTS.quickNote} / ${SHORTCUTS.quickList}`],
      ['New note (installed and desktop apps)', 'Mod+N'],
      ['New note / new checklist', 'C / L'],
      ['Move between notes', 'Arrow keys'],
      ['Open the focused note', 'Enter'],
      ['Select the focused note', 'X'],
      ['Move to Trash', 'Delete'],
      ['Archive', 'E'],
      ['Clear the selection', 'Esc'],
    ],
  },
  {
    title: 'Documents',
    items: [
      ['Save now', SHORTCUTS.save],
      ['Find and replace', SHORTCUTS.find],
      ['Find a file (pointer or focus in the left panel)', SHORTCUTS.find],
      ['Switch source / read', SHORTCUTS.toggleMode],
      ['Split view', SHORTCUTS.splitView],
      ['Rich editing', SHORTCUTS.richMode],
      ['Focus mode', SHORTCUTS.focusMode],
      ['Reading mode', SHORTCUTS.readingMode],
      ['Close tab', SHORTCUTS.closeTab],
      ['Reopen closed tab', SHORTCUTS.reopenTab],
      ['Go back / forward', `${SHORTCUTS.back} / ${SHORTCUTS.forward}`],
      ['Next / previous tab', `${SHORTCUTS.nextTab} / ${SHORTCUTS.prevTab}`],
      ['Open the next / previous file in Files', `${SHORTCUTS.nextFile} / ${SHORTCUTS.prevFile}`],
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
  if (key === ',') return code === 'comma';
  if (key === '/' || key === '?') return code === 'slash';
  if (key === 'tab') return e.key === 'Tab';
  const arrow = ['left', 'right', 'up', 'down'].includes(key);
  return e.key.toLowerCase() === (arrow ? `arrow${key}` : key);
}
