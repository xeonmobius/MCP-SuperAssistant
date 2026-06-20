# Builtin Browser Server — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an in-extension, serverless MCP server (no binary/port/Node/remote) exposing browser-native tools (`web_fetch`, `page_read`, `selection_read`, `extract_links`, `clipboard_write`, `notes_read`, `notes_write`), selectable as a new `'builtin'` transport.

**Architecture:** A `BuiltinPlugin` (transport `'builtin'`) spins up an MCP `Server` inside the extension service worker and links it to the existing `McpClient` via `InMemoryTransport.createLinkedPair()` from the MCP SDK. New tool handlers run in the SW; page-reading tools use `chrome.scripting.executeScript` on the active tab.

**Tech Stack:** TypeScript, vitest, `@modelcontextprotocol/sdk` v1.19.1 (`Server` + `InMemoryTransport`), Chrome extension MV3 APIs (`tabs`, `scripting`, `storage`, `clipboard`), React/Zustand (existing UI).

**Spec:** `docs/superpowers/specs/2026-06-17-builtin-browser-server-design.md`

---

## File Structure

### New — builtin plugin + server + tools (all under `chrome-extension/src/mcpclient/plugins/builtin/`)
- `BuiltinPlugin.ts` (+ `.test.ts`) — `ITransportPlugin`; `connect()` links client↔server via `InMemoryTransport`
- `server/BuiltinServer.ts` (+ `.test.ts`) — `createServer()` returns MCP `Server` with tool handlers
- `tools/web_fetch.ts` (+ `.test.ts`)
- `tools/page_read.ts` (+ `.test.ts`) — also handles `selection_read`, `extract_links` (shared `executeScript` helper)
- `tools/clipboard.ts` (+ `.test.ts`) — `clipboard_write` (+ `clipboard_read` deferred — see Task 4)
- `tools/notes.ts` (+ `.test.ts`) — `notes_read`, `notes_write`

### Modified — integration
- `chrome-extension/src/mcpclient/types/plugin.ts` — `TransportType` += `'builtin'`
- `chrome-extension/src/mcpclient/types/config.ts` — `BuiltinPluginConfig` + default in `DEFAULT_CLIENT_CONFIG`
- `chrome-extension/src/mcpclient/core/PluginRegistry.ts` — import + register `BuiltinPlugin`
- `chrome-extension/src/mcpclient/index.ts` — `detectTransportType('builtin:')`
- `chrome-extension/src/background/index.ts` — `DEFAULT_BUILTIN_URI` + default-URL branch
- `pages/content/src/types/stores.ts` — `ConnectionType` += `'builtin'` (the two-union lesson)
- `pages/content/src/hooks/useMcpCommunication.ts` — guard += `'builtin'`
- `pages/content/src/components/sidebar/ServerStatus/ServerStatus.tsx` — `<option value="builtin">`
- `chrome-extension/manifest.ts` — `permissions` += `activeTab, scripting, clipboardWrite, tabs`; `host_permissions` += `<all_urls>`

---

## Task 1: `'builtin'` type plumbing

**Files:**
- Modify: `chrome-extension/src/mcpclient/types/plugin.ts`
- Modify: `chrome-extension/src/mcpclient/types/config.ts`
- Modify: `pages/content/src/types/stores.ts`

- [ ] **Step 1: Extend both unions.**

`chrome-extension/src/mcpclient/types/plugin.ts` line 4:
```ts
export type TransportType = 'sse' | 'websocket' | 'streamable-http' | 'native' | 'builtin';
```

`pages/content/src/types/stores.ts` — the `ConnectionType` union (add `'builtin'` alongside `'native'`):
```ts
export type ConnectionType = 'sse' | 'websocket' | 'streamable-http' | 'native' | 'builtin';
```
(Read the file first; the union may be defined inline on the `connectionType` field — add `'builtin'` there.)

- [ ] **Step 2: Add config type + default.**

In `chrome-extension/src/mcpclient/types/config.ts`, after `NativePluginConfig`:
```ts
export interface BuiltinPluginConfig extends PluginConfig {
  // reserved for future options; intentionally empty for Phase 1
}
```
Add `builtin?: BuiltinPluginConfig;` to `ClientConfig.plugins`, and to `DEFAULT_CLIENT_CONFIG.plugins`:
```ts
    builtin: {},
```

- [ ] **Step 3: Verify.**

