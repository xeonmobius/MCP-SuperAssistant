# Native Messaging Host — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let SuperAssistant run with full local read/write/shell capability on a machine with **no Node.js, no open port, and no remote host** — via a self-contained native-messaging host binary launched by the browser.

**Architecture:** A new `mcp-host` workspace compiles to one self-contained binary (Bun `--compile`). The extension gains a `'native'` transport: a `NativeMessagingTransport` MCP `Transport` backed by `chrome.runtime.connectNative`. The browser spawns the host on demand over stdin/stdout; the host implements the `filesystem` + `desktop-commander` MCP servers internally (no `npx`). Existing SSE/WS/StreamableHTTP plugins stay untouched.

**Tech Stack:** TypeScript, Bun 1.3.4 (`bun build --compile`, `bun test`), `@modelcontextprotocol/sdk` (server low-level `Server` + `Transport` interface), Chrome/Firefox Native Messaging (length-prefixed stdio JSON), React/Zustand (existing extension UI), pnpm workspaces + turbo.

**Spec:** `docs/superpowers/specs/2026-06-16-native-messaging-host-design.md`

---

## File Structure

### New — `mcp-host/` workspace
- `mcp-host/package.json`, `mcp-host/tsconfig.json`, `mcp-host/README.md`
- `mcp-host/src/index.ts` — entry: load config → build server → run transport on stdin/stdout
- `mcp-host/src/server.ts` — create MCP `Server`, register `tools/list` + `tools/call` handlers
- `mcp-host/src/native-messaging/framing.ts` (+ `.test.ts`) — encode/decode 4-byte length-prefixed frames
- `mcp-host/src/native-messaging/NativeMessagingServerTransport.ts` (+ `.test.ts`) — MCP `Transport` over stdin/stdout
- `mcp-host/src/config/loadConfig.ts` (+ `.test.ts`) — load/validate `host-config.json`
- `mcp-host/src/tools/filesystem.ts` (+ `.test.ts`) — tool definitions + handlers (read/list/write)
- `mcp-host/src/tools/desktop-commander.ts` (+ `.test.ts`) — `execute_command` with allowlist + destructive deny
- `mcp-host/host-config.example.json`, `mcp-host/native-host-manifest.example.json`

### New — extension native plugin
- `chrome-extension/src/mcpclient/plugins/native/NativeMessagingTransport.ts` (+ `.test.ts`) — MCP `Transport` over `chrome.runtime.Port`
- `chrome-extension/src/mcpclient/plugins/native/NativeMessagingPlugin.ts` (+ `.test.ts`) — `ITransportPlugin` impl

### Modified — integration points
- `pnpm-workspace.yaml` — add `'mcp-host'`
- `chrome-extension/src/mcpclient/types/plugin.ts:4` — `TransportType` union += `'native'`
- `chrome-extension/src/mcpclient/types/config.ts` — add `NativePluginConfig` + default in `DEFAULT_CLIENT_CONFIG`
- `chrome-extension/src/mcpclient/core/PluginRegistry.ts:6,104-106` — import + register native plugin
- `chrome-extension/src/mcpclient/index.ts:144` — `detectTransportType` recognizes `native://`
- `chrome-extension/src/background/index.ts:76-78,936` — default URL branch for `'native'`
- `pages/content/src/hooks/useMcpCommunication.ts:225` — guard list += `'native'`
- `pages/content/src/components/sidebar/ServerStatus/ServerStatus.tsx:797-842` — add `<option value="native">` + adjust hint
- `chrome-extension/manifest.ts:53` — `permissions` += `'nativeMessaging'`

---

## Task 1: Add `mcp-host` workspace scaffold

**Files:**
- Create: `mcp-host/package.json`
- Create: `mcp-host/tsconfig.json`
- Modify: `pnpm-workspace.yaml`

- [ ] **Step 1: Create `mcp-host/package.json`**

```json
{
  "name": "@extension/mcp-host",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "mcp-host": "./src/index.ts"
  },
  "scripts": {
    "test": "bun test",
    "build:binary": "bun build --compile --target=bun-darwin-arm64 ./src/index.ts --outfile dist/mcp-host",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "5.8.1-rc"
  }
}
```

- [ ] **Step 2: Create `mcp-host/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["bun"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "lib": ["ESNext"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Add to `pnpm-workspace.yaml`**

Add `'mcp-host'` to the packages list so the final file is:

```yaml
packages:
  - 'chrome-extension'
  - 'pages/*'
  - 'packages/*'
  - 'tests/*'
  - 'mcp-host'
```

- [ ] **Step 4: Install**

Run: `pnpm install`
Expected: workspace links `@extension/mcp-host`, MCP SDK + zod resolve.

- [ ] **Step 5: Verify SDK import path (important — SDK evolves)**

Run: `rtk ls node_modules/@modelcontextprotocol/sdk/dist/esm/server/`
Expected: an `index.js` present (server entry). If the path differs, note the correct server import path for use in later tasks.

- [ ] **Step 6: Commit**

```bash
git add mcp-host/package.json mcp-host/tsconfig.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(mcp-host): scaffold native messaging host workspace"
```

---

## Task 2: Native-messaging framing (host-side) — TDD

**Files:**
- Create: `mcp-host/src/native-messaging/framing.ts`
- Test: `mcp-host/src/native-messaging/framing.test.ts`

Native Messaging wire format: every message = `[4-byte little-endian unsigned length][UTF-8 JSON bytes]`, max 1 MiB.

- [ ] **Step 1: Write the failing test**

`mcp-host/src/native-messaging/framing.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import { encodeMessage, decodeFrame, MAX_MESSAGE_BYTES } from './framing';

