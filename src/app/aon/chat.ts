import { create } from 'zustand';
import { toast } from '../toast-store';
import type { EntryId } from '@/domain/types';
import { complete, AiError } from '../ai';
import * as A from '../actions';
import { session, ws } from '../app-store';
import { editorActions, useEditor } from '../editor-store';
import { aonEnabled } from './enabled';
import { AON_FILE, STARTER, instructionsFor } from './memory';
import { chatSystem, mightBeToolCall, parseToolCall } from './protocol';
import { aonCanSee, runTool } from './tools';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  /** Tools AON used, shown as small steps under the answer. */
  steps: string[];
  /** Documents the answer drew on. */
  sources: { id: EntryId; path: string }[];
  /** Notes this answer created, so they can be undone. */
  created: EntryId[];
  error?: boolean;
}

interface ChatState {
  open: boolean;
  busy: boolean;
  messages: ChatMessage[];
  setOpen(open: boolean): void;
  clear(): void;
}

let nextId = 1;
let controller: AbortController | null = null;
const MAX_STEPS = 6;
/** Characters of earlier conversation sent along with a question. */
const HISTORY_CHARS = 12_000;

export const useAon = create<ChatState>((set) => ({
  open: false,
  busy: false,
  messages: [],
  setOpen: (open) => set({ open: open && aonEnabled() }),
  clear() {
    controller?.abort();
    set({ messages: [], busy: false });
  },
}));

const patch = (id: number, fn: (m: ChatMessage) => Partial<ChatMessage>) =>
  useAon.setState((s) => ({
    messages: s.messages.map((m) => (m.id === id ? { ...m, ...fn(m) } : m)),
  }));

export function stopAon() {
  controller?.abort();
}

/** Sends one question and lets AON use its tools until it has an answer. */
export async function askAon(question: string) {
  if (useAon.getState().busy || !question.trim()) return;
  const history = useAon
    .getState()
    .messages.filter((m) => !m.error && m.text)
    .map((m) => ({ role: m.role, content: m.text }));
  let kept = 0;
  const past = history
    .reverse()
    .filter((m) => (kept += m.content.length) < HISTORY_CHARS)
    .reverse();
  const mine: ChatMessage = {
    id: nextId++,
    role: 'user',
    text: question.trim(),
    steps: [],
    sources: [],
    created: [],
  };
  const reply: ChatMessage = {
    id: nextId++,
    role: 'assistant',
    text: '',
    steps: [],
    sources: [],
    created: [],
  };
  useAon.setState((s) => ({ busy: true, messages: [...s.messages, mine, reply] }));
  controller = new AbortController();
  const { signal } = controller;

  const activeId = useEditor.getState().activeId;
  const tree = ws().tree;
  const system = chatSystem({
    now: new Date(),
    instructions: instructionsFor(tree, ws().allTexts(), activeId ?? undefined),
    current:
      activeId && tree.get(activeId) && aonCanSee(activeId) ? tree.pathOf(activeId) : undefined,
  });
  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    ...past,
    { role: 'user', content: mine.text },
  ];
  try {
    await session().ready;
    for (let step = 0; step < MAX_STEPS; step++) {
      let acc = '';
      const { text } = await complete(
        { system, messages, maxTokens: 1500 },
        {
          signal,
          onText(chunk) {
            acc += chunk;
            if (!mightBeToolCall(acc)) patch(reply.id, () => ({ text: acc }));
          },
        },
      );
      const call = parseToolCall(text);
      if (!call) {
        patch(reply.id, () => ({ text: text.trim() || 'I have nothing to add.' }));
        return;
      }
      patch(reply.id, (m) => ({ text: '', steps: [...m.steps, describe(call.tool, call.args)] }));
      const out = await runTool(call);
      patch(reply.id, (m) => ({
        sources: [
          ...m.sources,
          ...(out.read ?? []).filter((r) => !m.sources.some((s) => s.id === r.id)),
        ],
        created: [...m.created, ...(out.created ?? [])],
      }));
      messages.push(
        { role: 'assistant', content: text.trim() },
        {
          role: 'user',
          content: `<tool_result name="${call.tool}">\n${out.result}\n</tool_result>`,
        },
      );
    }
    patch(reply.id, () => ({
      text: 'That took too many steps. Try a more specific question.',
      error: true,
    }));
  } catch (e) {
    if (signal.aborted) patch(reply.id, (m) => ({ text: m.text || 'Stopped.' }));
    else
      patch(reply.id, () => ({
        text: e instanceof AiError || e instanceof Error ? e.message : 'Something went wrong.',
        error: true,
      }));
  } finally {
    useAon.setState({ busy: false });
  }
}

function describe(tool: string, args: Record<string, unknown>): string {
  const arg = String(args.query ?? args.path ?? args.title ?? '').slice(0, 60);
  const verb: Record<string, string> = {
    search: 'Searched for',
    read: 'Read',
    recent: 'Looked at recent documents',
    tags: 'Looked at tags',
    reminders: 'Checked reminders',
    tasks: 'Looked at open tasks',
    orphans: 'Looked for unlinked documents',
    create_note: 'Created note',
  };
  return `${verb[tool] ?? tool}${arg ? ` “${arg}”` : ''}`;
}

export const toggleAon = () => useAon.getState().setOpen(!useAon.getState().open);

/** Moves the notes an answer created to the Trash. */
export async function undoCreated(messageId: number) {
  const m = useAon.getState().messages.find((x) => x.id === messageId);
  if (!m?.created.length) return;
  await A.trashEntries(m.created);
  patch(messageId, (x) => ({ created: [], steps: [...x.steps, 'Moved the note to Trash'] }));
}

/** Opens the workspace's AON.md, creating it from a starter first. */
export async function openAonFile() {
  const tree = ws().tree;
  const existing = tree
    .childrenOf(null)
    .find((e) => e.kind === 'file' && e.name.toLocaleLowerCase() === AON_FILE.toLocaleLowerCase());
  const id = existing?.id ?? (await ws().createFile(null, AON_FILE, STARTER)).id;
  await A.openEntry(id);
}

/** After minutes are accepted: offer to turn the dated action items into reminder notes. */
export function offerReminders(docId: EntryId) {
  toast({
    message: 'Minutes added.',
    action: {
      label: 'Add reminders for action items',
      run: () =>
        void (async () => {
          await editorActions.flush(docId);
          const path = ws().tree.pathOf(docId);
          useAon.getState().setOpen(true);
          void askAon(
            `Read "${path}" and create a reminder note for each action item that has a due date. Then list the action items that have no date, so I can decide.`,
          );
        })(),
    },
  });
}