`cd chrome-extension && ./node_modules/.bin/tsc --noEmit` — Expected: green (no NEW errors; chrome-extension baseline is green). The `McpClient.ts` `this.config.plugins[type]` line stays happy because `builtin` is now a key.

- [ ] **Step 4: Commit**

```bash
git add chrome-extension/src/mcpclient/types/plugin.ts chrome-extension/src/mcpclient/types/config.ts pages/content/src/types/stores.ts
git commit -m "feat(extension): add 'builtin' to transport + connection type unions"
```

---

## Task 2: `web_fetch` + `notes` tools — TDD

**Files:**
- Create: `chrome-extension/src/mcpclient/plugins/builtin/tools/web_fetch.ts`
- Create: `chrome-extension/src/mcpclient/plugins/builtin/tools/notes.ts`
- Test: `chrome-extension/src/mcpclient/plugins/builtin/tools/web_fetch.test.ts`
- Test: `chrome-extension/src/mcpclient/plugins/builtin/tools/notes.test.ts`

- [ ] **Step 1: Write failing tests.**

`web_fetch.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleWebFetch } from './web_fetch';

describe('web_fetch', () => {
  afterEach(() => vi.restoreAllMocks());
  it('lists web_fetch in its tool def', async () => {
    const { webFetchTool } = await import('./web_fetch');
    expect(webFetchTool.name).toBe('web_fetch');
  });
  it('returns fetched text stripped of tags, capped', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '<script>bad()</script><p>Hello <b>world</b></p>',
    } as any)));
    const res = await handleWebFetch({ url: 'https://example.com' });
    expect(res.content[0].text).toMatch(/Hello world/);
    expect(res.content[0].text).not.toMatch(/bad\(\)/);
  });
  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, text: async () => '' } as any)));
    await expect(handleWebFetch({ url: 'https://nope' })).rejects.toThrow(/404/);
  });
});
```

`notes.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { handleNotes, notesTool } from './notes';

const mem: Record<string, any> = {};
beforeEach(() => {
  mem = {};
  (globalThis as any).chrome = {
    storage: { local: {
      get: async (k: string) => (k in mem ? { [k]: mem[k] } : {}),
      set: async (items: Record<string, any>) => { Object.assign(mem, items); },
    } },
  };
});

describe('notes', () => {
  it('notesTool exposes notes_read and notes_write', () => {
    expect(notesTool.map((t: any) => t.name)).toEqual(['notes_read', 'notes_write']);
  });
  it('writes then reads a note', async () => {
    await handleNotes('notes_write', { key: 'todo', text: 'buy milk' });
    const res = await handleNotes('notes_read', { key: 'todo' });
    expect(res.content[0].text).toBe('buy milk');
  });
  it('notes_read on missing key returns empty-ish marker', async () => {
    const res = await handleNotes('notes_read', { key: 'nope' });
    expect(res.content[0].text).toMatch(/no note/i);
  });
});
```

- [ ] **Step 2: Run, confirm fail.** `cd chrome-extension && ./node_modules/.bin/vitest run src/mcpclient/plugins/builtin/tools/web_fetch.test.ts src/mcpclient/plugins/builtin/tools/notes.test.ts` → FAIL (modules not found).

- [ ] **Step 3: Implement.**

`web_fetch.ts`:
```ts
import { ToolDef } from './types';

export const webFetchTool: ToolDef = {
  name: 'web_fetch',
  description: 'Fetch a URL and return its text content (HTML tags stripped, capped).',
  inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
};

const MAX = 20000;

export async function handleWebFetch(args: { url?: string }): Promise<{ content: { type: 'text'; text: string }[] }> {
  const url = String(args.url ?? '');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`web_fetch failed: HTTP ${res.status}`);
  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX);
  return { content: [{ type: 'text', text }] };
}
```

`notes.ts`:
```ts
import { ToolDef } from './types';

export const notesTool: ToolDef[] = [
  { name: 'notes_read', description: 'Read a saved note by key.', inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } },
  { name: 'notes_write', description: 'Save a note under a key.', inputSchema: { type: 'object', properties: { key: { type: 'string' }, text: { type: 'string' } }, required: ['key', 'text'] } },
];

const NS = 'mcp_builtin_notes_';

export async function handleNotes(name: string, args: { key?: string; text?: string }): Promise<{ content: { type: 'text'; text: string }[] }> {
  const key = String(args.key ?? '');
  if (name === 'notes_write') {
    await chrome.storage.local.set({ [NS + key]: String(args.text ?? '') });
    return { content: [{ type: 'text', text: `saved note '${key}'` }] };
  }
  if (name === 'notes_read') {
    const res = await chrome.storage.local.get(NS + key);
    const text = (res as any)[NS + key];
    return { content: [{ type: 'text', text: typeof text === 'string' ? text : `(no note for key '${key}')` }] };
  }
  throw new Error(`Unknown notes tool: ${name}`);
}
```

