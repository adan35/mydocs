import type { EntryId } from '@/domain/types';
import { emptyNote } from '@/domain/notes';
import { session, ws } from '../app-store';
import { createNote, readNotes, toLabel } from '../notes';
import { resolveWikiLink } from '../workspace';
import { isPrivate } from './memory';
import type { ToolCall } from './protocol';

export interface ToolOutcome {
  /** What the model gets back. */
  result: string;
  /** Paths of documents the answer drew on. */
  read?: { id: EntryId; path: string }[];
  /** Notes this call created (the chat offers to undo them). */
  created?: EntryId[];
}

// Together with the chat history this keeps a request under the Worker's 60,000 character limit.
const MAX_READ = 6000;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Documents AON may see: not in the trash and not in a folder marked private. */
export function aonCanSee(id: EntryId): boolean {
  const tree = ws().tree;
  return !tree.isTrashed(id) && !isPrivate(tree, ws().allTexts(), id);
}

const localTime = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export async function runTool(call: ToolCall): Promise<ToolOutcome> {
  const tree = ws().tree;
  const texts = ws().allTexts();
  const { args } = call;
  switch (call.tool) {
    case 'search': {
      const query = str(args.query);
      if (!query) return { result: 'Give a query.' };
      const hits = session()
        .search.search(query, tree, {}, 30)
        .filter((h) => aonCanSee(h.id))
        .slice(0, 8);
      if (!hits.length) return { result: 'No matching documents.' };
      return {
        result: hits
          .map((h) => {
            const tags = session().knowledge.tagsOf(h.id);
            return `- ${tree.pathOf(h.id)}${tags.length ? ` [${tags.map((t) => '#' + t).join(' ')}]` : ''}${h.snippet ? ` — ${clip(h.snippet.text.replace(/\s+/g, ' '), 220)}` : ''}`;
          })
          .join('\n'),
      };
    }
    case 'read': {
      const path = str(args.path);
      const entry = tree.findByPath(path) ?? resolveWikiLink(tree, path.replace(/\.md$/i, ''));
      const text = entry && aonCanSee(entry.id) ? texts.get(entry.id) : undefined;
      if (!entry || text === undefined) return { result: `No readable document at "${path}".` };
      return {
        result:
          clip(text, MAX_READ) + (text.length > MAX_READ ? '\n(cut: the document is longer)' : ''),
        read: [{ id: entry.id, path: tree.pathOf(entry.id) }],
      };
    }
    case 'recent': {
      const n = Math.min(20, Math.max(1, Number(args.limit) || 10));
      const files = tree
        .liveFiles()
        .filter((e) => aonCanSee(e.id))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, n);
      return {
        result:
          files.map((e) => `- ${tree.pathOf(e.id)} (${localTime(e.updatedAt)})`).join('\n') ||
          'Nothing yet.',
      };
    }
    case 'tags': {
      const counts = new Map<string, number>();
      for (const e of tree.liveFiles())
        if (aonCanSee(e.id))
          for (const t of session().knowledge.tagsOf(e.id)) counts.set(t, (counts.get(t) ?? 0) + 1);
      const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 40);
      return { result: top.map(([t, c]) => `#${t} (${c})`).join(', ') || 'No tags yet.' };
    }
    case 'reminders': {
      const due = readNotes()
        .live.filter((n) => n.reminder !== null && !n.archived && aonCanSee(n.id))
        .sort((a, b) => a.reminder! - b.reminder!);
      return {
        result:
          due
            .map(
              (n) =>
                `- ${n.title || clip(n.text, 60) || n.items?.[0]?.text || 'Untitled'} — ${localTime(n.reminder!)}${n.repeat ? ` (repeats ${n.repeat})` : ''}`,
            )
            .join('\n') || 'No reminders are set.',
      };
    }
    case 'create_note': {
      const title = str(args.title);
      const items = Array.isArray(args.items)
        ? args.items.map(str).filter(Boolean).slice(0, 100)
        : [];
      const text = str(args.text);
      if (!title && !text && !items.length)
        return { result: 'The note is empty. Give a title, text or items.' };
      let reminder: number | null = null;
      if (args.reminder !== undefined) {
        reminder = new Date(str(args.reminder)).getTime();
        if (Number.isNaN(reminder))
          return {
            result: 'The reminder is not a valid time. Use YYYY-MM-DDTHH:MM in local time.',
          };
        if (reminder < Date.now() - 60_000) return { result: 'That reminder time is in the past.' };
      }
      const labels = (Array.isArray(args.labels) ? args.labels : [])
        .map((l) => toLabel(str(l)))
        .filter((l): l is string => !!l);
      const id = await createNote({
        ...emptyNote(),
        title,
        text: items.length ? '' : text,
        items: items.length ? items.map((t) => ({ text: t, done: false })) : null,
        labels,
        reminder,
      });
      if (!id) return { result: 'The note could not be saved.' };
      return {
        result: `Created the note "${title || text.slice(0, 40)}" at ${ws().tree.pathOf(id)}${reminder ? ` with a reminder for ${localTime(reminder)}` : ''}.`,
        created: [id],
      };
    }
    default:
      return {
        result: `Unknown tool "${call.tool}". Use search, read, recent, tags, reminders or create_note.`,
      };
  }
}
