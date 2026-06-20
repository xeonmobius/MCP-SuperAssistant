# Uploaded Skills — In-Extension Storage + Progressive Disclosure

## Problem
Today skills load from disk (native-messaging host) or storage (builtin-browser-server). The user wants to **upload skills directly to the extension** (no filesystem/MCP), have them **persist across sessions**, support **large data beyond `localStorage`'s ~5MB limit**, and keep context small via the existing **Level 1/2/3 progressive disclosure**. Phase 1 covers skills + text references; Phase 2 adds executable scripts.

## Constraints
- **Upload mechanism:** folder picker (`<input webkitdirectory>`) — user picks a folder; extension receives files with relative paths. No zip parsing.
- **Reference types (Phase 1):** text-based only (`.md/.txt/.json/.yaml/.yml/.csv` + source code). The AI reads them via `skill_read_asset`. Non-text files are **skipped** in Phase 1 (Phase 2 scripts handle them).
- **Persistence + scale:** data must survive browser restarts and exceed `localStorage` limits → metadata in `chrome.storage.local`, reference text in IndexedDB (extension origin, GB-scale).
- **Disclosure:** uploaded skills must flow through the **existing** pipeline unchanged — `## AVAILABLE SKILLS` (L1 name+description), `skill_<name>` pseudo-tool (L2 content), `skill_read_asset` (L3 references) — so context stays small.
- **Integration:** uploaded skills **merge** into the same AVAILABLE SKILLS list as disk/storage skills (`source: 'uploaded'`). Full CRUD: upload, list, delete, replace.
- **Cross-browser:** must work in **Chrome and Firefox**. The `build:firefox` manifest transform (service_worker→scripts) already handles the background context.
- **TDD:** implementation is test-first (`/tdd`).

## Non-Goals (Phase 1)
- Executable scripts / WASM / running code (Phase 2).
- Binary/image reference assets (text-only in Phase 1).
- Syncing uploaded skills across devices (`chrome.storage.sync` is too small anyway).
- A separate "uploaded skills" UI section — they merge into the existing skills surface.

## Architecture

**Service-worker-centric (Approach A).** Two stores, both owned by the background service worker (extension origin):

- **Metadata** → `chrome.storage.local`, key `uploadedSkills` (an array of `UploadedSkill`). Small, structured, reactive via `chrome.storage.onChanged`.
- **Reference text** → **IndexedDB**, DB `mcp-skills`, object store `references`. Large, persistent, survives SW restarts.

The content script/sidebar never touches storage directly — it talks to the SW via `chrome.runtime.sendMessage` (the existing content↔background pattern). The SW reads/writes both stores and replies.

Uploaded skills are just `Skill` objects with `source: 'uploaded'`, loaded by the existing `loader.ts` from `uploaded-store` and merged into the single `Skill[]` fed to `generateInstructionsJson`. The disclosure model, the `skill_<name>` pseudo-tool, and `skill_read_asset` are **unchanged** — only the loader and asset-resolver gain an `uploaded` branch.

Phase 2's offscreen document reads script blobs from the **same** IndexedDB (same origin) — no migration, no Phase 1 rework.

## Data Model

`UploadedSkill` (metadata, in `chrome.storage.local` under `uploadedSkills`):
```ts
interface UploadedSkill {
  name: string;          // unique key; matches Skill.name (AVAILABLE SKILLS keys by name)
  description: string;   // L1
  allowedTools?: string;
  content: string;       // L2 — the SKILL.md body (small KB → stored here, not IDB)
  sourceDir?: string;    // original folder name (display)
  uploadedAt: number;
  references: string[];  // asset paths → keys into IDB
}
```

IndexedDB (DB `mcp-skills`, store `references`):
- **key:** `${skillName}::${relativePath}` (e.g. `my-skill::examples/demo.md`)
- **value:** `{ skillName, path, text, size, uploadedAt }`
- **index:** `skillName` → fast "delete all refs for a skill" + "list refs for a skill"

## Components (each one responsibility, independently testable)

| File | Action | Responsibility |
|---|---|---|
| `chrome-extension/src/skills/uploaded-parser.ts` | **Create** | Pure fn `parseUploadedFolder(File[]) → { skill: UploadedSkill, references: Map<path, text> }` \| `{ error }`. Finds `SKILL.md`, reuses `parseSkillMarkdown`, filters text files, skips non-text. No I/O. |
| `chrome-extension/src/skills/uploaded-store.ts` | **Create** | Storage CRUD: `saveUploadedSkill`, `listUploadedSkills`, `getUploadedSkill`, `deleteUploadedSkill`, `readReference(skillName, path)`. Injectable `chrome.storage` + IDB deps → unit-testable. |
| `chrome-extension/src/background/skills-upload-handler.ts` | **Create** | Message router: `uploadSkill` / `listUploaded` / `deleteUploaded` / `replaceUploaded` / `readReference` → `uploaded-store`. Registered in `background/index.ts`. |
| `pages/content/src/.../uploadedSkillsClient.ts` | **Create** | Content-side thin client wrapping `chrome.runtime.sendMessage` for the 5 ops. Used by UI + asset-resolver. |
| `chrome-extension/src/skills/loader.ts` | **Modify** | Add uploaded-source branch: load via `uploaded-store.list`, map `UploadedSkill → Skill`, merge into `Skill[]`. |
| Asset-resolver (`skill_read_asset` path) | **Modify** | If `skill.source === 'uploaded'`, route to `readReference` (via client) instead of disk. |
| Sidebar UI (Skills area) | **Modify** | "Upload skill" button (folder picker) + uploaded-skills list with delete/replace. |