Create `chrome-extension/src/mcpclient/plugins/builtin/tools/types.ts`:
```ts
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}
```

- [ ] **Step 4: Run, confirm pass.** → PASS.

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/mcpclient/plugins/builtin/tools/web_fetch.ts chrome-extension/src/mcpclient/plugins/builtin/tools/web_fetch.test.ts chrome-extension/src/mcpclient/plugins/builtin/tools/notes.ts chrome-extension/src/mcpclient/plugins/builtin/tools/notes.test.ts chrome-extension/src/mcpclient/plugins/builtin/tools/types.ts
git commit -m "feat(builtin): web_fetch + notes tools"
```

---

## Task 3: `page_read` / `selection_read` / `extract_links` — TDD

**Files:**
- Create: `chrome-extension/src/mcpclient/plugins/builtin/tools/page_read.ts`
- Test: `chrome-extension/src/mcpclient/plugins/builtin/tools/page_read.test.ts`

- [ ] **Step 1: Write failing test.**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { handlePageTool, pageTools } from './page_read';

function mockTab(executeResult: any) {
  (globalThis as any).chrome = {
    tabs: { query: async () => [{ id: 42, url: 'https://x' }] },
    scripting: { executeScript: async () => [executeResult] },
  };
}

describe('page tools', () => {
  it('exposes page_read, selection_read, extract_links', () => {
    expect(pageTools.map((t) => t.name)).toEqual(['page_read', 'selection_read', 'extract_links']);
  });
  it('page_read returns the active tab innerText', async () => {
    mockTab({ result: 'Hello page' });
    const res = await handlePageTool('page_read', {});
    expect(res.content[0].text).toBe('Hello page');
  });
  it('selection_read returns the active selection', async () => {
    mockTab({ result: 'highlighted text' });
    const res = await handlePageTool('selection_read', {});
    expect(res.content[0].text).toBe('highlighted text');
  });
  it('extract_links returns a newline-joined list', async () => {
    mockTab({ result: ['https://a', 'https://b'] });
    const res = await handlePageTool('extract_links', {});
    expect(res.content[0].text).toBe('https://a\nhttps://b');
  });
  it('throws when there is no active tab', async () => {
    (globalThis as any).chrome = { tabs: { query: async () => [] }, scripting: { executeScript: async () => [] } };
    await expect(handlePageTool('page_read', {})).rejects.toThrow(/active tab/i);
  });
});
```

- [ ] **Step 2: Run, confirm fail.**

- [ ] **Step 3: Implement.**

```ts
import { ToolDef } from './types';

export const pageTools: ToolDef[] = [
  { name: 'page_read', description: 'Read the active tab\'s visible text.', inputSchema: { type: 'object', properties: {} } },
  { name: 'selection_read', description: 'Read the text currently selected on the active tab.', inputSchema: { type: 'object', properties: {} } },
  { name: 'extract_links', description: 'List link hrefs on the active tab.', inputSchema: { type: 'object', properties: {} } },
];

async function runInActiveTab<T>(func: () => T): Promise<T> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: func as any });
  return res?.result as T;
}

export async function handlePageTool(name: string, _args: Record<string, unknown>): Promise<{ content: { type: 'text'; text: string }[] }> {
  if (name === 'page_read') {
    const text = await runInActiveTab(() => document.body?.innerText ?? '');
    return { content: [{ type: 'text', text: String(text) }] };
  }
  if (name === 'selection_read') {
    const text = await runInActiveTab(() => window.getSelection()?.toString() ?? '');
    return { content: [{ type: 'text', text: String(text) }] };
  }
  if (name === 'extract_links') {
    const links = await runInActiveTab(() => Array.from(document.querySelectorAll('a[href]')).map((a) => (a as HTMLAnchorElement).href));
    return { content: [{ type: 'text', text: (links as string[]).join('\n') }] };
  }
  throw new Error(`Unknown page tool: ${name}`);
}
```

