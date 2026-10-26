import { useEffect, useRef, useState } from 'react';
import type { BlockType } from '@/domain/source-edit';
import { formatShortcut, useLayout } from '../hooks';
import {
  BLOCK_STYLES,
  TOOLS,
  applyBlockStyle,
  currentBlockStyle,
  type Tool,
  type ToolContext,
} from './tools';

const GROUP_ORDER: Tool['group'][] = [
  'history',
  'inline',
  'block',
  'arrange',
  'insert',
  'table',
  'text',
];
const GROUP_LABEL: Record<Tool['group'], string> = {
  history: 'History',
  inline: 'Text formatting',
  block: 'Paragraph',
  arrange: 'Arrange',
  insert: 'Insert',
  table: 'Tables',
  text: 'Text tools',
};

/**
 * The contextual ribbon: one row of controls that adapts to the document's format and
 * to the selection. Buttons don't take focus on click, so the selection stays where
 * it is. One tab stop; arrow keys move between controls (toolbar pattern). On phones
 * it scrolls sideways and stays above the on-screen keyboard.
 */
export function Ribbon({ ctx, tick }: { ctx: ToolContext; tick: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { phone } = useLayout();
  const keyboardInset = useKeyboardInset(phone);
  void tick; // re-render on selection changes
  const tools = TOOLS.filter((t) => t.when(ctx));
  const groups = GROUP_ORDER.map((g) => tools.filter((t) => t.group === g)).filter((g) => g.length);
  const style = ctx.kind === 'markdown' ? currentBlockStyle(ctx) : null;
  const styleDisabled = ctx.surface === 'rich' && (!ctx.richFocus || ctx.richFocus.kind === 'cell');

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('button, select') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i < 0 || document.activeElement?.tagName === 'SELECT') return;
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    items.forEach((b, j) => (b.tabIndex = j === next ? 0 : -1));
    items[next]?.focus();
  };

  if (!groups.length) return null;
  let first = true;
  const tabIndex = () => {
    const t = first ? 0 : -1;
    first = false;
    return t;
  };

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Formatting"
      data-testid="ribbon"
      className={`ribbon flex min-h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-hairline bg-surface-soft px-2 py-1.5 [scrollbar-width:none] no-print ${phone && keyboardInset ? 'fixed inset-x-0 z-40 border-t shadow-2' : ''}`}
      style={phone && keyboardInset ? { bottom: keyboardInset } : undefined}
      onKeyDown={onKeyDown}
    >
      {ctx.kind === 'markdown' && (
        <select
          className="input h-8 w-auto min-w-[112px] shrink-0 bg-canvas py-0 text-caption font-medium"
          aria-label="Paragraph style"
          title="Paragraph style"
          tabIndex={tabIndex()}
          disabled={styleDisabled}
          value={style ?? ''}
          onMouseDown={(e) => {
            // Keep the rich-editing caret: choose without moving focus out of the block first.
            if (ctx.surface === 'rich') e.stopPropagation();
          }}
          onChange={(e) => applyBlockStyle(ctx, e.target.value as BlockType)}
        >
          {style === null && <option value="">Style</option>}
          {BLOCK_STYLES.map((s) => (
            <option key={s.type} value={s.type}>
              {s.label}
            </option>
          ))}
        </select>
      )}
      {groups.map((group, g) => (
        <div
          key={group[0]!.group}
          className="flex shrink-0 items-center gap-0.5"
          role="group"
          aria-label={GROUP_LABEL[group[0]!.group]}
        >
          {(g > 0 || ctx.kind === 'markdown') && (
            <span className="mx-1 h-5 w-px bg-hairline" aria-hidden />
          )}
          {group.map((tool) => {
            const pressed = tool.pressed?.(ctx);
            const disabled = tool.disabled?.(ctx) ?? false;
            const title = tool.shortcut
              ? `${tool.label} (${formatShortcut(tool.shortcut)})`
              : tool.label;
            return (
              <button
                key={tool.id}
                type="button"
                className={`icon-btn size-8 shrink-0 [&>svg]:size-4 ${pressed ? 'bg-primary-soft text-primary-soft-ink' : ''}`}
                aria-label={tool.label}
                aria-pressed={tool.pressed ? !!pressed : undefined}
                title={title}
                data-tool={tool.id}
                disabled={disabled}
                tabIndex={tabIndex()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => tool.run(ctx)}
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

/** Height of the on-screen keyboard (phones), so controls can sit just above it. */
function useKeyboardInset(enabled: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!enabled || !vv) return;
    const update = () => {
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      // Only when the keyboard is really up and focus is in an editable surface.
      const editing = !!document.activeElement?.closest(
        '.cm-editor, [contenteditable="true"], textarea',
      );
      setInset(covered > 80 && editing ? covered : 0);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    addEventListener('focusin', update);
    addEventListener('focusout', update);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      removeEventListener('focusin', update);
      removeEventListener('focusout', update);
    };
  }, [enabled]);
  return inset;
}
