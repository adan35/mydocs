import { useRef, type ReactNode } from 'react';
import type { EditorView } from '@codemirror/view';
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Sigma,
  Strikethrough,
  Table,
} from 'lucide-react';
import { SHORTCUTS } from '@/app/shortcuts';
import { formatShortcut } from '../hooks';
import {
  insertCodeBlock,
  insertLink,
  insertMathBlock,
  insertTable,
  toggleLinePrefix,
  toggleWrap,
} from './commands';

interface Tool {
  label: string;
  icon: ReactNode;
  shortcut?: string;
  run(view: EditorView): boolean;
}

const GROUPS: Tool[][] = [
  [
    {
      label: 'Heading 1',
      icon: <Heading1 />,
      shortcut: 'Mod+Alt+1',
      run: (v) => toggleLinePrefix(v, '# '),
    },
    {
      label: 'Heading 2',
      icon: <Heading2 />,
      shortcut: 'Mod+Alt+2',
      run: (v) => toggleLinePrefix(v, '## '),
    },
    {
      label: 'Heading 3',
      icon: <Heading3 />,
      shortcut: 'Mod+Alt+3',
      run: (v) => toggleLinePrefix(v, '### '),
    },
  ],
  [
    { label: 'Bold', icon: <Bold />, shortcut: SHORTCUTS.bold, run: (v) => toggleWrap(v, '**') },
    {
      label: 'Italic',
      icon: <Italic />,
      shortcut: SHORTCUTS.italic,
      run: (v) => toggleWrap(v, '*'),
    },
    {
      label: 'Strikethrough',
      icon: <Strikethrough />,
      shortcut: 'Mod+Shift+X',
      run: (v) => toggleWrap(v, '~~'),
    },
  ],
  [
    {
      label: 'Bulleted list',
      icon: <List />,
      shortcut: 'Mod+Shift+8',
      run: (v) => toggleLinePrefix(v, '- '),
    },
    {
      label: 'Numbered list',
      icon: <ListOrdered />,
      shortcut: 'Mod+Shift+7',
      run: (v) => toggleLinePrefix(v, '1. '),
    },
    {
      label: 'Checklist',
      icon: <ListTodo />,
      shortcut: 'Mod+Shift+9',
      run: (v) => toggleLinePrefix(v, '- [ ] '),
    },
    { label: 'Quote', icon: <Quote />, run: (v) => toggleLinePrefix(v, '> ') },
  ],
  [
    { label: 'Link', icon: <Link />, shortcut: SHORTCUTS.link, run: (v) => insertLink(v) },
    { label: 'Code block', icon: <Code />, shortcut: 'Mod+Alt+C', run: (v) => insertCodeBlock(v) },
    { label: 'Table', icon: <Table />, run: (v) => insertTable(v) },
    { label: 'Equation', icon: <Sigma />, run: (v) => insertMathBlock(v) },
  ],
];

/**
 * Formatting buttons above the Markdown editor, for people who don't know the
 * syntax by heart. One tab stop; arrow keys move between buttons (toolbar pattern).
 * Buttons don't take focus on click, so the cursor and selection stay in the editor.
 */
export function FormatToolbar({ getView }: { getView(): EditorView | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % buttons.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + buttons.length) % buttons.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = buttons.length - 1;
    if (next < 0) return;
    e.preventDefault();
    buttons.forEach((b, j) => (b.tabIndex = j === next ? 0 : -1));
    buttons[next]?.focus();
  };
  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Formatting"
      className="flex min-h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-hairline-soft px-2 py-1 [scrollbar-width:none] no-print sm:flex-wrap sm:overflow-visible"
      onKeyDown={onKeyDown}
    >
      {GROUPS.map((group, g) => (
        <div key={g} className="flex shrink-0 items-center gap-0.5">
          {g > 0 && <span className="mx-1 h-5 w-px bg-hairline" aria-hidden />}
          {group.map((tool, t) => {
            const first = g === 0 && t === 0;
            const title = tool.shortcut
              ? `${tool.label} (${formatShortcut(tool.shortcut)})`
              : tool.label;
            return (
              <button
                key={tool.label}
                type="button"
                className="icon-btn size-8 shrink-0 [&>svg]:size-4"
                aria-label={tool.label}
                title={title}
                tabIndex={first ? 0 : -1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const view = getView();
                  if (view) tool.run(view);
                }}
              >
                {tool.icon}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