- [ ] **Step 4: Run, confirm pass.**

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/mcpclient/plugins/builtin/tools/page_read.ts chrome-extension/src/mcpclient/plugins/builtin/tools/page_read.test.ts
git commit -m "feat(builtin): page_read / selection_read / extract_links tools"
```

---

## Task 4: `clipboard_write` (read deferred) — TDD

**Files:**
- Create: `chrome-extension/src/mcpclient/plugins/builtin/tools/clipboard.ts`
- Test: `chrome-extension/src/mcpclient/plugins/builtin/tools/clipboard.test.ts`

Note: `clipboard_read` in an MV3 service worker is unreliable without an offscreen document. **Phase 1 ships `clipboard_write` only.** `clipboard_read` is deferred (tracked in spec Open Questions) — do NOT stub it.

- [ ] **Step 1: Write failing test.**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleClipboard, clipboardTool } from './clipboard';

describe('clipboard', () => {
  afterEach(() => vi.restoreAllMocks());
  it('exposes clipboard_write only (read deferred)', () => {
    expect(clipboardTool.map((t) => t.name)).toEqual(['clipboard_write']);
  });
  it('clipboard_write calls navigator.clipboard.writeText', async () => {
    const write = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText: write } });
    const res = await handleClipboard('clipboard_write', { text: 'hi' });
    expect(write).toHaveBeenCalledWith('hi');
    expect(res.content[0].text).toMatch(/copied/i);
  });
});
```

- [ ] **Step 2: Run, confirm fail.**

- [ ] **Step 3: Implement.**

```ts
import { ToolDef } from './types';

export const clipboardTool: ToolDef[] = [
  { name: 'clipboard_write', description: 'Write text to the clipboard.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
];

export async function handleClipboard(name: string, args: { text?: string }): Promise<{ content: { type: 'text'; text: string }[] }> {
  if (name === 'clipboard_write') {
    await navigator.clipboard.writeText(String(args.text ?? ''));
    return { content: [{ type: 'text', text: 'copied to clipboard' }] };
  }
  throw new Error(`Unknown clipboard tool: ${name}`);
}
```

- [ ] **Step 4: Run, confirm pass.**

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/mcpclient/plugins/builtin/tools/clipboard.ts chrome-extension/src/mcpclient/plugins/builtin/tools/clipboard.test.ts
git commit -m "feat(builtin): clipboard_write tool (read deferred)"
```

---

## Task 5: `BuiltinServer` + `BuiltinPlugin` (InMemoryTransport link) — TDD

**Files:**
- Create: `chrome-extension/src/mcpclient/plugins/builtin/server/BuiltinServer.ts`
- Create: `chrome-extension/src/mcpclient/plugins/builtin/BuiltinPlugin.ts`
- Test: `chrome-extension/src/mcpclient/plugins/builtin/BuiltinPlugin.test.ts`

- [ ] **Step 1: Implement `BuiltinServer.ts`** (aggregates the tool handlers):

```ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { webFetchTool, handleWebFetch } from '../tools/web_fetch';
import { notesTool, handleNotes } from '../tools/notes';
import { pageTools, handlePageTool } from '../tools/page_read';
import { clipboardTool, handleClipboard } from '../tools/clipboard';

export function createBuiltinServer(): Server {
  const server = new Server(
    { name: 'builtin-browser-server', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  const allTools = [webFetchTool, ...notesTool, ...pageTools, ...clipboardTool];

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: allTools }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const a = (args ?? {}) as any;
    if (name === 'web_fetch') return handleWebFetch(a);
    if (notesTool.some((t) => t.name === name)) return handleNotes(name, a);
    if (pageTools.some((t) => t.name === name)) return handlePageTool(name, a);
    if (clipboardTool.some((t) => t.name === name)) return handleClipboard(name, a);
    throw new Error(`Unknown tool: ${name}`);
  });

  return server;
}
```

- [ ] **Step 2: Implement `BuiltinPlugin.ts`:**

```ts
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ITransportPlugin, PluginMetadata, PluginConfig } from '../../types/plugin';
import { createLogger } from '@extension/shared/lib/logger';
import { createBuiltinServer } from './server/BuiltinServer';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const logger = createLogger('BuiltinPlugin');

export class BuiltinPlugin implements ITransportPlugin {
  readonly metadata: PluginMetadata = {
    name: 'Builtin Browser Server Plugin',
    version: '0.1.0',
    transportType: 'builtin',
    description: 'In-extension MCP server (browser tools, no binary/port/Node)',
    author: 'SuperAssistant',
  };

  private server: ReturnType<typeof createBuiltinServer> | null = null;

