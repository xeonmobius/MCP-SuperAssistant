# Native Messaging Host — Serverless Local MCP Transport

## Problem
MCP SuperAssistant currently requires a local Node proxy (`npx mcp-superassistant-proxy`) listening on `localhost:3006` to reach stdio MCP servers (`filesystem`, `desktop-commander`). This fails on a restrictive company laptop where:
- Node.js / `npx` cannot be installed
- No remote host is permitted (all execution must be local)
- A listening localhost port is undesirable/blocked

Goal: run the extension with full local read/write/shell capability **without installing Node, opening a port, or using any remote host**.

## Constraints
- No Node.js / `npx` / package install on the target machine.
- No remote host; everything executes locally on the laptop.
- No listening TCP port.
- Must preserve existing SSE / WebSocket / StreamableHTTP transports (non-breaking).
- Shell exec is a compliance risk on a work laptop → must be gated.

## Non-Goals
- Removing the existing proxy path (kept for users who have Node).
- Reaching the laptop from anywhere off-box.
- Publishing to browser extension stores (out of scope for this phase).

## Architecture

Replace the `npx`-launched proxy + stdio MCP servers with **one self-contained binary** that the browser launches on demand via Native Messaging. The browser becomes the process owner; nothing listens on the network.

```
┌──────────────────────────────────────────────────────────┐
│ MCP SuperAssistant extension (background / SW)            │
│  • existing SSE / WS / StreamableHTTP plugins (untouched) │
│  • NEW: NativeMessagingTransport plugin                    │
│       ↕ chrome.runtime.connectNative (stdio JSON pipe)    │
└──────────────────────────────────────────────────────────┘
                         │  browser spawns + owns lifecycle
┌──────────────────────────────────────────────────────────┐
│ mcp-host — single self-contained binary (Bun --compile)   │
│  • reads length-prefixed JSON from stdin                  │
│  • implements filesystem + desktop-commander MCP servers  │
│    INTERNALLY (Bun fs + Bun.$ shell) — no npx, no Node    │
│  • writes JSON responses to stdout                        │
│  • reads host-config.json for allowed paths / cmd policy  │
└──────────────────────────────────────────────────────────┘
```

### Why this satisfies every constraint
- **No Node/npx** — binary is self-contained (Bun runtime embedded via `--compile`).
- **No remote** — host is local; launched by the browser.
- **No port** — communication is the native-messaging stdin/stdout pipe; nothing listens on TCP.
- **Full local power** — host does real fs read/write/list + shell exec.
- **"No install"** — built on a dev machine; two files copied to the laptop (binary + manifest JSON). No installer, no admin install.

## Components

### 1. `mcp-host` binary (NEW)
- Location: new top-level folder `mcp-host/` in the monorepo (sibling to `chrome-extension/`, `packages/`). Add to `pnpm-workspace.yaml`.
- Language: TypeScript, compiled with `bun build --compile --target=bun-darwin-arm64` (add `bun-darwin-x64` + linux targets later as needed).
- Wire protocol: Mozilla/Chromium Native Messaging — `[4-byte little-endian length][UTF-8 JSON]` frames on stdin/stdout.
- Implements the MCP JSON-RPC server (`initialize`, `tools/list`, `tools/call`, notifications) and the two servers' tool logic directly:
  - `filesystem`: `read_file`, `read_text_file`, `write_file`, `list_directory`, `search_files`, etc. (subset parity with `@modelcontextprotocol/server-filesystem`).
  - `desktop-commander`: `execute_command` (gated), `read_output`, etc. (subset parity).
- Reads `host-config.json` (allowed root folders, command allowlist/denylist, destructive-op policy). This replaces the `command`/`args` fields of the current `config.json` — the host does not spawn child processes; it implements the tools itself.
- Bundled deps: only `@modelcontextprotocol/sdk` (server side) for types/handlers, plus Bun built-ins. No `npx` ever.

