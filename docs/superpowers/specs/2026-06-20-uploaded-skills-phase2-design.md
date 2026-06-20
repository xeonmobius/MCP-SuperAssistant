# Uploaded Skills — Phase 2: Executable Scripts (WASM + Python)

## Problem
Phase 1 lets users upload skills with text references. Skills are instructional (the AI reads + follows them). Phase 2 adds **executable scripts** — skills that ship code (`.wasm` or `.py`) which runs in a sandboxed Worker when the AI calls the skill. No local installation; pure browser execution.

## Constraints
- **No local install** — security requirement. All execution happens in the browser.
- **Multi-language**: WASM (`.wasm`, compiled from C/Rust/Go) + Python (`.py`, via Pyodide). JS deferred (MV3 CSP blocks `eval`/`new Function` without `'unsafe-eval'`).
- **Sandboxed**: scripts run in a Web Worker with no `chrome.*`, no DOM, no filesystem. WASM gets an additional memory sandbox. Python runs inside Pyodide's WASM-sandboxed CPython.
- **WASM CSP**: MV3 requires `'wasm-unsafe-eval'` in `extension_pages` CSP for `WebAssembly.instantiate`. Python (Pyodide) is itself WASM — same directive covers it.
- **Pyodide CDN**: first load fetches ~10MB from `cdn.jsdelivr.net`; cached after via Cache API. Requires `script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net` in CSP.
- **Timeout**: 30s per execution (prevent infinite loops).
- **Phase 1 reuse**: script blobs stored in the same IndexedDB DB (`mcp-skills`), in a new `scripts` object store alongside `references`. The upload flow (folder picker / drag-drop) handles script files.

## Non-Goals
- JS script execution (MV3 CSP blocks `eval`/`new Function`; deferred until offscreen-sandbox-iframe approach is built).
- Network access from scripts (no `fetch` from the Worker unless explicitly granted in a future phase).
- Interactive scripts (REPL, long-running processes). Scripts are one-shot: args in → result out.
- Sandboxed iframe approach for JS (future phase).

## Architecture

**Worker-based execution.** The background service worker creates a `new Worker(chrome.runtime.getURL('script-runner.js'))` — a Vite-bundled Worker file (same-origin, passes MV3 `worker-src 'self'` CSP). The Worker:
1. Receives `{language, code, args}` via `postMessage`.
2. For `.wasm`: `WebAssembly.instantiate(code, {})` (no imports = pure compute) → calls `instance.exports.run(args)`.
3. For `.py`: loads Pyodide (from cache or CDN) → `pyodide.runPythonAsync(code)` with `args` injected as a global.
4. Returns `{result}` or `{error}` via `postMessage`.
5. Timeout: the background kills the Worker after 30s if no response.

**Message flow when the AI calls a skill with a `run` script:**
```
AI → skill_<name>({args}) → background handler
  → reads skill metadata (has `run: scripts/analyze.wasm`?)
  → reads script blob from IDB `scripts` store
  → creates Worker → postMessage({language, code, args})
  → Worker runs → postMessage({result})
  → background returns result to AI
```

If the skill has NO `run` script → returns the skill content (Phase 1 behavior, unchanged).

## Data Model

### Skill frontmatter extension
```yaml
---
name: ats-scorer
description: Score a resume against a job posting.
run: scripts/score.wasm     # path relative to skill folder; .wasm | .py
---
```

The `run` field is optional. If present, the script file is stored as a blob in IDB. If absent, the skill is instructional only (Phase 1 behavior).

### UploadedSkill metadata (extended)
```ts
interface UploadedSkill {
  // ... existing fields ...
  run?: string;            // script path (e.g. 'scripts/score.wasm') | undefined
}
```

### IndexedDB — new `scripts` store
DB `mcp-skills`, store `scripts`:
- key: `${skillName}::${scriptPath}`
- value: `{ skillName, path, blob: ArrayBuffer, language: 'wasm' | 'py', size, uploadedAt }`
- index: `skillName` (cascade delete on skill removal)

## Components

| File | Action | Responsibility |
|---|---|---|
| `chrome-extension/src/skills/uploaded-parser.ts` | **Modify** | Detect `run:` frontmatter; detect `.wasm`/`.py` files; include script entries in the parsed output |
| `chrome-extension/src/skills/uploaded-store.ts` | **Modify** | Add `saveScript`, `readScript`, `deleteScripts` for the `scripts` IDB store |
| `chrome-extension/src/skills/script-runner.worker.ts` | **Create** | The Worker: receives `{language, code, args}`, instantiates WASM or Pyodide, runs, returns result |
| `chrome-extension/src/skills/script-executor.ts` | **Create** | Creates the Worker, sends the script + args, enforces 30s timeout, returns result |
| `chrome-extension/src/background/index.ts` | **Modify** | In the `skill_*` handler: if skill has `run`, call `scriptExecutor.run(skill, args)` instead of returning content |
| `chrome-extension/manifest.ts` | **Modify** | Add `'wasm-unsafe-eval'` + `https://cdn.jsdelivr.net` to CSP |

## Security Model
- **WASM**: instantiated with `{}` imports (no JS bridge). Pure compute — can't call `fetch`, `chrome.*`, or any JS API. Memory-sandboxed by design.
- **Python**: Pyodide's CPython runs inside WASM. The `js` module bridge is available but limited to what the Worker provides (no `chrome.*`, no DOM). `fetch` available only if explicitly passed as an import.
- **Worker**: no `chrome.*` APIs, no DOM, no `window`. Separate JS context. Killed after timeout.
- **Trust**: user-uploaded scripts are trusted (the user chose to upload them). The sandbox prevents accidental damage, not malicious attacks by the user against themselves.

## Testing (TDD)
- `uploaded-parser.test.ts`: `run:` frontmatter parsing + `.wasm`/`.py` file detection.
- `uploaded-store.test.ts`: script blob save/read/delete in the `scripts` store.
- `script-executor.test.ts`: Worker creation + timeout + error handling (mock the Worker).
- Integration: the `skill_*` handler routes to the executor when `run` is present.

## Success Criteria
- Upload a skill with `run: scripts/hello.wasm` → AI calls `skill_<name>({...})` → WASM executes → result returned.
- Upload a skill with `run: scripts/analyze.py` → AI calls skill → Python runs via Pyodide → result returned.
- Skill without `run` → returns content (Phase 1 behavior, no regression).
- 30s timeout kills runaway scripts.
- No `chrome.*`, no DOM, no filesystem access from scripts.
- CSP allows WASM + Pyodide CDN without warnings.