**Untouched:** `Skill` interface, `parseSkillMarkdown`, `generateInstructionsJson`, the `## AVAILABLE SKILLS` section, the `skill_<name>` pseudo-tool, the disclosure model.

## Data Flow

**Upload:** sidebar folder-picker → `File[]` (`webkitdirectory`) → client `uploadSkill(files)` → SW runs `uploaded-parser` → `uploaded-store.saveUploadedSkill` (metadata→storage.local, refs→IDB) → ack. Loader refresh → skill appears in AVAILABLE SKILLS.

**Read at L3:** model calls `skill_read_asset({skill, path})` → asset-resolver sees `source==='uploaded'` → client `readReference(skill, path)` → SW → `uploaded-store.readReference` → text returned to the model. Non-uploaded skills keep the existing disk path.

**Delete/replace:** `deleteUploaded(name)` → store drops metadata + cascades IDB refs (by `skillName` index). Replace = delete + upload (same name).

## Error Handling
- **Parse failure** (no `SKILL.md`, malformed frontmatter) → parser returns `{error}`; UI shows it; nothing stored.
- **Name collision with a non-uploaded source** (disk/storage) → reject + suggest rename (don't silently shadow). Collision with an existing uploaded skill → reject unless the user explicitly replaces.
- **Quota** — `storage.local` write throws on quota (unlikely for metadata); IDB effectively unlimited. On either: roll back the partial write, surface "storage full."
- **Missing reference** (L3 path not in IDB) → `{error: 'asset-not-found'}` to the model (mirrors existing asset-resolver).
- **Concurrent upload/replace** — serialize per skill name at the SW handler.

## Cross-Browser (Chrome + Firefox)
| Concern | Status |
|---|---|
| Folder picker `webkitdirectory` | ✓ Firefox supports it; files carry `webkitRelativePath`. React needs `inputRef.current.setAttribute('webkitdirectory','')` (both browsers). |
| `chrome.storage.local` | ✓ `chrome.*` aliased to `browser.*` in Firefox; codebase already uses `chrome.*`. |
| IndexedDB (extension origin) | ✓ persistent in the Firefox background context. |
| `chrome.runtime.sendMessage` | ✓ wakes an unloaded background the same way. |
| Background context | Firefox runs it as an **event page** (the `build:firefox` manifest transform swaps `service_worker`→`scripts`); same code, longer-lived than Chrome's SW. |
| CSP / `wasm-unsafe-eval` | Phase 2 only; Firefox supports it. |

Verify step in the plan: test in Chrome **and** Firefox.

## Testing (TDD)
The two pure modules are the TDD surface:
- **`uploaded-parser.test.ts`** — finds SKILL.md, parses frontmatter, filters text vs non-text, handles missing SKILL.md, builds the reference map with correct relative paths.
- **`uploaded-store.test.ts`** — save/list/get/delete metadata; IDB ref write + read by `skillName::path`; delete cascades refs via the `skillName` index. Injectable fake-`chrome.storage` + `fake-indexeddb`.
- Integration (handlers/client/loader/asset-resolver wiring) covered by extending the existing `skill-progressive-disclosure` / `skill-enablement` / `tool-list` tests — uploaded skills must flow through disclosure identically to disk skills.

`RED → GREEN → REFACTOR` per test: write one failing test, watch it fail, minimal code, watch it pass.

## Phase 2 Sketch (scripts — separate spec, later)
- SKILL.md frontmatter gains `scripts: [{path, type:'module'|'wasm'|'worker'}]`.
- Script blobs stored in a second IDB store (`scripts`) in the same DB.
- An **offscreen document** reads script blobs from IDB + runs them (Worker for JS, `WebAssembly.instantiateStreaming` for WASM); SW relays `runScript` messages to it.
- CSP gains `'wasm-unsafe-eval'`; trust model: user-uploaded = trusted but sandboxed in the offscreen (no extension privileges).
- **No Phase 1 rework** — storage + disclosure are reused as-is.

## Success Criteria (Phase 1)
- Upload a skill folder; it persists across browser restart in both Chrome + Firefox.
- Uploaded skill appears in AVAILABLE SKILLS (L1), its content loads via `skill_<name>` (L2), its references read via `skill_read_asset` (L3) — indistinguishable from a disk skill to the model.
- Data far exceeding `localStorage` (e.g. multi-MB reference docs) stores + reads without error.
- Delete removes the skill + all its references; replace overwrites cleanly.
- No regression to disk/storage skill loading or the existing disclosure tests.