  async initialize(_config: PluginConfig): Promise<void> {
    logger.debug('Initialized builtin plugin');
  }

  async connect(uri: string): Promise<Transport> {
    logger.debug(`Starting in-process builtin server (uri=${uri})`);
    this.server = createBuiltinServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await this.server.connect(serverTransport);
    return clientTransport;
  }

  async disconnect(): Promise<void> {
    try { await this.server?.close(); } catch {}
    this.server = null;
  }

  isConnected(): boolean { return this.server !== null; }
  isSupported(uri: string): boolean {
    try { return new URL(uri).protocol === 'builtin:'; } catch { return false; }
  }
  getDefaultConfig(): PluginConfig { return {}; }
  async isHealthy(): Promise<boolean> { return this.server !== null; }
  async callTool(client: Client, toolName: string, args: any): Promise<any> {
    if (!this.isConnected()) throw new Error('Builtin Plugin: Not connected');
    return client.callTool({ name: toolName, arguments: args });
  }
  async getPrimitives(client: Client): Promise<any[]> {
    if (!this.isConnected()) throw new Error('Builtin Plugin: Not connected');
    const { tools } = await client.listTools();
    return tools.map((t) => ({ type: 'tool', value: t }));
  }
}
```

- [ ] **Step 3: Write failing→passing test (end-to-end through the linked pair).**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { BuiltinPlugin } from './BuiltinPlugin';

describe('BuiltinPlugin', () => {
  afterEach(() => vi.restoreAllMocks());

  it('metadata.transportType is "builtin"', () => {
    expect(new BuiltinPlugin().metadata.transportType).toBe('builtin');
  });

  it('connect links an in-process server and tools/list returns the builtin tools', async () => {
    const p = new BuiltinPlugin();
    await p.initialize({});
    const transport = await p.connect('builtin://in-process');
    const client = new Client({ name: 'test', version: '1.0' }, { capabilities: {} });
    await client.connect(transport);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('web_fetch');
    expect(names).toContain('page_read');
    expect(names).toContain('notes_write');
    await client.close();
    await p.disconnect();
  });

  it('a notes_write tool call flows end-to-end through the in-memory link', async () => {
    const mem: Record<string, any> = {};
    (globalThis as any).chrome = {
      storage: { local: {
        get: async (k: string) => (k in mem ? { [k]: mem[k] } : {}),
        set: async (items: Record<string, any>) => { Object.assign(mem, items); },
      } },
    };
    const p = new BuiltinPlugin();
    const transport = await p.connect('builtin://in-process');
    const client = new Client({ name: 'test', version: '1.0' }, { capabilities: {} });
    await client.connect(transport);
    await client.callTool({ name: 'notes_write', arguments: { key: 'k', text: 'v' } });
    expect(mem['mcp_builtin_notes_k']).toBe('v');
    await client.close();
    await p.disconnect();
  });
});
```

