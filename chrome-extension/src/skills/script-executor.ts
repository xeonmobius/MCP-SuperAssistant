import type { ScriptLanguage } from './uploaded-parser';

/** Minimal Worker surface the executor depends on (real Worker satisfies this). */
export interface WorkerLike {
  postMessage(msg: unknown): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: { message: string }) => void) | null;
  terminate(): void;
}

export interface ExecuteOptions {
  language: ScriptLanguage;
  code: ArrayBuffer;
  args: unknown;
  /** Default 30_000ms. */
  timeoutMs?: number;
  /** Override for tests; default creates the bundled module worker. */
  workerFactory?: () => WorkerLike;
}

export type ExecuteResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

export const DEFAULT_SCRIPT_TIMEOUT_MS = 30_000;

function defaultWorkerFactory(): WorkerLike {
  // Vite recognises this exact pattern and emits the worker as a separate chunk.
  return new Worker(
    new URL('./script-runner.worker.ts', import.meta.url),
    { type: 'module' },
  ) as unknown as WorkerLike;
}

/**
 * Run a skill script in a sandboxed Web Worker. Resolves with the worker's
 * result, an error message, or a timeout error — never rejects. The worker is
 * always terminated exactly once.
 */
export function executeScript(opts: ExecuteOptions): Promise<ExecuteResult> {
  const { language, code, args } = opts;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS;
  const workerFactory = opts.workerFactory ?? defaultWorkerFactory;

  return new Promise(resolve => {
    let worker: WorkerLike;
    try {
      worker = workerFactory();
    } catch (err) {
      resolve({ ok: false, error: `Failed to start worker: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    let settled = false;
    const finish = (res: ExecuteResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { worker.terminate(); } catch { /* already gone */ }
      resolve(res);
    };
    const timer = setTimeout(
      () => finish({ ok: false, error: `Script exceeded ${timeoutMs}ms timeout` }),
      timeoutMs,
    );
    worker.onmessage = (e: { data: unknown }) => {
      const d = e.data as { ok?: boolean; result?: unknown; error?: string };
      if (d && d.ok === true) finish({ ok: true, result: d.result });
      else finish({ ok: false, error: d?.error ?? 'Worker returned no result' });
    };
    worker.onerror = (e: { message: string }) =>
      finish({ ok: false, error: e.message || 'Worker error' });
    try {
      worker.postMessage({ language, code, args });
    } catch (err) {
      finish({ ok: false, error: `Failed to post message: ${err instanceof Error ? err.message : String(err)}` });
    }
  });
}
