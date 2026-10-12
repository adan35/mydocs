/// <reference lib="webworker" />
import { ops, type OpName } from './ops';

self.onmessage = (e: MessageEvent<{ id: number; op: OpName; input: unknown }>) => {
  const { id, op, input } = e.data;
  try {
    const result = (ops[op] as (i: unknown) => unknown)(input);
    const transfer: Transferable[] = [];
    const data = (result as { data?: unknown }).data;
    if (data instanceof Uint8Array) transfer.push(data.buffer);
    (self as unknown as Worker).postMessage({ id, ok: true, result }, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
