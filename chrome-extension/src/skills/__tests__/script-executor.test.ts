import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeScript, type WorkerLike } from '../script-executor';

/**
 * Fake worker. The executor sets onmessage/onerror and calls postMessage; the
 * test flips `resp`/`err` then invokes the captured handler.
 */
function fakeWorkerFactory(capture: { worker: WorkerLike }) {
  return () => {
    const w: WorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    };
    capture.worker = w;
    return w;
  };
}

describe('executeScript', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('posts {language, code, args} and resolves with the worker result', async () => {
    const cap = { worker: null as unknown as WorkerLike };
    const p = executeScript({
      language: 'wasm',
      code: new ArrayBuffer(4),
      args: { x: 1 },
      timeoutMs: 5000,
      workerFactory: fakeWorkerFactory(cap),
    });
    await vi.advanceTimersByTimeAsync(0); // let executor attach handlers + post
    expect(cap.worker.postMessage).toHaveBeenCalledWith({
      language: 'wasm',
      code: expect.any(ArrayBuffer),
      args: { x: 1 },
    });
    cap.worker.onmessage!({ data: { ok: true, result: 42 } });
    await expect(p).resolves.toEqual({ ok: true, result: 42 });
    expect(cap.worker.terminate).toHaveBeenCalled();
  });

  it('resolves with an error object when the worker reports failure', async () => {
    const cap = { worker: null as unknown as WorkerLike };
    const p = executeScript({
      language: 'py',
      code: new ArrayBuffer(0),
      args: null,
      workerFactory: fakeWorkerFactory(cap),
    });
    await vi.advanceTimersByTimeAsync(0);
    cap.worker.onmessage!({ data: { ok: false, error: 'boom' } });
    await expect(p).resolves.toEqual({ ok: false, error: 'boom' });
    expect(cap.worker.terminate).toHaveBeenCalled();
  });

  it('terminates + resolves with a timeout error after timeoutMs', async () => {
    const cap = { worker: null as unknown as WorkerLike };
    const p = executeScript({
      language: 'wasm',
      code: new ArrayBuffer(0),
      args: {},
      timeoutMs: 1000,
      workerFactory: fakeWorkerFactory(cap),
    });
    await vi.advanceTimersByTimeAsync(0);
    // Worker never responds.
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toMatchObject({ ok: false, error: expect.stringContaining('timeout') });
    expect(cap.worker.terminate).toHaveBeenCalled();
  });

  it('resolves with an error when the worker throws onerror', async () => {
    const cap = { worker: null as unknown as WorkerLike };
    const p = executeScript({
      language: 'wasm',
      code: new ArrayBuffer(0),
      args: {},
      workerFactory: fakeWorkerFactory(cap),
    });
    await vi.advanceTimersByTimeAsync(0);
    cap.worker.onerror!({ message: 'worker exploded' });
    await expect(p).resolves.toMatchObject({ ok: false, error: 'worker exploded' });
    expect(cap.worker.terminate).toHaveBeenCalled();
  });

  it('does not leak a late worker response after timeout', async () => {
    const cap = { worker: null as unknown as WorkerLike };
    const p = executeScript({
      language: 'wasm',
      code: new ArrayBuffer(0),
      args: {},
      timeoutMs: 500,
      workerFactory: fakeWorkerFactory(cap),
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    const settled = await p;
    expect(settled.ok).toBe(false);
    // Late response after terminate should be a no-op (resolve already called).
    expect(() => cap.worker.onmessage!({ data: { ok: true, result: 'late' } })).not.toThrow();
  });

  it('default timeout is 30000ms', async () => {
    const cap = { worker: null as unknown as WorkerLike };
    const p = executeScript({
      language: 'wasm',
      code: new ArrayBuffer(0),
      args: {},
      workerFactory: fakeWorkerFactory(cap),
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(29999);
    // Not yet timed out.
    let settled = false;
    p.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(settled).toBe(true);
  });
});
