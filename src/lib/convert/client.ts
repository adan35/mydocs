/**
 * Runs conversions in a Web Worker so large files never freeze the editor. Falls back
 * to running in place where workers aren't available (tests, very old web views).
 */
import type { Ops, OpName } from './ops';

let worker: Worker | null = null;
let failed = false;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker || failed) return worker;
  if (typeof Worker === 'undefined') {
    failed = true;
    return null;
  }
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (
      e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>,
    ) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      e.preventDefault();
      for (const p of pending.values()) p.reject(new Error('The converter stopped unexpectedly.'));
      pending.clear();
      worker?.terminate();
      worker = null;
      failed = true;
    };
  } catch {
    failed = true;
  }
  return worker;
}

export async function convert<K extends OpName>(
  op: K,
  input: Parameters<Ops[K]>[0],
): Promise<ReturnType<Ops[K]>> {
  const w = getWorker();
  if (!w) {
    const { ops } = await import('./ops');
    return (ops[op] as (i: unknown) => ReturnType<Ops[K]>)(input);
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ id, op, input });
  });
}
