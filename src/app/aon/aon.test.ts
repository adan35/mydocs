import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entry } from '@/domain/types';
import { Tree } from '@/domain/tree';
import { complete, useAiSettings } from '../ai';
import { instructionsFor, isPrivate } from './memory';
import {
  cleanInsertion,
  findAonRequest,
  mightBeToolCall,
  parseToolCall,
  windowAround,
} from './protocol';

describe('findAonRequest', () => {
  it('finds a request anywhere in a line', () => {
    expect(findAonRequest('@aon summarize this')).toEqual({ index: 0, request: 'summarize this' });
    expect(findAonRequest('- Notes: @aon list three ideas  ')).toEqual({
      index: 9,
      request: 'list three ideas',
    });
  });
  it('ignores escaped, embedded and empty mentions', () => {
    expect(findAonRequest('\\@aon not a request')).toBeNull();
    expect(findAonRequest('mail me@aon.com now')).toBeNull();
    expect(findAonRequest('@aon')).toBeNull();
    expect(findAonRequest('@aon   ')).toBeNull();
    expect(findAonRequest('@aonymous user')).toBeNull();
  });
});

describe('tool calls', () => {
  it('parses a TOOL line, even with text around it', () => {
    expect(parseToolCall('TOOL: {"tool":"search","args":{"query":"pricing"}}')).toEqual({
      tool: 'search',
      args: { query: 'pricing' },
    });
    expect(parseToolCall('Let me check.\nTOOL: {"tool":"tags"}')).toEqual({
      tool: 'tags',
      args: {},
    });
  });
  it('is not fooled by plain answers or broken JSON', () => {
    expect(parseToolCall('You decided on two tiers.')).toBeNull();
    expect(parseToolCall('TOOL: {"tool":')).toBeNull();
    expect(parseToolCall('TOOL: {"args":{}}')).toBeNull();
  });
  it('holds back streamed text only while it might be a tool call', () => {
    expect(mightBeToolCall('TO')).toBe(true);
    expect(mightBeToolCall('TOOL: {"to')).toBe(true);
    expect(mightBeToolCall('You decided')).toBe(false);
  });
});

describe('text helpers', () => {
  it('unwraps a fenced answer and trims', () => {
    expect(cleanInsertion('```markdown\n- a\n- b\n```')).toBe('- a\n- b');
    expect(cleanInsertion('\nHello  \n')).toBe('Hello');
    expect(cleanInsertion('```js\ncode\n```')).toBe('```js\ncode\n```');
  });
  it('windows long text around a position', () => {
    const text = 'a'.repeat(100) + 'X' + 'b'.repeat(100);
    const w = windowAround(text, 100, 20);
    expect(w).toContain('X');
    expect(w.length).toBeLessThanOrEqual(22);
    expect(windowAround('short', 2, 20)).toBe('short');
  });
});

const entry = (
  id: string,
  parentId: string | null,
  name: string,
  kind: 'file' | 'folder' = 'file',
): Entry => ({ id, parentId, name, kind, createdAt: 1, updatedAt: 1, size: 0 });

describe('AON.md', () => {
  const tree = new Tree([
    entry('root', null, 'AON.md'),
    entry('work', null, 'Work', 'folder'),
    entry('wa', 'work', 'aon.md'),
    entry('d1', 'work', 'plan.md'),
    entry('secret', null, 'Secret', 'folder'),
    entry('sa', 'secret', 'AON.md'),
    entry('d2', 'secret', 'diary.md'),
    entry('d3', null, 'other.md'),
  ]);
  const texts = new Map([
    ['root', 'Reply briefly.\n<!-- a hint that is not for the model -->'],
    ['wa', '---\ntitle: x\n---\nProjects here are called Apollo.'],
    ['sa', '---\nprivate: true\n---\nKeep out.'],
  ]);
  it('joins the root instructions and the folder instructions, without comments', () => {
    expect(instructionsFor(tree, texts, 'd1')).toBe(
      'Reply briefly.\n\nProjects here are called Apollo.',
    );
    expect(instructionsFor(tree, texts, 'd3')).toBe('Reply briefly.');
    expect(instructionsFor(tree, texts)).toBe('Reply briefly.');
  });
  it('keeps AON out of private folders only', () => {
    expect(isPrivate(tree, texts, 'd2')).toBe(true);
    expect(isPrivate(tree, texts, 'd1')).toBe(false);
    expect(isPrivate(tree, texts, 'd3')).toBe(false);
  });
  it('a root AON.md cannot hide the whole workspace', () => {
    const t = new Map([['root', '---\nprivate: true\n---\nx']]);
    expect(isPrivate(tree, t, 'd3')).toBe(false);
  });
});

describe('streaming', () => {
  afterEach(() => vi.unstubAllGlobals());
  const sse = (events: string[]) =>
    new Response(
      new ReadableStream({
        start(c) {
          const enc = new TextEncoder();
          // Split mid-event to check that partial lines are joined.
          const all = events.map((e) => `data: ${e}\n\n`).join('');
          c.enqueue(enc.encode(all.slice(0, 25)));
          c.enqueue(enc.encode(all.slice(25)));
          c.close();
        },
      }),
      { status: 200 },
    );

  it('reads Anthropic events as they arrive', async () => {
    useAiSettings.setState({ provider: 'anthropic', key: 'sk-test', model: '' });
    const fetchMock = vi.fn(async () =>
      sse([
        '{"type":"message_start"}',
        '{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}',
        '{"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}',
        '{"type":"message_stop"}',
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const chunks: string[] = [];
    const r = await complete(
      { messages: [{ role: 'user', content: 'hi' }] },
      { onText: (c) => chunks.push(c) },
    );
    expect(chunks).toEqual(['Hel', 'lo']);
    expect(r.text).toBe('Hello');
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body.stream).toBe(true);
  });

  it('reads OpenAI events too', async () => {
    useAiSettings.setState({ provider: 'openai', key: 'sk-test', model: '' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sse([
          '{"choices":[{"delta":{"content":"A"}}]}',
          '{"choices":[{"delta":{"content":"B"}}]}',
          '[DONE]',
        ]),
      ),
    );
    const r = await complete({ messages: [{ role: 'user', content: 'hi' }] }, { onText: () => {} });
    expect(r.text).toBe('AB');
  });

  it('does not stream unless asked', async () => {
    useAiSettings.setState({ provider: 'anthropic', key: 'sk-test', model: '' });
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ content: [{ text: 'whole' }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect((await complete({ messages: [{ role: 'user', content: 'hi' }] })).text).toBe('whole');
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body.stream).toBeUndefined();
  });
});