### 2. Native-messaging host manifest (NEW, distribution artifact)
- Firefox macOS path: `~/Library/Application Support/Mozilla/NativeMessagingHosts/com.mcpsuperassistant.host.json`
- Chrome macOS path: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.mcpsuperassistant.host.json`
- Shape:
  ```json
  {
    "name": "com.mcpsuperassistant.host",
    "description": "MCP SuperAssistant local host",
    "path": "/Users/<user>/bin/mcp-host",
    "type": "stdio",
    "allowed_extensions": ["<extension-id>"]
  }
  ```
- The extension ID must be pinned. For a temporary/dev install the ID is derived from the public key; we document pinning via a stable key, with a dev fallback.

### 3. `NativeMessagingTransport` plugin (NEW)
- Path: `chrome-extension/src/mcpclient/plugins/native/NativeMessagingPlugin.ts`
- Implements `ITransportPlugin` (sibling to `SSEPlugin.ts`).
- `connect()`: `chrome.runtime.connectNative('com.mcpsuperassistant.host')` → long-lived `Port`. Maps the MCP SDK `Transport` interface onto the port: `send` writes a framed message; `onmessage` parses inbound frames.
- `isSupported()`: returns `true` always (it's local); selection is by user choosing "Native" in settings, mirroring how SSE/WS are chosen today.
- Error handling mirrors `SSEPlugin` enhanced-error pattern: distinguish "host binary missing", "manifest not registered", "extension not in allowed_extensions".
- Registers in `chrome-extension/src/mcpclient/core/PluginRegistry.ts`.

### 4. Extension manifest change
- `chrome-extension/manifest.ts`: add `"nativeMessaging"` to `permissions`.

## Data Flow

Example: AI calls `read_file`.
1. AI emits MCP tool call in the chat page (content script).
2. Content script → `chrome.runtime.sendMessage` → background service worker.
3. `McpClient` selects `NativeMessagingTransport` (user-configured transport).
4. Plugin: `port = chrome.runtime.connectNative('com.mcpsuperassistant.host')`.
5. Plugin writes JSON-RPC: `{"method":"tools/call","params":{"name":"read_file", ...}}`, framed `[len][json]`.
6. `mcp-host` reads frame → routes to filesystem handler → `Bun.file(path).text()` → builds JSON-RPC result.
7. Host writes `[len][result]` to stdout → `port.onMessage` in the SW.
8. Plugin resolves the pending promise → `McpClient` returns result to content → rendered in chat.

The `Port` is kept alive for the session (long-lived, not per-message `sendNativeMessage`) so MCP notifications/streaming work the same as under SSE.

## Security Model

- `nativeMessaging` permission → standard user prompt at install.
- `allowed_extensions` in the host manifest locks the host to the single extension ID. No other extension can reach it.
- No open port → no network surface. Only the browser can launch the host, only with the right extension.
- Host is local-only, makes no outbound network calls, logs locally only. (No PHI/secret exfiltration path.)
- `host-config.json` defines: allowed root folders, command allowlist, destructive-op policy.

### Shell-execution posture (LOCKED: confirmation gate ON)
- Every `execute_command` triggers an **approve/deny prompt** in the extension UI before the host runs it.
- Any file **write** outside an allowed folder also triggers a prompt.
- Default-deny for destructive patterns (`rm`, redirections `>`, network egress tools) unless explicitly allowed in `host-config.json`.
- This is a behavior change vs. upstream `desktop-commander` (blind exec). Intentional and required for a company laptop.

### Signing (LOCKED: ad-hoc for now)
- `codesign -s - mcp-host` (ad-hoc). Free.
- Document one-time quarantine removal: `xattr -d com.apple.quarantine <path>`.
- Fallback if the laptop blocks it: Apple Developer ID sign + notarize ($99/yr). Tracked as a follow-up, not blocking.

## Build & Distribution

Build (on a dev mac with Bun installed at `~/.bun/bin/bun`):
```bash
cd mcp-host && bun install
bun build --compile --target=bun-darwin-arm64 ./src/index.ts --outfile mcp-host
codesign -s - mcp-host
```

Distribute to the locked laptop (copy two files, once):
1. `mcp-host` → a writable path, e.g. `~/bin/mcp-host`.
2. `com.mcpsuperassistant.host.json` → the `NativeMessagingHosts/` dir for each browser used.
3. First-run (if Gatekeeper bites): `xattr -d com.apple.quarantine ~/bin/mcp-host`.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Gatekeeper blocks unsigned binary | High | ad-hoc sign + `xattr`; fallback Developer ID |
| EDR (CrowdStrike/SentinelOne) flags binary | Med | not solvable in code — IT allowlist ticket |
| `NativeMessagingHosts/` dir not writable | Low | user home dir, usually writable |
| IT disabled `nativeMessaging` via policy | Med | check `about:policies` (Firefox) / Chrome policy |
| Dev/temp extension ID ≠ `allowed_extensions` | Med | pin key for stable ID; dev fallback config |
| `desktop-commander` parity gaps | Med | implement subset; document unsupported tools |

## Testing

- **Host unit tests** (vitest): native-messaging frame encode/decode round-trip; each tool handler (read_file, write_file, list_directory, execute_command with allowlist + denylist).
- **Host integration (headless)**: pipe canned `initialize` → `tools/list` → `tools/call` JSON frames into `mcp-host` stdin; assert stdout response frames.
- **Plugin unit tests**: `NativeMessagingTransport` against a mocked `chrome.runtime.connectNative` port; cover error cases (missing host, disallowed extension).
- **Manual smoke**: load extension, choose "Native" transport, connect, run a `read_file` + a gated shell command (approve/deny), confirm result renders in chat.
- **Regression**: existing SSE path still connects + calls a tool (existing plugins untouched).

## Files Changed (summary)

- NEW: `mcp-host/` workspace (package.json, src/index.ts, src/mcp/server.ts, src/tools/filesystem.ts, src/tools/desktop-commander.ts, src/native-messaging/framing.ts, host-config.schema.json, tests/).
- NEW: `chrome-extension/src/mcpclient/plugins/native/NativeMessagingPlugin.ts`
- NEW: `chrome-extension/src/mcpclient/plugins/native/__tests__/NativeMessagingPlugin.test.ts`
- MOD: `chrome-extension/src/mcpclient/core/PluginRegistry.ts` (register native plugin)
- MOD: `chrome-extension/src/mcpclient/config/defaults.ts` (add native default config)
- MOD: `chrome-extension/manifest.ts` (add `nativeMessaging` permission)
- MOD: connection settings UI (add "Native" transport option)
- MOD: `pnpm-workspace.yaml` (add `mcp-host`)

## Open Questions
- Exact subset of `desktop-commander` tools to support initially (propose: `execute_command` only; expand on demand).
- Whether to ship a one-shot installer script that writes the manifest + copies the binary, or keep it fully manual.
