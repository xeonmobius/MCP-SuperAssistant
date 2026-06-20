# Builtin Browser Server — Serverless In-Extension MCP (Browser-Only Mode)

## Problem
On a locked company laptop the user **can install the extension but cannot run any local binary** (EDR/Gatekeeper policy), has **no Node.js**, and **no remote host** is permitted. The native-messaging host (spec `2026-06-16-native-messaging-host-design.md`) is therefore unusable there. The user still wants SuperAssistant to provide AI-tool augmentation on that machine, and to carry their **skills (Level 1/2/3 progressive disclosure)** with them.

Goal: an entirely in-browser MCP server — **no binary, no port, no Node, no remote** — exposing browser-native tools and storage-backed skills, selectable as a new transport.

## Constraints
- No local helper binary of any kind (EDR blocks unknown executables).
- No Node.js / npx.
- No remote host; everything runs in the browser.
- No listening TCP port.
- Must not break existing SSE / WebSocket / StreamableHTTP / Native transports.
- Must reuse the existing Level 1/2/3 skill pipeline (`toolList`, `InstructionManager`, `skill_read_asset`) — only the *source* of skills changes (disk → storage).
- User wants `web_fetch` to reach **any URL** (broaden `host_permissions`).

## Non-Goals
- Local filesystem read/write or shell execution (impossible without a helper binary — explicitly out of scope for this mode).
- Replacing the native host (kept for machines where binaries can run).
- Publishing to extension stores.

## Architecture

A new **`'builtin'` transport**. The `BuiltinPlugin.connect()` spins up an MCP `Server` **inside the extension service worker** and links it to the existing `McpClient` with an in-memory transport pair — the SDK's `InMemoryTransport.createLinkedPair()`. The client believes it is talking to a transport; the server runs in the same process. No URL, no port, no external process.

```
┌───────────────────────────────────────────────────────────┐
│ Extension service worker (MV3)                             │
│   McpClient ──connect('builtin://in-process')──            │
│        ↕ InMemoryTransport.createLinkedPair()              │
│   BuiltinServer (MCP Server)                               │
│     tools: web_fetch, page_read, selection_read,           │
│            extract_links, clipboard_*, notes_*,            │
│            skill_read_asset (Phase 2)                      │
│        │                                                   │
│        ├── chrome.scripting.executeScript (active tab)     │
│        ├── fetch() (broad host_permissions)                │
│        ├── navigator.clipboard / offscreen (see Risks)     │
│        └── chrome.storage.local (notes + skills)           │
└───────────────────────────────────────────────────────────┘
```

### Why this satisfies every constraint
- **No binary / no Node / no port / no remote** — pure in-SW JS.
- **Reuses skill pipeline** — storage skills are shaped into the existing `Skill[]` contract so Level 1/2/3 disclosure + `skill_read_asset` work unchanged (asset source switches disk→storage).
- **Selectable** — new `'builtin'` transport in the sidebar, mirrors SSE/Native UX.

## Components

### 1. `BuiltinPlugin` + `'builtin'` transport (Phase 1)
- Path: `chrome-extension/src/mcpclient/plugins/builtin/BuiltinPlugin.ts`
- Implements `ITransportPlugin`. `metadata.transportType = 'builtin'`.
- `connect(uri)`: creates the `BuiltinServer`, calls `InMemoryTransport.createLinkedPair()` → `[clientTransport, serverTransport]`, `await server.connect(serverTransport)`, returns `clientTransport`.
- `isSupported('builtin://in-process')` → true.
- Adds `'builtin'` to BOTH `TransportType` (`types/plugin.ts`) AND the content-script `ConnectionType` (`pages/content/src/types/stores.ts`) — the two-union lesson from the native work.
- Registered in `PluginRegistry.loadDefaultPlugins()`.
- Background default-URL branch + `detectTransportType('builtin:')` + `useMcpCommunication` guard += `'builtin'` (same integration pattern as Task 11 of the native spec).

### 2. `BuiltinServer` — in-process MCP server (Phase 1)
- Path: `chrome-extension/src/mcpclient/plugins/builtin/server/BuiltinServer.ts`
- `createServer()` returns an MCP `Server` (`@modelcontextprotocol/sdk/server`) with the browser tools registered via `setRequestHandler(ListToolsRequestSchema / CallToolRequestSchema)`. Mirrors `mcp-host/src/server.ts` structure.

