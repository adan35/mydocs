import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiSource, complete, thinkFilter, useAiSettings } from '../ai';
import { describeSheet, parseSheetAnswer, rowsToSend, type SheetContext } from './sheet';

const grid = (rows: string[][], over: Partial<SheetContext> = {}): SheetContext => ({
  name: 'Sales',
  rowCount: rows.length,
  colCount: Math.max(...rows.map((r) => r.length)),
  cell: (r, c) => rows[r]?.[c] ?? '',
  formulas: true,
  ...over,
});

describe('thinkFilter', () => {
  const run = (pieces: string[]) => {
    const f = thinkFilter();
    return pieces.map((p) => f.push(p)).join('') + f.end();
  };
  it('drops thinking and keeps the answer', () => {
    expect(run(['<think>hmm</think>Hello'])).toBe('Hello');
  });
  it('handles tags split across pieces', () => {
    expect(run(['A<th', 'ink>secret</thi', 'nk>B'])).toBe('AB');
  });
  it('keeps a lone < that is not a tag', () => {
    expect(run(['1 < 2'])).toBe('1 < 2');
    expect(run(['x <'])).toBe('x <');
  });
  it('shows nothing when thinking never ends', () => {
    expect(run(['ok <think>never closed'])).toBe('ok ');
  });
});

describe('private mode', () => {
  afterEach(() => vi.unstubAllGlobals());
  const ask = [{ role: 'user' as const, content: 'hi' }];
  const body = (m: ReturnType<typeof vi.fn>) =>
    JSON.parse((m.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);

  it('needs a model, and never falls back to a key or the shared allowance', async () => {
    useAiSettings.setState({ provider: 'local', model: '', key: 'sk-cloud' });
    expect(aiSource()).toBe('none');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(complete({ messages: ask })).rejects.toThrow(/model/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls only the local server, without the saved cloud key', async () => {
    useAiSettings.setState({
      provider: 'local',
      model: 'llama3.2',
      key: 'sk-cloud',
      baseUrl: 'http://localhost:11434/v1/',
    });
    expect(aiSource()).toBe('local');
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: '<think>x</think>\n\nDone' } }] }),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const r = await complete({ system: 'be brief', messages: ask, maxTokens: 50 });
    expect(r).toEqual({ text: 'Done', via: 'local' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(JSON.stringify(init.headers)).not.toMatch(/authorization|sk-cloud/i);
    expect(body(fetchMock)).toMatchObject({ model: 'llama3.2', max_tokens: 50 });
  });

  it('streams and hides thinking', async () => {
    useAiSettings.setState({
      provider: 'local',
      model: 'qwen',
      baseUrl: 'http://localhost:1234/v1',
    });
    const events = [
      '{"choices":[{"delta":{"content":"<think>plan"}}]}',
      '{"choices":[{"delta":{"content":"</think>He"}}]}',
      '{"choices":[{"delta":{"content":"llo"}}]}',
      '[DONE]',
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(events.map((e) => `data: ${e}\n\n`).join(''))),
    );
    const chunks: string[] = [];
    const r = await complete({ messages: ask }, { onText: (c) => chunks.push(c) });
    expect(chunks.join('')).toBe('Hello');
    expect(r.text).toBe('Hello');
  });

  it('explains an unreachable server', async () => {
    useAiSettings.setState({ provider: 'local', model: 'm', baseUrl: 'http://localhost:9/v1' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('fail'))),
    );
    await expect(complete({ messages: ask })).rejects.toThrow(/localhost:9.*OLLAMA_ORIGINS/);
  });

  it('reads a plain-text error from the server', async () => {
    useAiSettings.setState({
      provider: 'local',
      model: 'nope',
      baseUrl: 'http://localhost:11434/v1',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'model "nope" not found' }), { status: 404 }),
      ),
    );
    await expect(complete({ messages: ask })).rejects.toThrow(/not found/);
  });
});

describe('sheet helper', () => {
  const rows = [
    ['Item', 'Qty', 'Price', 'Total'],
    ['Tap', '2', '5', ''],
    ['Pipe', '3', '4', ''],
  ];

  it('describes columns, rows and the selection', () => {
    const { text, rows: sent } = describeSheet(grid(rows, { selection: [1, 3, 2, 3] }));
    expect(sent).toEqual([0, 1, 2]);
    expect(text).toContain('Selected cells: D2:D3');
    expect(text).toContain('Columns: A, B, C, D');
    expect(text).toContain('2\tTap\t2\t5\t');
  });

  it('sends the header and the selected rows of a long sheet', () => {
    const big = grid(
      Array.from({ length: 500 }, (_, i) => [`r${i}`]),
      { selection: [300, 0, 310, 0] },
    );
    const sent = rowsToSend(big);
    expect(sent[0]).toBe(0);
    expect(sent).toContain(300);
    expect(sent).toContain(310);
    expect(sent.length).toBeLessThanOrEqual(120);
    expect(rowsToSend(grid(rows, { selection: [0, 0, 0, 0] }))).toEqual([0, 1, 2]);
  });

  it('keeps valid edits and drops the rest', () => {
    const ctx = grid(rows);
    const out = parseSheetAnswer(
      {
        answer: 'Added totals.',
        edits: [
          { cell: 'D2', value: '=B2*C2' },
          { cell: 'd3', value: '=B3*C3' },
          { cell: 'D9', value: 'far away existing row?' },
          { cell: 'A1', value: 'Item' }, // unchanged
          { cell: 'ZZ1', value: 'x' }, // column too far
          { cell: 'nonsense', value: 'x' },
          { cell: 'D4', value: 'new row ok' },
          { cell: 'B2', value: 7 },
        ],
      },
      ctx,
      [0, 1, 2],
    );
    expect(out.answer).toBe('Added totals.');
    expect(out.edits.map((e) => `${e.r}:${e.c}=${e.value}`)).toEqual([
      '1:1=7',
      '1:3==B2*C2',
      '2:3==B3*C3',
      '3:3=new row ok',
    ]);
    // D9 would leave a gap under the sheet.
    expect(out.skipped).toBe(3);
  });

  it('refuses formulas for files that hold values only', () => {
    const out = parseSheetAnswer(
      {
        edits: [
          { cell: 'D2', value: '=1+1' },
          { cell: 'D3', value: '8' },
        ],
      },
      grid(rows, { formulas: false }),
      [0, 1, 2],
    );
    expect(out.edits).toEqual([{ r: 2, c: 3, value: '8' }]);
    expect(out.skipped).toBe(1);
  });

  it('flattens line breaks, takes the last answer for a cell and tolerates junk', () => {
    const out = parseSheetAnswer(
      {
        edits: [{ cell: 'D2', value: 'a\nb' }, { cell: 'D2', value: 'final\n  text' }, null, 'x'],
      },
      grid(rows),
      [0, 1, 2],
    );
    expect(out.edits).toEqual([{ r: 1, c: 3, value: 'final text' }]);
    expect(parseSheetAnswer('nope', grid(rows), [0])).toEqual({
      answer: '',
      edits: [],
      skipped: 0,
    });
  });
});