- [ ] **Step 4: Run + type-check.** `cd chrome-extension && ./node_modules/.bin/vitest run src/mcpclient/plugins/builtin/BuiltinPlugin.test.ts` → PASS. `./node_modules/.bin/tsc --noEmit` → green (verify the `InMemoryTransport` import path resolves in v1.19.1; if the subpath differs, adjust and report).

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/mcpclient/plugins/builtin/BuiltinPlugin.ts chrome-extension/src/mcpclient/plugins/builtin/BuiltinPlugin.test.ts chrome-extension/src/mcpclient/plugins/builtin/server/BuiltinServer.ts
git commit -m "feat(builtin): BuiltinServer + BuiltinPlugin (InMemoryTransport link)"
```

---

## Task 6: Integration wiring (register, detect, background, guard, UI, manifest)

**Files (modify):** `PluginRegistry.ts`, `mcpclient/index.ts`, `background/index.ts`, `useMcpCommunication.ts`, `ServerStatus.tsx`, `manifest.ts`

- [ ] **Step 1: Register.** `PluginRegistry.ts` — add `import { BuiltinPlugin } from '../plugins/builtin/BuiltinPlugin';` and `await this.register(new BuiltinPlugin());` in `loadDefaultPlugins()`.

- [ ] **Step 2: detect.** `mcpclient/index.ts` `detectTransportType` — add `if (url.protocol === 'builtin:') return 'builtin';`.

- [ ] **Step 3: background default URL.** `background/index.ts` — add `const DEFAULT_BUILTIN_URI = 'builtin://in-process';` and a `connectionType === 'builtin' ? DEFAULT_BUILTIN_URI : ...` branch in each default-URL selector (mirror the native branch from the prior feature).

- [ ] **Step 4: guard.** `useMcpCommunication.ts` — add `'builtin'` to the connectionType allow-list.

- [ ] **Step 5: UI.** `ServerStatus.tsx` — add `<option value="builtin">Builtin (in-browser, no install)</option>`, a native-style hint branch for `connectionType === 'builtin'` ("In-extension server. No binary, no port — works on locked-down machines."), hide the npx hint for builtin, and add a `builtin` details badge.

- [ ] **Step 6: manifest.** `manifest.ts` — `permissions` add `'activeTab'`, `'scripting'`, `'clipboardWrite'`, `'tabs'`; `host_permissions` add `'<all_urls>'`.

- [ ] **Step 7: Verify.** `cd chrome-extension && ./node_modules/.bin/tsc --noEmit` → green. `pnpm build` (from worktree root) → 12/12. `grep -n builtin dist/manifest.json` is NOT expected (builtin isn't a permission) — instead confirm `<all_urls>` and `scripting`/`activeTab` are present in `dist/manifest.json`.

- [ ] **Step 8: Commit**

```bash
git add chrome-extension/src/mcpclient/core/PluginRegistry.ts chrome-extension/src/mcpclient/index.ts chrome-extension/src/background/index.ts pages/content/src/hooks/useMcpCommunication.ts pages/content/src/components/sidebar/ServerStatus/ServerStatus.tsx chrome-extension/manifest.ts
git commit -m "feat(extension): wire builtin transport across registry, background, UI, manifest"
```

---

## Task 7: Build + manual smoke checklist

- [ ] **Step 1: Full build.** `pnpm build` → 12/12.
- [ ] **Step 2: Full chrome-extension test run.** `cd chrome-extension && pnpm test` → all builtin tests pass + existing tests unaffected.
- [ ] **Step 3: Manual smoke checklist (for the human, in a browser):**
  1. `pnpm build` → load `dist/` in Firefox (`about:debugging` → Load Temporary Add-on → `dist/manifest.json`) or Chrome (`chrome://extensions` → load unpacked). Re-grant the broadened permissions when prompted.
  2. Sidebar → Server Status → choose **Builtin (in-browser, no install)** → Save → status Connected.
  3. Ask the AI to `web_fetch` a public URL → confirm it reads content.
  4. Ask the AI to `page_read` the current tab → confirm it returns page text.
  5. `selection_read` after highlighting text on a page → confirm.
  6. `notes_write` then `notes_read` → confirm persistence across a page reload.
  7. `clipboard_write` → confirm clipboard contents change.
  8. Confirm NO process was launched and NO port opened: `lsof -nP -iTCP -sTCP:LISTEN` shows nothing from the extension.
- [ ] **Step 4: Commit any final fixups; finalize.**

---

## Self-Review (done)

**Spec coverage:** BuiltinPlugin+transport (Task 1,5,6), BuiltinServer (5), all 6 tool handlers (2,3,4), manifest permissions incl. broad host_permissions (6), UI option (6), both-union lesson (1), InMemoryTransport confirmed in SDK (`createLinkedPair(): [InMemoryTransport, InMemoryTransport]`). clipboard_read deferred per spec (Task 4 note). Phase 2 (storage skills) + Phase 3 (editor UI) are separate plans.

**Placeholder scan:** none. Code blocks complete.

**Type consistency:** `'builtin'` added to both `TransportType` and `ConnectionType`; `metadata.transportType='builtin'`; `BuiltinPluginConfig` plumbed through `DEFAULT_CLIENT_CONFIG`.

**Deferred (separate plans):** Phase 2 storage-backed skills (3-level) + `skill_read_asset` storage branch; Phase 3 skill editor UI; `clipboard_read` via offscreen document.

## Notes for implementer
- Use `./node_modules/.bin/tsc` / `./node_modules/.bin/vitest` directly; the `rtk` wrapper in this env is flaky with quotes.
- `chrome-extension` type-check is the meaningful gate (baseline green). `@extension/content-script` has chronic pre-existing errors — ignore.
- Verify the `@modelcontextprotocol/sdk/inMemory.js` subpath resolves in Task 5; if not, find the correct subpath in `node_modules/@modelcontextprotocol/sdk/package.json` `exports` and adjust.
- `web_fetch`/`page_read` may be restricted by IT on the work laptop (broad host_permissions / scripting). Failures there are environmental, not bugs.