### 3. Browser tool handlers (Phase 1)
Path: `chrome-extension/src/mcpclient/plugins/builtin/tools/*.ts`. Each handler returns MCP `{ content: [{ type: 'text', text }] }`.
- `web_fetch({ url })` — `fetch(url)` in the SW; return response text (HTML stripped to text, capped size). Works for any URL covered by `host_permissions` (extensions bypass CORS with host perms).
- `page_read()` — `chrome.tabs.query({active:true})` → `chrome.scripting.executeScript({ target, func: () => document.body.innerText })`; return text.
- `selection_read()` — `chrome.scripting.executeScript` returning `window.getSelection().toString()`.
- `extract_links()` — `chrome.scripting.executeScript` returning `<a>` hrefs joined.
- `clipboard_write({ text })` — `navigator.clipboard.writeText` (needs `clipboardWrite`, reliable in SW).
- `clipboard_read()` — **MV3 limitation**: reading clipboard from a SW without a document/gesture is unreliable. Implement via an **offscreen document** (`chrome.offscreen`) + `navigator.clipboard.readText`. Needs `clipboardRead` + `offscreen` permissions. Flagged in Risks.
- `notes_read()` / `notes_write({ key, text })` — read/write `chrome.storage.local` under `mcp_builtin_notes`.

### 4. Storage-backed skills (Phase 2)
- Storage key `mcp_builtin_skills`: array of `{ id, name, description, content, assets: Record<filename,string>, enabled }`.
- New loader `loadSkillsFromBuiltinStorage()` → returns `Skill[]` in the existing shape (sets `sourceDir` to a synthetic id, `content` from storage, `assets` keys advertised for Level 3). Plugs into the SAME downstream pipeline (`buildEnabledSkillTools`, `InstructionManager`).
- `skill_read_asset` (existing tool) gains a storage branch: when the skill's source is `builtin`, read asset text from the stored `assets` map instead of the filesystem MCP server. (Touches the existing `skill_read_asset` implementation in the extension.)

### 5. Skill editor UI (Phase 3)
- Extends `pages/content/src/components/sidebar/AvailableSkills/` (and the skills-paths UI in `ServerStatus`): add create/edit/delete for builtin skills + a per-skill asset-file editor (filename → textarea). Persists to `mcp_builtin_skills`. Reuses the skills-paths UI patterns already present.

### 6. Manifest changes (Phase 1)
`chrome-extension/manifest.ts`:
- `permissions` += `'activeTab'`, `'scripting'`, `'clipboardWrite'`, `'clipboardRead'`, `'offscreen'`, `'tabs'`.
- `host_permissions` += `'<all_urls>'` (or `'*://*/*'`) so `web_fetch` can reach any URL.
- Note: broadening host_permissions triggers a bigger re-grant prompt and **may be restricted by IT policy** on the work laptop (see Risks).

## Data Flow

`web_fetch` (all in SW):
1. AI emits `web_fetch` tool call → content script → background SW → McpClient → BuiltinPlugin → BuiltinServer handler.
2. Handler: `const r = await fetch(url); const text = await r.text();` → return trimmed/capped text → back up the chain → AI.

`page_read` (SW → active tab → SW):
1. Same path to BuiltinServer handler.
2. Handler: `chrome.tabs.query({active:true,currentWindow:true})` → `chrome.scripting.executeScript({ target:{tabId}, func: () => document.body.innerText })` → return `result[0].result`.

`skill_read_asset` (Phase 2, storage):
1. AI calls `skill_read_asset({ skill_id, asset })`.
2. Handler reads `mcp_builtin_skills`, finds the skill, returns `assets[asset]` text.

## Security & Permissions
- **Broad `host_permissions`** (`<all_urls>`) — the AI can fetch any URL the extension can reach. This is the user's explicit choice. On a locked laptop, IT may block this grant; if so, `web_fetch` degrades to whatever host_permissions are allowed.
- **`activeTab` + `scripting`** — `page_read`/`selection_read`/`extract_links` read the active tab on user action. scoped to the active tab per the `activeTab` model.
- **`clipboardRead`** — sensitive; gated to the offscreen document path only.
- **`notes` / skills** — stored in `chrome.storage.local` (local to the machine, not synced unless `storage.sync` is used; spec uses `.local`). No outbound traffic.
- No remote, no disk, no shell — the in-browser surface is the only attack surface.

