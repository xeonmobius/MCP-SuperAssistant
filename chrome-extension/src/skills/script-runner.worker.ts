/// <reference lib="webworker" />
/**
 * Sandboxed script runner (Phase 2). Lives in a dedicated Web Worker — no
 * chrome.*, no DOM, no window. Killed by script-executor.ts after 30s.
 *
 * Protocol (request):  { language: 'wasm'|'py', code: ArrayBuffer, args: unknown }
 * Protocol (response): { ok: true, result: unknown } | { ok: false, error: string }
 *
 * Conventions:
 *  - WASM: module must export `run(argsJson: string) -> string` (JSON in/out).
 *  - Python: user code runs with `args` in scope; it must assign `_result`
 *    (JSON-serializable) which is returned. Missing `_result` -> null.
 */

type Req = { language: 'wasm' | 'py'; code: ArrayBuffer; args: unknown };
type Res = { ok: true; result: unknown } | { ok: false; error: string };

const PYODIDE_INDEX = 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/';

// Cached across postMessages within one Worker lifetime.
let pyodidePromise: Promise<unknown> | undefined;

async function getPyodide(): Promise<any> {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      // @vite-ignore keeps Vite from trying to bundle this cross-origin import;
      // it resolves at runtime against the worker's CSP-allowed script-src.
      const mod = await import(/* @vite-ignore */ `${PYODIDE_INDEX}pyodide.mjs`);
      return mod.loadPyodide({ indexURL: PYODIDE_INDEX });
    })();
  }
  return pyodidePromise;
}

async function runWasm(code: ArrayBuffer, args: unknown): Promise<unknown> {
  const { instance } = await WebAssembly.instantiate(code, {});
  const exports = instance.exports as { run?: (s: string) => string | unknown };
  if (typeof exports.run !== 'function') {
    throw new Error("WASM module has no exported function 'run'");
  }
  const argsJson = typeof args === 'string' ? args : JSON.stringify(args ?? {});
  const raw = exports.run(argsJson);
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function runPython(code: ArrayBuffer | string, args: unknown): Promise<unknown> {
  const pyodide = await getPyodide();
  const src = typeof code === 'string' ? code : new TextDecoder().decode(code);
  pyodide.globals.set('args', args as unknown);
  // `_result` convention: user code assigns it. We emit a sentinel so we can
  // tell "not assigned" (-> null) apart from "assigned null".
  await pyodide.runPythonAsync(
    `${src}\nimport json as _json\n` +
      `_out = _json.dumps(_result) if "_result" in globals() else "\u0000__none__\u0000"\n`,
  );
  const out = pyodide.globals.get('_out') as string;
  if (out === '\u0000__none__\u0000') return null;
  try {
    return JSON.parse(out);
  } catch {
    return out;
  }
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const { language, code, args } = e.data ?? {};
  try {
    const result = language === 'wasm'
      ? await runWasm(code, args)
      : await runPython(code, args);
    (postMessage as (m: Res) => void)({ ok: true, result });
  } catch (err) {
    (postMessage as (m: Res) => void)({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