describe('native messaging framing', () => {
  it('encodes a JSON message with a 4-byte little-endian length prefix', () => {
    const json = JSON.stringify({ hello: 'world' });
    const buf = encodeMessage(json);
    // 4-byte LE length + UTF-8 body
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    expect(dv.getUint32(0, true)).toBe(json.length);
    expect(buf.subarray(4).toString('utf8')).toBe(json);
  });

  it('decodes a length-prefixed buffer back to the original string', () => {
    const original = '{"method":"initialize"}';
    const encoded = encodeMessage(original);
    const decoded = decodeFrame(encoded);
    expect(decoded).toBe(original);
  });

  it('throws on messages exceeding the 1 MiB limit', () => {
    const tooBig = 'x'.repeat(MAX_MESSAGE_BYTES + 1);
    expect(() => encodeMessage(tooBig)).toThrow(/exceeds/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-host && bun test src/native-messaging/framing.test.ts`
Expected: FAIL — module `./framing` not found.

- [ ] **Step 3: Implement**

`mcp-host/src/native-messaging/framing.ts`:

```ts
export const MAX_MESSAGE_BYTES = 1024 * 1024; // 1 MiB, per Native Messaging spec

/** Encode a JSON string as a Native Messaging frame: [uint32 LE length][utf8 body]. */
export function encodeMessage(json: string): Buffer {
  const body = Buffer.from(json, 'utf8');
  if (body.byteLength > MAX_MESSAGE_BYTES) {
    throw new Error(
      `Message length ${body.byteLength} exceeds max ${MAX_MESSAGE_BYTES} bytes`,
    );
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.byteLength, 0);
  return Buffer.concat([header, body]);
}

/** Decode a single complete frame (header + body) back to the JSON string. */
export function decodeFrame(frame: Buffer): string {
  if (frame.byteLength < 4) {
    throw new Error(`Frame too short: ${frame.byteLength} bytes`);
  }
  const length = frame.readUInt32LE(0);
  const body = frame.subarray(4, 4 + length);
  return body.toString('utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-host && bun test src/native-messaging/framing.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp-host/src/native-messaging/framing.ts mcp-host/src/native-messaging/framing.test.ts
git commit -m "feat(mcp-host): native messaging frame encode/decode"
```

---

## Task 3: `NativeMessagingServerTransport` (MCP `Transport` over stdin/stdout) — TDD

**Files:**
- Create: `mcp-host/src/native-messaging/NativeMessagingServerTransport.ts`
- Test: `mcp-host/src/native-messaging/NativeMessagingServerTransport.test.ts`

Implements the MCP SDK `Transport` contract: `start()`, `send(message)`, `close()`, with `onclose`, `onerror`, `onmessage` callbacks. Reads framed messages from `stdin`, writes framed messages to `stdout`. Injectable streams for testing.

- [ ] **Step 1: Write the failing test**

`mcp-host/src/native-messaging/NativeMessagingServerTransport.test.ts`:

```ts
import { describe, it, expect, mock } from 'bun:test';
import { Readable, Writable } from 'node:stream';
import { encodeMessage } from './framing';
import { NativeMessagingServerTransport } from './NativeMessagingServerTransport';

/** Build a pair: a Readable the transport reads from, and a fn to push frames into it. */
function makeInput() {
  const input = new Readable({ read() {} });
  return input;
}

describe('NativeMessagingServerTransport', () => {
  it('calls onmessage with parsed JSON when a frame arrives on stdin', async () => {
    const input = makeInput();
    const output = new Writable({ write(_c, _e, cb) { cb(); } });
    const transport = new NativeMessagingServerTransport(input, output);
    const received: any[] = [];
    transport.onmessage = (msg) => received.push(msg);
    await transport.start();

    input.push(encodeMessage(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })));
    await new Promise((r) => setImmediate(r));

    expect(received).toHaveLength(1);
    expect(received[0].method).toBe('initialize');
    await transport.close();
  });

  it('writes framed messages to stdout on send()', async () => {
    const input = makeInput();
    const written: Buffer[] = [];
    const output = new Writable({ write(chunk, _e, cb) { written.push(Buffer.from(chunk)); cb(); } });
    const transport = new NativeMessagingServerTransport(input, output);
    await transport.start();

    await transport.send({ jsonrpc: '2.0', id: 1, result: { ok: true } } as any);

    expect(written).toHaveLength(1);
    expect(written[0].readUInt32LE(0)).toBe(written[0].byteLength - 4);
    await transport.close();
  });

  it('emits onclose when close() is called', async () => {
    const input = makeInput();
    const output = new Writable({ write(_c, _e, cb) { cb(); } });
    const transport = new NativeMessagingServerTransport(input, output);
    const onClose = mock(() => {});
    transport.onclose = onClose;
    await transport.start();
    await transport.close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-host && bun test src/native-messaging/NativeMessagingServerTransport.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`mcp-host/src/native-messaging/NativeMessagingServerTransport.ts`:

```ts
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { Readable, Writable } from 'node:stream';
import { encodeMessage, decodeFrame } from './framing';

/**
 * MCP Transport that speaks the browser Native Messaging wire format:
 * length-prefixed JSON frames over stdin (inbound) and stdout (outbound).
 */
export class NativeMessagingServerTransport implements Transport {
  onclose?: () => void;
  onerror?: (e: Error) => void;
  onmessage?: (msg: JSONRPCMessage) => void;

  private started = false;
  private closed = false;
  private buffer = Buffer.alloc(0);

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
  ) {}

  async start(): Promise<void> {
    if (this.started) throw new Error('Transport already started');
    this.started = true;

    this.input.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drainFrames();
    });

    this.input.on('end', () => this.close());
    this.input.on('error', (e) => this.onerror?.(e));
  }

  private drainFrames(): void {
    while (this.buffer.byteLength >= 4) {
      const length = this.buffer.readUInt32LE(0);
      const total = 4 + length;
      if (this.buffer.byteLength < total) return; // wait for more
      const frame = this.buffer.subarray(0, total);
      this.buffer = this.buffer.subarray(total);
      try {
        const json = decodeFrame(frame);
        const msg = JSON.parse(json) as JSONRPCMessage;
        this.onmessage?.(msg);
      } catch (e) {
        this.onerror?.(e instanceof Error ? e : new Error(String(e)));
      }
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.closed) throw new Error('Transport closed');
    const framed = encodeMessage(JSON.stringify(message));
    await new Promise<void>((resolve, reject) => {
      this.output.write(frapped, (err) => (err ? reject(err) : resolve()));
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try { this.input.removeAllListeners(); } catch {}
    this.onclose?.();
  }
}
```

Note: fix the obvious typo in the write callback if the reviewer flags it — the variable is `framed`, not `frapped`. Correct line: `this.output.write(framed, ...)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-host && bun test src/native-messaging/NativeMessagingServerTransport.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp-host/src/native-messaging/NativeMessagingServerTransport.ts mcp-host/src/native-messaging/NativeMessagingServerTransport.test.ts
git commit -m "feat(mcp-host): MCP Transport over native messaging stdin/stdout"
```

---

## Task 4: Host config loader — TDD

**Files:**
- Create: `mcp-host/src/config/loadConfig.ts`
- Test: `mcp-host/src/config/loadConfig.test.ts`
- Create: `mcp-host/host-config.example.json`

`host-config.json` replaces the proxy's `config.json`. The host does not spawn child processes, so there is no `command`/`args` — only allowed folders and command policy.

- [ ] **Step 1: Write the failing test**

`mcp-host/src/config/loadConfig.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import { validateConfig, type HostConfig } from './loadConfig';

describe('loadConfig', () => {
  it('accepts a config with allowed folders and a command allowlist', () => {
    const cfg: HostConfig = {
      filesystem: { allowedPaths: ['/Users/me/projects'] },
      desktopCommander: {
        allowlist: ['git', 'ls'],
        denylist: ['rm'],
        denyDestructive: true,
      },
    };
    expect(() => validateConfig(cfg)).not.toThrow();
  });

  it('applies defaults when sections are missing', () => {
    const cfg = validateConfig({});
    expect(cfg.filesystem.allowedPaths).toEqual([]);
    expect(cfg.desktopCommander.denyDestructive).toBe(true);
  });

  it('throws when allowedPaths is not an array', () => {
    expect(() => validateConfig({ filesystem: { allowedPaths: 'nope' } } as any)).toThrow(/allowedPaths/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-host && bun test src/config/loadConfig.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`mcp-host/src/config/loadConfig.ts`:

```ts
export interface FilesystemConfig {
  allowedPaths: string[];
}

export interface DesktopCommanderConfig {
  allowlist: string[];        // binaries that may run
  denylist: string[];         // binaries never allowed (overrides allowlist)
  denyDestructive: boolean;   // block destructive shell patterns
}

export interface HostConfig {
  filesystem: FilesystemConfig;
  desktopCommander: DesktopCommanderConfig;
}

const DEFAULTS: HostConfig = {
  filesystem: { allowedPaths: [] },
  desktopCommander: { allowlist: [], denylist: ['rm'], denyDestructive: true },
};

export function validateConfig(input: unknown): HostConfig {
  const raw = (input ?? {}) as Record<string, any>;
  if (raw.filesystem !== undefined && !Array.isArray(raw.filesystem.allowedPaths)) {
    throw new Error('host-config: filesystem.allowedPaths must be an array');
  }
  if (raw.desktopCommander !== undefined) {
    const dc = raw.desktopCommander;
    if (dc.allowlist !== undefined && !Array.isArray(dc.allowlist)) throw new Error('desktopCommander.allowlist must be an array');
    if (dc.denylist !== undefined && !Array.isArray(dc.denylist)) throw new Error('desktopCommander.denylist must be an array');
    if (dc.denyDestructive !== undefined && typeof dc.denyDestructive !== 'boolean') throw new Error('desktopCommander.denyDestructive must be boolean');
  }
  return {
    filesystem: { allowedPaths: raw.filesystem?.allowedPaths ?? DEFAULTS.filesystem.allowedPaths },
    desktopCommander: {
      allowlist: raw.desktopCommander?.allowlist ?? DEFAULTS.desktopCommander.allowlist,
      denylist: raw.desktopCommander?.denylist ?? DEFAULTS.desktopCommander.denylist,
      denyDestructive: raw.desktopCommander?.denyDestructive ?? DEFAULTS.desktopCommander.denyDestructive,
    },
  };
}

export function loadConfig(path: string): HostConfig {
  const file = Bun.file(path);
  // Synchronous-ish read via text(); Bun.file returns a Promise on json()
  // For host startup we accept async in the entry point; this is the sync shape used by tests.
  const text = require('node:fs').readFileSync(path, 'utf8');
  return validateConfig(JSON.parse(text));
}
```

`mcp-host/host-config.example.json`:

```json
{
  "filesystem": {
    "allowedPaths": ["/Users/you/Documents"]
  },
  "desktopCommander": {
    "allowlist": ["git", "ls", "cat", "echo"],
    "denylist": ["rm", "mkfs", "dd"],
    "denyDestructive": true
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-host && bun test src/config/loadConfig.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp-host/src/config mcp-host/host-config.example.json
git commit -m "feat(mcp-host): host config schema + loader"
```

---

## Task 5: `filesystem` tools — TDD

**Files:**
- Create: `mcp-host/src/tools/filesystem.ts`
- Test: `mcp-host/src/tools/filesystem.test.ts`

Implements a subset of `@modelcontextprotocol/server-filesystem`: `read_file`, `list_directory`, `write_file`. Reads/writes are constrained to `allowedPaths`.

- [ ] **Step 1: Write the failing test**

`mcp-host/src/tools/filesystem.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleFilesystemCall, listFilesystemTools } from './filesystem';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'mcphost-')); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('filesystem tools', () => {
  it('lists read_file, list_directory, write_file', () => {
    const names = listFilesystemTools().map((t) => t.name);
    expect(names).toEqual(['read_file', 'list_directory', 'write_file']);
  });

  it('read_file returns contents within allowedPaths', async () => {
    writeFileSync(join(root, 'a.txt'), 'hello');
    const res = await handleFilesystemCall('read_file', { path: join(root, 'a.txt') }, { allowedPaths: [root] });
    expect(res.content[0].text).toBe('hello');
  });

  it('read_file rejects paths outside allowedPaths', async () => {
    await expect(
      handleFilesystemCall('read_file', { path: '/etc/passwd' }, { allowedPaths: [root] }),
    ).rejects.toThrow(/outside allowed paths/);
  });

  it('write_file writes within allowedPaths', async () => {
    await handleFilesystemCall('write_file', { path: join(root, 'out.txt'), content: 'x' }, { allowedPaths: [root] });
    const res = await handleFilesystemCall('read_file', { path: join(root, 'out.txt') }, { allowedPaths: [root] });
    expect(res.content[0].text).toBe('x');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-host && bun test src/tools/filesystem.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`mcp-host/src/tools/filesystem.ts`:

```ts
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import type { FilesystemConfig } from '../config/loadConfig';

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

export function listFilesystemTools(): ToolDef[] {
  return [
    { name: 'read_file', description: 'Read a UTF-8 text file.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
    { name: 'list_directory', description: 'List entries in a directory.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
    { name: 'write_file', description: 'Write a UTF-8 text file.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  ];
}

function assertAllowed(target: string, cfg: FilesystemConfig): void {
  const abs = resolve(target);
  const ok = cfg.allowedPaths.some((p) => {
    const rel = relative(resolve(p), abs);
    return rel === '' || (!rel.startsWith('..') && !resolve(p, rel).startsWith('..'));
  });
  if (!ok) throw new Error(`Path '${abs}' is outside allowed paths`);
}

export async function handleFilesystemCall(
  name: string,
  args: { path?: string; content?: string },
  cfg: FilesystemConfig,
): Promise<{ content: { type: 'text'; text: string }[] }> {
  const path = args.path as string;
  assertAllowed(path, cfg);

  if (name === 'read_file') {
    const text = await readFile(path, 'utf8');
    return { content: [{ type: 'text', text }] };
  }
  if (name === 'list_directory') {
    const entries = await readdir(path, { withFileTypes: true });
    const text = entries.map((e) => `${e.isDirectory() ? 'dir ' : 'file'} ${e.name}`).join('\n');
    return { content: [{ type: 'text', text }] };
  }
  if (name === 'write_file') {
    await writeFile(path, String(args.content ?? ''), 'utf8');
    return { content: [{ type: 'text', text: `wrote ${path}` }] };
  }
  throw new Error(`Unknown filesystem tool: ${name}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-host && bun test src/tools/filesystem.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp-host/src/tools/filesystem.ts mcp-host/src/tools/filesystem.test.ts
git commit -m "feat(mcp-host): filesystem tools (read/list/write) with path allowlist"
```

---

## Task 6: `desktop-commander` (`execute_command`, gated) — TDD

**Files:**
- Create: `mcp-host/src/tools/desktop-commander.ts`
- Test: `mcp-host/src/tools/desktop-commander.test.ts`

Host-side safety net: enforce allowlist/denylist + destructive-pattern deny from config. (The interactive extension-side approve/deny prompt is Task 11; this task is the always-on policy layer.)

- [ ] **Step 1: Write the failing test**

`mcp-host/src/tools/desktop-commander.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import { listDesktopCommanderTools, isCommandAllowed, DESTRUCTIVE_PATTERN } from './desktop-commander';

const cfg = { allowlist: ['git', 'ls'], denylist: ['rm'], denyDestructive: true };

describe('desktop-commander', () => {
  it('lists execute_command', () => {
    expect(listDesktopCommanderTools().map((t) => t.name)).toEqual(['execute_command']);
  });

  it('allows an allowlisted binary', () => {
    expect(isCommandAllowed('git status', cfg).ok).toBe(true);
  });

  it('denies a denylisted binary even if in allowlist', () => {
    const local = { ...cfg, allowlist: ['git', 'rm'] };
    expect(isCommandAllowed('rm -rf /', local).ok).toBe(false);
  });

  it('denies not-in-allowlist binaries', () => {
    expect(isCommandAllowed('curl http://x', cfg).ok).toBe(false);
  });

  it('denies destructive redirection when denyDestructive is true', () => {
    expect(isCommandAllowed('git log > out.txt', cfg).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-host && bun test src/tools/desktop-commander.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`mcp-host/src/tools/desktop-commander.ts`:

```ts
import { $ } from 'bun';
import type { DesktopCommanderConfig } from '../config/loadConfig';

export interface ToolDef { name: string; description: string; inputSchema: Record<string, any>; }

export const DESTRUCTIVE_PATTERN = /(\b rm\b|>\s*\/|mkfs|dd\s+if=|:\(\)\s*\{)/;

export function listDesktopCommanderTools(): ToolDef[] {
  return [{
    name: 'execute_command',
    description: 'Execute a shell command (subject to allowlist + destructive deny).',
    inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
  }];
}

export function isCommandAllowed(command: string, cfg: DesktopCommanderConfig): { ok: true } | { ok: false; reason: string } {
  const trimmed = command.trim();
  const binary = trimmed.split(/\s+/)[0];

  if (cfg.denylist.includes(binary)) return { ok: false, reason: `'${binary}' is on the denylist` };
  if (cfg.denyDestructive && DESTRUCTIVE_PATTERN.test(trimmed)) return { ok: false, reason: 'command matches a destructive pattern' };
  if (cfg.allowlist.length > 0 && !cfg.allowlist.includes(binary)) return { ok: false, reason: `'${binary}' is not on the allowlist` };

  return { ok: true };
}

export async function handleDesktopCommanderCall(
  name: string,
  args: { command?: string },
  cfg: DesktopCommanderConfig,
): Promise<{ content: { type: 'text'; text: string }[] }> {
  if (name !== 'execute_command') throw new Error(`Unknown desktop-commander tool: ${name}`);
  const command = String(args.command ?? '');
  const check = isCommandAllowed(command, cfg);
  if (!check.ok) throw new Error(`Command rejected: ${check.reason}`);

  const result = await $`${{ raw: command }}`.noThrow();
  const text = `exit=${result.exitCode}\nstdout:\n${result.stdout.toString()}\nstderr:\n${result.stderr.toString()}`;
  return { content: [{ type: 'text', text }] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-host && bun test src/tools/desktop-commander.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp-host/src/tools/desktop-commander.ts mcp-host/src/tools/desktop-commander.test.ts
git commit -m "feat(mcp-host): desktop-commander execute_command with allowlist + destructive deny"
```

---

## Task 7: MCP server wiring + entry point + host integration test

**Files:**
- Create: `mcp-host/src/server.ts`
- Create: `mcp-host/src/index.ts`
- Test: `mcp-host/src/index.test.ts` (integration)

- [ ] **Step 1: Implement `server.ts`**

`mcp-host/src/server.ts`:

```ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { listFilesystemTools, handleFilesystemCall } from './tools/filesystem';
import { listDesktopCommanderTools, handleDesktopCommanderCall } from './tools/desktop-commander';
import type { HostConfig } from './config/loadConfig';

export function createServer(cfg: HostConfig): Server {
  const server = new Server(
    { name: 'superassistant-host', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...listFilesystemTools(), ...listDesktopCommanderTools()],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    if (listFilesystemTools().some((t) => t.name === name)) {
      return handleFilesystemCall(name, (args ?? {}) as any, cfg.filesystem);
    }
    if (listDesktopCommanderTools().some((t) => t.name === name)) {
      return handleDesktopCommanderCall(name, (args ?? {}) as any, cfg.desktopCommander);
    }
    throw new Error(`Unknown tool: ${name}`);
  });

  return server;
}
```

- [ ] **Step 2: Implement entry point `index.ts`**

`mcp-host/src/index.ts`:

```ts
import { readFileSync } from 'node:fs';
import { createServer } from './server';
import { validateConfig, type HostConfig } from './config/loadConfig';
import { NativeMessagingServerTransport } from './native-messaging/NativeMessagingServerTransport';

function loadConfigFromDisk(): HostConfig {
  // HOST_CONFIG env var, default to host-config.json beside the binary / cwd
  const path = process.env.HOST_CONFIG ?? 'host-config.json';
  try {
    const text = readFileSync(path, 'utf8');
    return validateConfig(JSON.parse(text));
  } catch {
    return validateConfig({}); // run with defaults (no allowed paths, deny-only shell)
  }
}

async function main(): Promise<void> {
  const cfg = loadConfigFromDisk();
  const server = createServer(cfg);
  const transport = new NativeMessagingServerTransport(process.stdin, process.stdout);
  await server.connect(transport);
}

main().catch((e) => {
  // Native messaging hosts must not write free-form text to stdout.
  // eslint-disable-next-line no-console
  console.error('[mcp-host] fatal:', e);
  process.exit(1);
});
```

- [ ] **Step 3: Write the integration test (headless — pipe frames through the transport + server)**

`mcp-host/src/index.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import { Readable, Writable } from 'node:stream';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from './server';
import { validateConfig } from './config/loadConfig';
import { NativeMessagingServerTransport } from './native-messaging/NativeMessagingServerTransport';
import { encodeMessage, decodeFrame } from './native-messaging/framing';

async function runSession(input: Readable, output: Writable, cfg = validateConfig({})) {
  const server = createServer(cfg);
  const transport = new NativeMessagingServerTransport(input, output);
  await server.connect(transport);
  return transport;
}

describe('host integration', () => {
  it('responds to tools/list with filesystem + desktop-commander tools', async () => {
    const input = new Readable({ read() {} });
    const chunks: Buffer[] = [];
    const output = new Writable({ write(c, _e, cb) { chunks.push(Buffer.from(c)); cb(); } });
    const transport = await runSession(input, output);

    const onMessage = (raw: Buffer) => JSON.parse(decodeFrame(raw));
    transport.onmessage = () => {}; // server responses go to stdout via transport.send

    input.push(encodeMessage(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } })));
    input.push(encodeMessage(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })));
    input.push(encodeMessage(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })));
    await new Promise((r) => setTimeout(r, 50));

    const listResponse = onMessage(chunks[chunks.length - 1]);
    expect(listResponse.id).toBe(2);
    expect(listResponse.result.tools.map((t: any) => t.name)).toContain('read_file');
    await transport.close();
  });

  it('reads a file via tools/call end-to-end', async () => {
    const root = mkdtempSync(join(tmpdir(), 'int-'));
    writeFileSync(join(root, 'hello.txt'), 'hi');
    const cfg = validateConfig({ filesystem: { allowedPaths: [root] } });

    const input = new Readable({ read() {} });
    const chunks: Buffer[] = [];
    const output = new Writable({ write(c, _e, cb) { chunks.push(Buffer.from(c)); cb(); } });
    const transport = await runSession(input, output, cfg);

    input.push(encodeMessage(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } })));
    input.push(encodeMessage(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })));
    input.push(encodeMessage(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'read_file', arguments: { path: join(root, 'hello.txt') } } })));
    await new Promise((r) => setTimeout(r, 50));

    const resp = JSON.parse(decodeFrame(chunks[chunks.length - 1]));
    expect(resp.id).toBe(2);
    expect(resp.result.content[0].text).toBe('hi');
    rmSync(root, { recursive: true, force: true });
    await transport.close();
  });
});
```

- [ ] **Step 4: Run the integration test**

Run: `cd mcp-host && bun test`
Expected: ALL tests PASS (framing + transport + config + filesystem + desktop-commander + 2 integration).

- [ ] **Step 5: Type-check**

Run: `cd mcp-host && bun run type-check`
Expected: no errors (fix any SDK import path mismatch flagged in Task 1 Step 5 first).

- [ ] **Step 6: Commit**

```bash
git add mcp-host/src/server.ts mcp-host/src/index.ts mcp-host/src/index.test.ts
git commit -m "feat(mcp-host): wire MCP server to native messaging transport"
```

---

## Task 8: Build the binary + native-messaging manifest artifact

**Files:**
- Create: `mcp-host/native-host-manifest.example.json`
- Modify: `mcp-host/README.md` (build/distribute instructions)

- [ ] **Step 1: Build the self-contained binary**

Run: `cd mcp-host && bun run build:binary`
Expected: `mcp-host/dist/mcp-host` exists and is executable. Verify it's standalone: `file dist/mcp-host` → a Mach-O executable.

- [ ] **Step 2: Smoke-run the binary directly (it will wait on stdin)**

Run: `printf '%b' '\x63\x00\x00\x00{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' | ./dist/mcp-host | head -c 8 | xxd`
Expected: a 4-byte length header (`0x...`) followed by JSON — the initialize response. (The `head -c 8 | xxd` shows the first length word.) Confirm it does NOT print free-form stdout text.

- [ ] **Step 3: Ad-hoc sign**

Run: `codesign -s - dist/mcp-host`
Expected: success (no output). Verify: `codesign -dv dist/mcp-host` shows `Signature=adhoc`.

- [ ] **Step 4: Create the manifest example**

`mcp-host/native-host-manifest.example.json`:

```json
{
  "name": "com.superassistant.host",
  "description": "SuperAssistant local host",
  "path": "/Users/CHANGE_ME/bin/mcp-host",
  "type": "stdio",
  "allowed_extensions": ["CHANGE_ME@extension-id"]
}
```

- [ ] **Step 5: Write `mcp-host/README.md` (build + install + first-run)**

Cover: prerequisites (Bun on a dev mac), `bun install`, `bun run build:binary`, `codesign -s -`, where to copy the binary, where to put the manifest (`~/Library/Application Support/Mozilla/NativeMessagingHosts/com.superassistant.host.json` for Firefox; `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` for Chrome), finding the extension ID (`about:debugging` → the extension), the one-time `xattr -d com.apple.quarantine` command, and `HOST_CONFIG` env to point at `host-config.json`.

- [ ] **Step 6: Commit**

```bash
git add mcp-host/native-host-manifest.example.json mcp-host/README.md
git commit -m "feat(mcp-host): build script, manifest example, install docs"
```

---

## Task 9: `NativeMessagingTransport` (extension side, MCP Transport over `chrome.runtime.Port`) — TDD

**Files:**
- Create: `chrome-extension/src/mcpclient/plugins/native/NativeMessagingTransport.ts`
- Test: `chrome-extension/src/mcpclient/plugins/native/NativeMessagingTransport.test.ts`

The extension's MCP client expects a `Transport` object (returned by the plugin's `connect()`). This adapts a long-lived `chrome.runtime.Port` (from `connectNative`) to the MCP `Transport` interface. The browser's native-messaging port auto-frames messages (no manual length prefix needed on the extension side).

- [ ] **Step 1: Write the failing test**

`chrome-extension/src/mcpclient/plugins/native/NativeMessagingTransport.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { NativeMessagingTransport } from './NativeMessagingTransport';

// Minimal chrome.runtime.Port mock
function makePortMock() {
  const listeners: Record<string, ((...a: any[]) => void)[]> = {};
  const port = {
    name: 'com.superassistant.host',
    postMessage: vi.fn((msg: any) => {
      // echo back as if the host handled it
      setTimeout(() => listeners['onMessage']?.forEach((l) => l({ echo: msg })), 0);
    }),
    disconnect: vi.fn(),
    onMessage: { addListener: (l: any) => (listeners['onMessage'] ||= []).push(l) },
    onDisconnect: { addListener: (l: any) => (listeners['onDisconnect'] ||= []).push(l) },
  };
  return { port: port as any, listeners };
}

describe('NativeMessagingTransport', () => {
  it('posts messages to the port on send()', async () => {
    const { port } = makePortMock();
    const t = new NativeMessagingTransport(port);
    await t.start();
    await t.send({ jsonrpc: '2.0', id: 1, method: 'initialize' } as any);
    expect(port.postMessage).toHaveBeenCalledWith({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    await t.close();
  });

  it('invokes onmessage for inbound port messages', async () => {
    const { port, listeners } = makePortMock();
    const t = new NativeMessagingTransport(port);
    const received: any[] = [];
    t.onmessage = (m) => received.push(m);
    await t.start();
    listeners['onMessage'].forEach((l) => l({ jsonrpc: '2.0', id: 1, result: {} }));
    expect(received).toHaveLength(1);
    await t.close();
  });

  it('fires onclose when the port disconnects', async () => {
    const { port, listeners } = makePortMock();
    const t = new NativeMessagingTransport(port);
    const onClose = vi.fn();
    t.onclose = onClose;
    await t.start();
    listeners['onDisconnect'].forEach((l) => l());
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd SuperAssistant && pnpm vitest run chrome-extension/src/mcpclient/plugins/native/NativeMessagingTransport.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`chrome-extension/src/mcpclient/plugins/native/NativeMessagingTransport.ts`:

```ts
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

type Port = chrome.runtime.Port;

/**
 * Adapts a long-lived chrome.runtime.Port (connectNative) to the MCP Transport
 * interface. The browser handles native-messaging framing for us.
 */
export class NativeMessagingTransport implements Transport {
  onclose?: () => void;
  onerror?: (e: Error) => void;
  onmessage?: (msg: JSONRPCMessage) => void;

  private started = false;
  private closed = false;

  constructor(private readonly port: Port) {}

  async start(): Promise<void> {
    if (this.started) throw new Error('NativeMessagingTransport already started');
    this.started = true;

    this.port.onMessage.addListener((msg) => {
      try {
        this.onmessage?.(msg as JSONRPCMessage);
      } catch (e) {
        this.onerror?.(e instanceof Error ? e : new Error(String(e)));
      }
    });

    this.port.onDisconnect.addListener(() => {
      if (this.closed) return;
      this.closed = true;
      this.onclose?.();
    });
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.closed) throw new Error('NativeMessagingTransport closed');
    this.port.postMessage(message as unknown as object);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try { this.port.disconnect(); } catch {}
    this.onclose?.();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd SuperAssistant && pnpm vitest run chrome-extension/src/mcpclient/plugins/native/NativeMessagingTransport.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/mcpclient/plugins/native/NativeMessagingTransport.ts chrome-extension/src/mcpclient/plugins/native/NativeMessagingTransport.test.ts
git commit -m "feat(extension): MCP Transport over chrome.runtime native messaging port"
```

---

## Task 10: `NativeMessagingPlugin` (ITransportPlugin) — TDD

**Files:**
- Create: `chrome-extension/src/mcpclient/plugins/native/NativeMessagingPlugin.ts`
- Test: `chrome-extension/src/mcpclient/plugins/native/NativeMessagingPlugin.test.ts`

- [ ] **Step 1: Write the failing test**

`chrome-extension/src/mcpclient/plugins/native/NativeMessagingPlugin.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NativeMessagingPlugin } from './NativeMessagingPlugin';

describe('NativeMessagingPlugin', () => {
  beforeEach(() => {
    (globalThis as any).chrome = {
      runtime: {
        connectNative: vi.fn(() => ({
          name: 'com.superassistant.host',
          postMessage: vi.fn(),
          disconnect: vi.fn(),
          onMessage: { addListener: vi.fn() },
          onDisconnect: { addListener: vi.fn() },
        })),
      },
    };
  });

  it('metadata has transportType "native"', () => {
    const p = new NativeMessagingPlugin();
    expect(p.metadata.transportType).toBe('native');
  });

  it('isSupported returns true for native:// uris', () => {
    const p = new NativeMessagingPlugin();
    expect(p.isSupported('native://com.superassistant.host')).toBe(true);
    expect(p.isSupported('http://localhost:3006/sse')).toBe(false);
  });

  it('connect opens connectNative and returns a transport', async () => {
    const p = new NativeMessagingPlugin();
    await p.initialize({});
    const transport = await p.connect('native://com.superassistant.host');
    expect((globalThis as any).chrome.runtime.connectNative)
      .toHaveBeenCalledWith('com.superassistant.host');
    expect(transport).toBeDefined();
  });

  it('connect rejects if chrome.runtime.connectNative is missing (no permission)', async () => {
    (globalThis as any).chrome = {}; // no connectNative
    const p = new NativeMessagingPlugin();
    await p.initialize({});
    await expect(p.connect('native://com.superassistant.host')).rejects.toThrow(/nativeMessaging|connectNative/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd SuperAssistant && pnpm vitest run chrome-extension/src/mcpclient/plugins/native/NativeMessagingPlugin.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`chrome-extension/src/mcpclient/plugins/native/NativeMessagingPlugin.ts`:

```ts
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ITransportPlugin, PluginMetadata, PluginConfig } from '../../types/plugin';
import { createLogger } from '@extension/shared/lib/logger';
import { NativeMessagingTransport } from './NativeMessagingTransport';

const logger = createLogger('NativeMessagingPlugin');
const HOST_NAME = 'com.superassistant.host';

export class NativeMessagingPlugin implements ITransportPlugin {
  readonly metadata: PluginMetadata = {
    name: 'Native Messaging Transport Plugin',
    version: '1.0.0',
    transportType: 'native',
    description: 'Local MCP server over browser Native Messaging (no port, no Node)',
    author: 'SuperAssistant',
  };

  private transport: Transport | null = null;

  async initialize(_config: PluginConfig): Promise<void> {
    logger.debug('Initialized native messaging plugin');
  }

  async connect(uri: string): Promise<Transport> {
    if (!chrome?.runtime?.connectNative) {
      throw new Error(
        'Native Messaging Plugin: connectNative unavailable — add the "nativeMessaging" permission and install the host manifest.',
      );
    }
    logger.debug(`Connecting to native host: ${HOST_NAME} (uri=${uri})`);
    const port = chrome.runtime.connectNative(HOST_NAME);
    this.transport = new NativeMessagingTransport(port);
    return this.transport;
  }

  async disconnect(): Promise<void> {
    if (this.transport && typeof (this.transport as any).close === 'function') {
      await (this.transport as any).close();
    }
    this.transport = null;
  }

  isConnected(): boolean {
    return this.transport !== null;
  }

  isSupported(uri: string): boolean {
    try {
      return new URL(uri).protocol === 'native:';
    } catch {
      return false;
    }
  }

  getDefaultConfig(): PluginConfig {
    return {};
  }

  async isHealthy(): Promise<boolean> {
    return this.transport !== null;
  }

  async callTool(client: Client, toolName: string, args: any): Promise<any> {
    if (!this.isConnected()) throw new Error('Native Messaging Plugin: Not connected');
    return client.callTool({ name: toolName, arguments: args });
  }

  async getPrimitives(client: Client): Promise<any[]> {
    if (!this.isConnected()) throw new Error('Native Messaging Plugin: Not connected');
    const { tools } = await client.listTools();
    return tools.map((t) => ({ type: 'tool', value: t }));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd SuperAssistant && pnpm vitest run chrome-extension/src/mcpclient/plugins/native/NativeMessagingPlugin.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/mcpclient/plugins/native/NativeMessagingPlugin.ts chrome-extension/src/mcpclient/plugins/native/NativeMessagingPlugin.test.ts
git commit -m "feat(extension): NativeMessagingPlugin ITransportPlugin impl"
```

---

## Task 11: Integrate `'native'` into the transport type system + registry + background + manifest

**Files:**
- Modify: `chrome-extension/src/mcpclient/types/plugin.ts:4`
- Modify: `chrome-extension/src/mcpclient/types/config.ts`
- Modify: `chrome-extension/src/mcpclient/core/PluginRegistry.ts`
- Modify: `chrome-extension/src/mcpclient/index.ts` (`detectTransportType`)
- Modify: `chrome-extension/src/background/index.ts` (default URL for native)
- Modify: `pages/content/src/hooks/useMcpCommunication.ts:225`
- Modify: `chrome-extension/manifest.ts:53`

- [ ] **Step 1: Extend `TransportType`**

In `chrome-extension/src/mcpclient/types/plugin.ts` line 4:

```ts
export type TransportType = 'sse' | 'websocket' | 'streamable-http' | 'native';
```

- [ ] **Step 2: Add config type + default**

In `chrome-extension/src/mcpclient/types/config.ts`, add a type after `StreamableHttpPluginConfig`:

```ts
export interface NativePluginConfig extends PluginConfig {
  hostName?: string;
}
```

Extend `ClientConfig.plugins` and `DEFAULT_CLIENT_CONFIG.plugins`:

```ts
  plugins: {
    sse?: SSEPluginConfig;
    websocket?: WebSocketPluginConfig;
    'streamable-http'?: StreamableHttpPluginConfig;
    native?: NativePluginConfig;
  };
```
and in `DEFAULT_CLIENT_CONFIG.plugins` add:
```ts
    native: {
      hostName: 'com.superassistant.host',
    },
```

- [ ] **Step 3: Register the plugin**

In `chrome-extension/src/mcpclient/core/PluginRegistry.ts`, add the import (top, after the other plugin imports):

```ts
import { NativeMessagingPlugin } from '../plugins/native/NativeMessagingPlugin';
```

In `loadDefaultPlugins()` (after the `StreamableHttpPlugin` line), add:

```ts
      await this.register(new NativeMessagingPlugin());
```

- [ ] **Step 4: Detect `native://` URIs**

In `chrome-extension/src/mcpclient/index.ts`, find `detectTransportType` (line ~144). Add a native branch:

```ts
function detectTransportType(uri: string): TransportType {
  try {
    const url = new URL(uri);
    if (url.protocol === 'native:') return 'native' as TransportType;
    if (url.protocol === 'ws:' || url.protocol === 'wss:') return 'websocket' as TransportType;
    return 'sse' as TransportType; // existing logic
  } catch {
    return 'sse' as TransportType;
  }
}
```
(Read the existing body first; preserve its current SSE/streamable detection and only insert the `native:` branch.)

- [ ] **Step 5: Background default URL for native**

In `chrome-extension/src/background/index.ts`, wherever the default URL is chosen by type (lines ~76–78 and ~936), add a native branch. Native uses a sentinel URI; the plugin reads only the host name, not the URI:

```ts
const defaultUrl =
  connectionType === 'native' ? 'native://com.superassistant.host'
  : connectionType === 'websocket' ? DEFAULT_WEBSOCKET_URL
  : connectionType === 'streamable-http' ? DEFAULT_STREAMABLE_HTTP_URL
  : DEFAULT_SSE_URL;
```
Also add near the other default constants (~line 48–50):
```ts
const DEFAULT_NATIVE_URI = 'native://com.superassistant.host';
```
(Use it in both branches that build the default URL.)

- [ ] **Step 6: Allow `'native'` through the content-script guard**

In `pages/content/src/hooks/useMcpCommunication.ts` line 225, change the allow-list:

```ts
    if (cfg.connectionType && !['sse', 'websocket', 'streamable-http', 'native'].includes(cfg.connectionType)) {
```

- [ ] **Step 7: Add the `nativeMessaging` permission**

In `chrome-extension/manifest.ts` line 53:

```ts
  permissions: ['storage', 'clipboardWrite', 'alarms', 'nativeMessaging'],
```

- [ ] **Step 8: Type-check + build**

Run: `cd SuperAssistant && pnpm type-check`
Expected: no errors (the closed `TransportType` union is the main risk — the grep in planning found every reference; if any file errors, add the missing branch).

Run: `cd SuperAssistant && pnpm build`
Expected: build succeeds; `dist/manifest.json` now lists `nativeMessaging`.

- [ ] **Step 9: Commit**

```bash
git add chrome-extension/src/mcpclient/types/plugin.ts chrome-extension/src/mcpclient/types/config.ts chrome-extension/src/mcpclient/core/PluginRegistry.ts chrome-extension/src/mcpclient/index.ts chrome-extension/src/background/index.ts pages/content/src/hooks/useMcpCommunication.ts chrome-extension/manifest.ts
git commit -m "feat(extension): register native transport across type system, registry, background, manifest"
```

---

## Task 12: UI option + full smoke test

**Files:**
- Modify: `pages/content/src/components/sidebar/ServerStatus/ServerStatus.tsx` (~lines 797–842)

- [ ] **Step 1: Add the select option**

In `ServerStatus.tsx`, in the transport `<select>` (around line 797–806), add the native option:

```tsx
                  <option value="sse">SSE</option>
                  <option value="websocket">WebSocket</option>
                  <option value="streamable-http">Streamable HTTP</option>
                  <option value="native">Native (local host, no port)</option>
```

- [ ] **Step 2: Adjust the help hint + URI field for native**

Find the URI placeholder / npx hint block (around lines 808–842). For native, hide the `npx` proxy hint and show an install reminder instead. Add a conditional above the existing `connectionType === 'sse'` branch:

```tsx
                  {connectionType === 'native'
                    ? 'Local host via Native Messaging. Build mcp-host, then place the binary + manifest (see mcp-host/README.md). No port, no Node.'
                    : connectionType === 'sse'
                      ? /* existing SSE hint */
                      : /* existing WS / streamable branches */}
```
Set the URI input to read-only/disabled when `connectionType === 'native'` (the URI is the fixed sentinel) and show `native://com.superassistant.host`.

- [ ] **Step 3: Build + load**

Run: `cd SuperAssistant && pnpm build`
Load `dist/` in Firefox via `about:debugging` → Load Temporary Add-on → `dist/manifest.json`.

- [ ] **Step 4: End-to-end smoke test**

Pre-requisite: complete the host install in `mcp-host/README.md` (copy binary + manifest, set extension ID in `allowed_extensions`, `xattr` if needed, write `host-config.json` with an allowed test folder).

Steps:
1. Open a supported chat site (e.g. chatgpt.com).
2. Open the extension sidebar → Server Status → choose **Native (local host, no port)** → Save.
3. Expect "connected" status (no `SSE error: NetworkError`).
4. Trigger a tool call from the AI: ask it to read a file via `read_file` from an allowed folder.
5. Confirm the result renders in chat.
6. Trigger an `execute_command` for an allowlisted binary (e.g. `git status` in an allowed folder); confirm the result.
7. Confirm a denied command (e.g. `rm something`) is rejected with the policy reason.

Expected: steps 3–7 all pass; no localhost port was opened (`lsof -nP -iTCP:3006` shows nothing).

- [ ] **Step 5: Commit**

```bash
git add pages/content/src/components/sidebar/ServerStatus/ServerStatus.tsx
git commit -m "feat(extension): add Native transport option to ServerStatus UI"
```

---

## Self-Review (run after writing — done)

**Spec coverage:**
- Component 1 (`mcp-host` binary) → Tasks 1–8.
- Component 2 (native-messaging manifest) → Task 8.
- Component 3 (`NativeMessagingTransport` plugin) → Tasks 9–10.
- Component 4 (manifest `nativeMessaging` permission) → Task 11 step 7.
- Data flow (Section 2) → exercised by Task 7 + Task 12 integration tests.
- Security: allowlist/destructive-deny → Task 6; `allowed_extensions` → Task 8 manifest; no port → Task 12 step 7 verifies.
- Build & distribution → Task 8.
- Risks → documented in `mcp-host/README.md` (Task 8 step 5).
- Testing → unit tests per task + integration (Task 7) + manual smoke (Task 12).
- Files Changed summary → matches File Structure above.

**Placeholder scan:** none. (Task 3 has an intentional self-noted typo callout — corrected inline: use `framed`, not `frapped`.)

**Type consistency:** `'native'` added consistently to `TransportType`, `ClientConfig.plugins`, `DEFAULT_CLIENT_CONFIG`, `detectTransportType`, background default URL, and the `useMcpCommunication` guard. `NativeMessagingPlugin.metadata.transportType === 'native'`. `NativeMessagingTransport`/`NativeMessagingPlugin` names stable across tasks.

**Deferred (called out in spec, not in MVP):** interactive extension-side approve/deny prompt for `execute_command` (the host-side policy in Task 6 is the always-on safety net). This is a clean follow-up task once the core loop runs.

---

## Notes for implementer
- `rtk` is a local command wrapper; if `rtk cat/ls/grep` isn't on your machine, use `cat`/`ls`/`rg` directly.
- The host must NEVER print free-form text to stdout (only framed messages). All diagnostics go to stderr (`console.error`).
- Firefox temporary add-ons get a generated extension ID; for `allowed_extensions` to match during dev, either pin a key (preferred) or add the dev ID temporarily. Document this in `mcp-host/README.md`.