## Phasing (each phase ships working, testable software)

### Phase 1 — Builtin transport + browser tools
- `BuiltinPlugin` + `'builtin'` transport + both-union extension.
- `BuiltinServer` + tool handlers: `web_fetch`, `page_read`, `selection_read`, `extract_links`, `clipboard_write`, `clipboard_read` (offscreen), `notes_read`, `notes_write`.
- Manifest permissions.
- Sidebar "Builtin" option.
- Tests: plugin + server + each tool (mocked `chrome.*`), vitest.

### Phase 2 — Storage-backed skills (3 levels)
- `mcp_builtin_skills` schema + `loadSkillsFromBuiltinStorage`.
- Wire into existing skill pipeline; `skill_read_asset` storage branch.
- Seed/import path (paste markdown, or a default set) since the editor UI is Phase 3.
- Tests: loader + `skill_read_asset` storage branch.

### Phase 3 — Skill editor UI
- Create/edit/delete skills + asset files in the sidebar.
- Tests: UI state reducers (mirror `skills-paths-ui.test.ts`).

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| IT blocks broad `host_permissions` on work laptop | Med-High | degrade `web_fetch` to allowed hosts; document |
| MV3 SW killed after ~30s idle → in-memory server state lost | Med | recreate server on connect; rely on existing reconnect logic; tools are stateless except notes (persisted) |
| `clipboard_read` unreliable in MV3 SW | Med | use offscreen document (`chrome.offscreen`); if still blocked, ship `clipboard_write` only in Phase 1, defer read |
| `chrome.scripting.executeScript` blocked by IT policy | Low-Med | `page_read` etc. fail gracefully with a clear error; user still has `web_fetch` + `notes` |
| Broad permissions trigger scary re-prompt | Med | expected; document in README |
| Phase 2 `skill_read_asset` change breaks filesystem path | Low | keep filesystem branch intact; add storage branch behind source-type check; existing integration test guards it |

## Testing
- **Plugin unit** (vitest): `BuiltinPlugin` against an in-memory `chrome` mock; `connect()` returns a working transport; `'builtin'` registered.
- **Server + tool unit** (vitest): each handler with mocked `chrome.tabs`/`chrome.scripting`/`fetch`/`chrome.storage`/`chrome.offscreen`. Verify MCP `CallToolResult` shapes.
- **Storage-skills unit** (Phase 2): `loadSkillsFromBuiltinStorage` returns expected `Skill[]`; `skill_read_asset` reads from storage.
- **Regression**: existing transports (SSE/WS/streamable/native) still register + connect; existing filesystem skill path unaffected (the `filesystem-mcp.integration.test.ts` still passes).

## Files Changed (summary)
- NEW: `chrome-extension/src/mcpclient/plugins/builtin/BuiltinPlugin.ts` (+ test)
- NEW: `chrome-extension/src/mcpclient/plugins/builtin/server/BuiltinServer.ts` (+ test)
- NEW: `chrome-extension/src/mcpclient/plugins/builtin/tools/{web_fetch,page_read,selection_read,extract_links,clipboard,notes}.ts` (+ tests)
- NEW (Phase 2): `chrome-extension/src/skills/builtin-storage.ts` (+ test); MOD the `skill_read_asset` implementation to add a storage branch.
- NEW (Phase 3): skill editor components under `pages/content/src/components/sidebar/AvailableSkills/`.
- MOD: `chrome-extension/src/mcpclient/types/plugin.ts` (`TransportType` += `'builtin'`), `pages/content/src/types/stores.ts` (`ConnectionType` += `'builtin'`), `PluginRegistry.ts`, `mcpclient/index.ts` (`detectTransportType`), `background/index.ts` (default URL), `useMcpCommunication.ts` (guard), `ServerStatus.tsx` (UI option), `manifest.ts` (permissions + host_permissions).

## Open Questions
- `clipboard_read`: offscreen document vs defer to Phase 2? (Lean: attempt offscreen in Phase 1, defer if blocked.)
- Seeding Phase-2 skills before the Phase-3 editor: paste-markdown import vs a hardcoded default set?
- `notes`: per-skill notes vs a single global notepad? (Lean: simple key-value notes tool, global.)
- Whether to also offer `chrome.storage.sync` for skills (syncs across the user's browsers) — privacy trade-off on a work machine; lean `.local` only.
