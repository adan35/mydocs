import type { ToolContext } from './tools';
import { dialogs } from '@/app/dialog-store';
import { startInline } from '@/app/aon/inline';
import { MINUTES_PROMPT, TRANSFORMS } from '@/app/aon/protocol';
import { openMenu, openMenuAt, type MenuEntry } from '../components/Menu';

/** The ribbon's AON menu: rewrite the selection, or write at the cursor. */
export function openAonMenu(ctx: ToolContext) {
  const view = ctx.view;
  if (!view) return;
  const { from, to, empty } = view.state.selection.main;
  const rewrite = (request: string) => startInline(view, { from, to, request, kind: 'selection' });
  const ask = async () => {
    const request = await dialogs.prompt({
      title: empty ? 'Ask AON to write' : 'Ask AON to change the selection',
      label: empty ? 'What should AON write here?' : 'What should AON do with the selected text?',
      confirmLabel: 'Ask AON',
    });
    if (!request?.trim()) return;
    if (empty) startInline(view, { from: to, to, request: request.trim(), kind: 'request' });
    else rewrite(request.trim());
  };
  const items: MenuEntry[] = [
    { label: 'Ask AON…', onSelect: () => void ask() },
    {
      label: 'Continue writing',
      onSelect: () =>
        startInline(view, {
          from: to,
          to,
          request: 'Continue writing from where the document leaves off, in the same style.',
          kind: 'request',
        }),
    },
    {
      label: 'Meeting minutes from these notes',
      onSelect: () => {
        const notes = view.state.sliceDoc(from, to);
        const at = empty ? view.state.doc.length : to;
        startInline(view, {
          from: at,
          to: at,
          request: notes ? `${MINUTES_PROMPT}\n\nThe notes:\n${notes}` : MINUTES_PROMPT,
          kind: 'request',
          followUp: 'reminders',
        });
      },
    },
    'separator',
    ...TRANSFORMS.map((t) => ({
      label: t.label,
      disabled: empty,
      onSelect: () => rewrite(t.prompt),
    })),
    {
      label: 'Translate…',
      disabled: empty,
      onSelect: () =>
        void dialogs
          .prompt({
            title: 'Translate',
            label: 'Translate into which language?',
            confirmLabel: 'Translate',
          })
          .then((lang) => {
            if (lang?.trim()) rewrite(`Translate into ${lang.trim()}. Keep the formatting.`);
          }),
    },
  ];
  const button = document.querySelector<HTMLElement>('[data-tool="aon"]');
  if (button) openMenuAt(button, items, 'AON');
  else openMenu({ items, at: { x: innerWidth / 2, y: innerHeight / 3 }, label: 'AON' });
}
