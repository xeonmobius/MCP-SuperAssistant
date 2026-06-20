# Uploaded Skills (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. **TDD is mandatory** (`/tdd`): every code task writes the failing test first, watches it fail, writes minimal code, watches it pass.

**Goal:** Let users upload skill folders (`webkitdirectory`) into the extension; persist metadata in `chrome.storage.local` + text references in IndexedDB; merge into the existing AVAILABLE SKILLS disclosure (L1/L2/L3) with full CRUD. Phase 1 = text references only; scripts are Phase 2 (separate spec).

**Architecture:** Service-worker-centric. `uploaded-store` (background) owns both stores. The sidebar/content-script talks to it via `chrome.runtime.sendMessage` for the 4 CRUD ops. `skill_read_asset` already runs background-side (`background/index.ts:765`), so the L3 read for uploaded skills is a **direct** store call (no messaging). Uploaded skills merge into `cachedSkills` (loader.ts) → flow through the unchanged disclosure pipeline.

**Tech Stack:** TypeScript, Vitest (`chrome-extension/src/skills/__tests__/`), `chrome.storage.local`, IndexedDB (extension origin), `chrome.runtime` messaging. No new deps. Works in Chrome + Firefox.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `chrome-extension/src/skills/uploaded-parser.ts` | **Create** | Pure: `parseUploadedFolder(File[]) → {skill, references} \| {error}` |
| `chrome-extension/src/skills/__tests__/uploaded-parser.test.ts` | **Create** | TDD tests for the parser |
| `chrome-extension/src/skills/uploaded-store.ts` | **Create** | CRUD over storage.local + IndexedDB (injectable deps) |
| `chrome-extension/src/skills/__tests__/uploaded-store.test.ts` | **Create** | TDD tests for the store (fake storage + fake IDB) |
| `chrome-extension/src/background/index.ts` | **Modify** | Merge uploaded into `cachedSkills`; add `uploaded` branch in `skill_read_asset`; register CRUD message handler |
| `chrome-extension/src/skills/loader.ts` | **Modify** | Add `loadUploadedSkills()` returning `Skill[]` from the store |
| `pages/content/src/.../uploadedSkillsClient.ts` | **Create** | Content-side message wrapper for the 4 CRUD ops |
| `pages/content/src/components/sidebar/.../UploadedSkillsManager.tsx` | **Create** | Upload button + list + delete/replace UI |
| `pages/content/src/components/sidebar/Sidebar.tsx` | **Modify** | Mount the manager in the Skills area |

---

## Task 1: `uploaded-parser` (pure) — TDD

**Files:** Create `chrome-extension/src/skills/uploaded-parser.ts` + `chrome-extension/src/skills/__tests__/uploaded-parser.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// chrome-extension/src/skills/__tests__/uploaded-parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseUploadedFolder } from '../uploaded-parser';

const file = (path: string, text: string): File =>
  new File([text], path.split('/').pop() || path, { type: 'text/plain' });

// patch webkitRelativePath (not set by the File constructor)
const dirFile = (relPath: string, text: string): File => {
  const f = file(relPath, text);
  Object.defineProperty(f, 'webkitRelativePath', { value: relPath, configurable: true });
  return f;
};

const SKILL_MD = `---
name: my-skill
description: A test skill. Use when testing.
---
# My Skill body instructions`;

describe('parseUploadedFolder', () => {
  it('parses SKILL.md frontmatter into the skill', async () => {
    const res = await parseUploadedFolder([dirFile('my-skill/SKILL.md', SKILL_MD)]);
    expect('error' in res).toBe(false);
    if ('error' in res) return;
    expect(res.skill.name).toBe('my-skill');
    expect(res.skill.description).toBe('A test skill. Use when testing.');
    expect(res.skill.content).toContain('# My Skill body instructions');
    expect(res.skill.source).toBe('uploaded');
  });

  it('returns {error: "no-skill-md"} when no SKILL.md is present', async () => {
    const res = await parseUploadedFolder([dirFile('foo/README.md', '# readme')]);
    expect(res).toEqual({ error: 'no-skill-md' });
  });

  it('returns {error: "bad-frontmatter"} when SKILL.md has no name', async () => {
    const res = await parseUploadedFolder([dirFile('x/SKILL.md', '---\ndescription: no name\n---\nbody')]);
    expect(res).toEqual({ error: 'bad-frontmatter' });
  });

  it('collects text reference files keyed by path relative to the folder root', async () => {
    const res = await parseUploadedFolder([
      dirFile('my-skill/SKILL.md', SKILL_MD),
      dirFile('my-skill/examples/demo.md', '# demo'),
      dirFile('my-skill/data/ref.json', '{"a":1}'),
    ]);
    if ('error' in res) throw new Error('should not error');
    expect([...res.references.keys()].sort()).toEqual(['data/ref.json', 'examples/demo.md']);
    expect(res.references.get('examples/demo.md')).toBe('# demo');
    expect(res.skill.references.sort()).toEqual(['data/ref.json', 'examples/demo.md']);
  });

  it('skips non-text files (Phase 1 text-only)', async () => {
    const res = await parseUploadedFolder([
      dirFile('my-skill/SKILL.md', SKILL_MD),
      dirFile('my-skill/img/logo.png', 'binary-bytes'),
    ]);
    if ('error' in res) throw new Error('should not error');
    expect(res.references.size).toBe(0);
    expect(res.skill.references).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — verify FAIL** (`pnpm vitest run chrome-extension/src/skills/__tests__/uploaded-parser.test.ts`). Expected: FAIL, module not found.

- [ ] **Step 3: Implement the parser**

```ts
// chrome-extension/src/skills/uploaded-parser.ts
import { parseSkillMarkdown, type Skill } from './parser';

export interface UploadedSkill {
  name: string;
  description: string;
  allowedTools?: string;
  content: string;
  source: 'uploaded';
  sourceDir?: string;
  uploadedAt: number;
  references: string[];
}

export interface ParsedFolder {
  skill: UploadedSkill;
  references: Map<string, string>;
}

export type ParseError = { error: 'no-skill-md' | 'bad-frontmatter' };

const SKILL_MD_NAME = 'skill.md';
const TEXT_EXT = /\.(md|markdown|txt|text|json|ya?ml|csv|tsv|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|c|cc|cpp|h|hpp|sh|bash|zsh|ps1|sql|html?|css|scss|less|xml|toml|ini|env)$/i;

function baseName(p: string): string {
  const parts = p.split('/');
  return parts[parts.length - 1] || '';
}

function relPath(f: File): string {
  // @ts-expect-error webkitRelativePath is non-standard
  return f.webkitRelativePath || f.name;
}

export async function parseUploadedFolder(
  files: File[],
): Promise<ParsedFolder | ParseError> {
  const skillFile = files.find(f => baseName(relPath(f)).toLowerCase() === SKILL_MD_NAME);
  if (!skillFile) return { error: 'no-skill-md' };

  const raw = await skillFile.text();
  const parsed = parseSkillMarkdown(raw, 'uploaded');
  if (!parsed || !parsed.name) return { error: 'bad-frontmatter' };

  const skillRel = relPath(skillFile);
  const rootPrefix = skillRel.includes('/') ? skillRel.replace(/\/?[^/]+$/, '') : '';

  const references = new Map<string, string>();
  for (const f of files) {
    if (f === skillFile) continue;
    if (!TEXT_EXT.test(baseName(relPath(f)))) continue; // Phase 1: text-only
    let rel = relPath(f);
    if (rootPrefix && rel.startsWith(rootPrefix + '/')) rel = rel.slice(rootPrefix.length + 1);
    references.set(rel, await f.text());
  }

  const skill: UploadedSkill = {
    name: parsed.name,
    description: parsed.description,
    allowedTools: parsed.allowedTools,
    content: parsed.content,
    source: 'uploaded',
    sourceDir: rootPrefix || undefined,
    uploadedAt: Date.now(),
    references: [...references.keys()],
  };
  return { skill, references };
}

export function uploadedSkillToSkill(u: UploadedSkill): Skill {
  return {
    name: u.name,
    description: u.description,
    content: u.content,
    allowedTools: u.allowedTools,
    source: 'uploaded',
    sourceDir: u.sourceDir,
  };
}
```

- [ ] **Step 4: Run — verify PASS** (same command). Expected: 5 tests pass.
- [ ] **Step 5: Commit** — `feat(skills): add uploaded-parser (folder → skill + text refs) — phase 1`

---

## Task 2: `uploaded-store` (CRUD, injectable) — TDD

**Files:** Create `chrome-extension/src/skills/uploaded-store.ts` + `chrome-extension/src/skills/__tests__/uploaded-store.test.ts`.

- [ ] **Step 1: Write the failing tests** (fake `chrome.storage` via `vi.stubGlobal`; fake IDB = a tiny in-memory factory)

```ts
// chrome-extension/src/skills/__tests__/uploaded-store.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createUploadedStore, type StoreDeps } from '../uploaded-store';
import type { UploadedSkill } from '../uploaded-parser';

// ---- in-memory fake IDB (minimal: one object store, keyPath 'key', index 'skillName') ----
function fakeIdb() {
  const records: Record<string, any> = {};
  const factory: any = {
    open: (_name: string, _v: number) => {
      const req = { onupgradeneeded: null as any, onsuccess: null as any, onerror: null as any, result: null as any, error: null };
      setTimeout(() => {
        const store = {
          records,
          put(v: any) { records[v.key] = v; },
          get(k: string) { return { result: records[k] ?? null }; },
          delete(k: string) { delete records[k]; },
          index: (_name: string) => ({
            openCursor: (range: any) => {
              const only = range && range.only;
              const matching = Object.values(records).filter((r: any) => only === undefined || r.skillName === only);
              let i = 0;
              return { result: i < matching.length ? { value: matching[i], continue: () => { i++; req2.result = i < matching.length ? { value: matching[i], continue: () => {} } : null; } } : null };
              var req2: any = { result: i < matching.length ? { value: matching[i], continue: () => { i++; req2.result = i < matching.length ? { value: matching[i], continue: () => {} } : null; } } : null };
              return req2;
            },
          }),
        };
        const tx = { objectStore: () => store, oncomplete: null, onerror: null, error: null };
        const db = {
          objectStoreNames: { contains: () => true },
          transaction: () => { setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); return tx; },
          close: () => {},
        };
        req.result = db;
        // create index in fake (no-op; store.index fakes it)
        req.onsuccess && req.onsuccess();
      }, 0);
      return req;
    },
  };
  return factory;
}

const storageMap: Record<string, any> = {};
const storage = {
  get: vi.fn(async (k: string) => ({ [k]: storageMap[k] })),
  set: vi.fn(async (items: Record<string, any>) => { Object.assign(storageMap, items); }),
};

const deps: StoreDeps = { storage: storage as any, idbFactory: fakeIdb() as any };

const skill = (name: string): UploadedSkill => ({
  name, description: 'd', content: 'c', source: 'uploaded', uploadedAt: 1, references: ['a.md'],
});

beforeEach(() => { Object.keys(storageMap).forEach(k => delete storageMap[k]); });

describe('uploaded-store', () => {
  it('saves + lists skill metadata', async () => {
    const store = createUploadedStore(deps);
    await store.saveUploadedSkill(skill('s1'), new Map([['a.md', 'text']]));
    const list = await store.listUploadedSkills();
    expect(list.map(s => s.name)).toEqual(['s1']);
  });

  it('save replaces same-name skill metadata', async () => {
    const store = createUploadedStore(deps);
    await store.saveUploadedSkill(skill('s1'), new Map());
    await store.saveUploadedSkill({ ...skill('s1'), description: 'updated' }, new Map());
    const got = await store.getUploadedSkill('s1');
    expect(got?.description).toBe('updated');
  });

  it('reads a reference back by skill::path', async () => {
    const store = createUploadedStore(deps);
    await store.saveUploadedSkill(skill('s1'), new Map([['a.md', 'hello']]));
    const text = await store.readReference('s1', 'a.md');
    expect(text).toBe('hello');
  });

  it('delete removes metadata', async () => {
    const store = createUploadedStore(deps);
    await store.saveUploadedSkill(skill('s1'), new Map());
    await store.deleteUploadedSkill('s1');
    expect(await store.getUploadedSkill('s1')).toBeUndefined();
  });

  it('readReference returns undefined for a missing path', async () => {
    const store = createUploadedStore(deps);
    await store.saveUploadedSkill(skill('s1'), new Map());
    expect(await store.readReference('s1', 'nope.md')).toBeUndefined();
  });
});
```

(Note: the fake-IDB cursor above is intentionally minimal. If it proves fiddly during implementation, replace it with the `fake-indexeddb` package — `pnpm add -D -w fake-indexeddb` — and `import 'fake-indexeddb/auto'` at the test top. Either is acceptable; injectable factory keeps zero new deps.)

- [ ] **Step 2: Run — verify FAIL** (module not found).
- [ ] **Step 3: Implement the store** (use the implementation in the code block below; it matches the deps interface)

```ts
// chrome-extension/src/skills/uploaded-store.ts
import type { UploadedSkill } from './uploaded-parser';

const STORAGE_KEY = 'uploadedSkills';
const DB_NAME = 'mcp-skills';
const DB_VERSION = 1;
const STORE_REFS = 'references';

export interface StoreDeps {
  storage: { get: (k: string) => Promise<Record<string, any>>; set: (i: Record<string, any>) => Promise<void> };
  idbFactory: IDBFactory;
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_REFS)) {
        const os = db.createObjectStore(STORE_REFS, { keyPath: 'key' });
        os.createIndex('skillName', 'skillName', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function deleteBySkillName(store: IDBObjectStore, skillName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const idx = store.index('skillName');
    const req = idx.openCursor(IDBKeyRange.only(skillName));
    req.onsuccess = () => {
      const c = req.result;
      if (c) { store.delete((c.value as any).key); c.continue(); } else resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

export function createUploadedStore(deps: StoreDeps) {
  const { storage, idbFactory } = deps;

  const listUploadedSkills = async (): Promise<UploadedSkill[]> => {
    const r = await storage.get(STORAGE_KEY);
    return (r[STORAGE_KEY] as UploadedSkill[]) || [];
  };

  const getUploadedSkill = async (name: string): Promise<UploadedSkill | undefined> =>
    (await listUploadedSkills()).find(s => s.name === name);

  const saveUploadedSkill = async (skill: UploadedSkill, references: Map<string, string>): Promise<void> => {
    const all = (await listUploadedSkills()).filter(s => s.name !== skill.name);
    all.push(skill);
    await storage.set({ [STORAGE_KEY]: all });
    const db = await openDb(idbFactory);
    try {
      const tx = db.transaction(STORE_REFS, 'readwrite');
      const store = tx.objectStore(STORE_REFS);
      await deleteBySkillName(store, skill.name);
      for (const [path, text] of references) {
        store.put({ key: `${skill.name}::${path}`, skillName: skill.name, path, text, size: text.length, uploadedAt: skill.uploadedAt });
      }
      await txDone(tx);
    } finally { db.close(); }
  };

  const deleteUploadedSkill = async (name: string): Promise<void> => {
    const all = (await listUploadedSkills()).filter(s => s.name !== name);
    await storage.set({ [STORAGE_KEY]: all });
    const db = await openDb(idbFactory);
    try {
      const tx = db.transaction(STORE_REFS, 'readwrite');
      await deleteBySkillName(tx.objectStore(STORE_REFS), name);
      await txDone(tx);
    } finally { db.close(); }
  };

  const readReference = async (skillName: string, path: string): Promise<string | undefined> => {
    const db = await openDb(idbFactory);
    try {
      const tx = db.transaction(STORE_REFS, 'readonly');
      const store = tx.objectStore(STORE_REFS);
      return await new Promise<string | undefined>((resolve, reject) => {
        const req = store.get(`${skillName}::${path}`);
        req.onsuccess = () => resolve(req.result ? (req.result as any).text : undefined);
        req.onerror = () => reject(req.error);
      });
    } finally { db.close(); }
  };

  return { listUploadedSkills, getUploadedSkill, saveUploadedSkill, deleteUploadedSkill, readReference };
}

// Default background-side instance uses real chrome.storage + indexedDB.
export const uploadedStore = createUploadedStore({
  storage: chrome.storage.local,
  idbFactory: indexedDB,
});
```

- [ ] **Step 4: Run — verify PASS**. If the fake-IDB cursor is too brittle, switch to `fake-indexeddb` (acceptable swap — note it in the commit).
- [ ] **Step 5: Commit** — `feat(skills): add uploaded-store (storage.local + IDB CRUD) — phase 1`

---

## Task 3: Loader integration — merge uploaded into `cachedSkills`

**Files:** Modify `chrome-extension/src/skills/loader.ts`; modify the assembly call site in `chrome-extension/src/background/index.ts`.

- [ ] **Step 1: Add to `loader.ts`** (alongside the other loaders):

```ts
import { uploadedStore } from './uploaded-store';
import { uploadedSkillToSkill, type UploadedSkill } from './uploaded-parser';

export async function loadUploadedSkills(): Promise<Skill[]> {
  try {
    const uploaded: UploadedSkill[] = await uploadedStore.listUploadedSkills();
    return uploaded.map(uploadedSkillToSkill);
  } catch (err) {
    logger.warn('[SkillLoader] Failed to load uploaded skills:', err);
    return [];
  }
}
```

- [ ] **Step 2: Merge into the cache at the assembly point.** In `background/index.ts`, find where the existing loaders assemble into `cachedSkills` (around the `getCachedSkills()`/`setCachedSkills()` usage near line 376, where `existing = getCachedSkills()` is merged with freshly loaded skills). After that merge, ALSO merge uploaded:

```ts
import { loadUploadedSkills } from '../skills/loader';
// …at the assembly point, after disk/MCP skills are merged into cachedSkills:
const uploadedSkills = await loadUploadedSkills();
const withoutUploaded = getCachedSkills().filter(s => s.source !== 'uploaded');
setCachedSkills([...withoutUploaded, ...uploadedSkills]);
```

(Read the real assembly block first; match its style. The point is: de-duplicate `source==='uploaded'` then append the fresh uploaded list, so a re-upload/replace/delete is reflected on the next refresh.)

- [ ] **Step 3: Trigger a cache refresh after upload/replace/delete** (see Task 5's handler) — call the same assembly function so AVAILABLE SKILLS updates.
- [ ] **Step 4:** `pnpm type-check` (zero new) + `pnpm vitest run chrome-extension/src/skills` (parser/store tests still green).
- [ ] **Step 5: Commit** — `feat(skills): merge uploaded skills into cachedSkills — phase 1`

---

## Task 4: `skill_read_asset` — uploaded branch

**Files:** Modify the `skill_read_asset` handler in `chrome-extension/src/background/index.ts:765`.

- [ ] **Step 1:** In the `skill_read_asset` block, BEFORE the existing `!skill.sourceDir` guard, add an uploaded branch:

```ts
import { uploadedStore } from '../skills/uploaded-store';
// …inside the skill_read_asset handler, after `const skill = skills.find(...)`:
if (skill && skill.source === 'uploaded') {
  try {
    const text = await uploadedStore.readReference(skill_name, file_path);
    result = text
      ? { content: [{ type: 'text', text }] }
      : { content: [{ type: 'text', text: `Asset "${file_path}" not found in uploaded skill "${skill_name}"` }], isError: true };
  } catch (err) {
    result = { content: [{ type: 'text', text: `Failed to read uploaded asset "${file_path}": ${err instanceof Error ? err.message : String(err)}` }], isError: true };
  }
} else if (!skill || !skill.sourceDir) {
  // existing disk-error branch
  result = { content: [{ type: 'text', text: `Skill "${skill_name}" not found or has no source directory` }], isError: true };
} else {
  // …existing disk resolution path unchanged…
}
```

- [ ] **Step 2:** `pnpm type-check` + `pnpm build` + existing skill tests green.
- [ ] **Step 3: Commit** — `feat(skills): skill_read_asset reads uploaded-skill references — phase 1`

---

## Task 5: Background CRUD message handler

**Files:** Modify `chrome-extension/src/background/index.ts` (add branches to the existing `chrome.runtime.onMessage` listener at line 671).

- [ ] **Step 1:** Import the parser + store:

```ts
import { parseUploadedFolder } from '../skills/uploaded-parser';
import { uploadedStore } from '../skills/uploaded-store';
import { loadUploadedSkills } from '../skills/loader';
import { setCachedSkills, getCachedSkills } from '../skills/loader';
```

- [ ] **Step 2:** Add message branches (inside the existing listener's message-type switch):

```ts
if (message.type === 'uploadedSkill:upload' && message.files) {
  try {
    const parsed = await parseUploadedFolder(message.files as File[]);
    if ('error' in parsed) { sendResponse({ ok: false, error: parsed.error }); return true; }
    const collision = (await uploadedStore.listUploadedSkills())
      .find(s => s.name === parsed.skill.name);
    if (collision) { sendResponse({ ok: false, error: 'name-exists' }); return true; }
    await uploadedStore.saveUploadedSkill(parsed.skill, parsed.references);
    const uploaded = await loadUploadedSkills();
    setCachedSkills([...getCachedSkills().filter(s => s.source !== 'uploaded'), ...uploaded]);
    sendResponse({ ok: true, name: parsed.skill.name });
  } catch (err) {
    sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
  return true;
}

if (message.type === 'uploadedSkill:list') {
  sendResponse({ ok: true, skills: await uploadedStore.listUploadedSkills() });
  return true;
}

if (message.type === 'uploadedSkill:delete') {
  await uploadedStore.deleteUploadedSkill(message.name);
  const uploaded = await loadUploadedSkills();
  setCachedSkills([...getCachedSkills().filter(s => s.source !== 'uploaded'), ...uploaded]);
  sendResponse({ ok: true });
  return true;
}

if (message.type === 'uploadedSkill:replace') {
  const parsed = await parseUploadedFolder(message.files as File[]);
  if ('error' in parsed) { sendResponse({ ok: false, error: parsed.error }); return true; }
  await uploadedStore.saveUploadedSkill(parsed.skill, parsed.references); // saveUploadedSkill overwrites same-name
  const uploaded = await loadUploadedSkills();
  setCachedSkills([...getCachedSkills().filter(s => s.source !== 'uploaded'), ...uploaded]);
  sendResponse({ ok: true, name: parsed.skill.name });
  return true;
}
```

- [ ] **Step 3:** `pnpm type-check` + `pnpm build`.
- [ ] **Step 4: Commit** — `feat(skills): background CRUD handler for uploaded skills — phase 1`

---

## Task 6: Content client + sidebar UI

**Files:** Create `pages/content/src/skills/uploadedSkillsClient.ts`; create `pages/content/src/components/sidebar/Skills/UploadedSkillsManager.tsx`; modify the Sidebar Skills area to mount it.

- [ ] **Step 1: Content client**

```ts
// pages/content/src/skills/uploadedSkillsClient.ts
import type { UploadedSkill } from '../../../../chrome-extension/src/skills/uploaded-parser';

const send = (msg: any) => new Promise<any>((resolve) => chrome.runtime.sendMessage(msg, resolve));

export const uploadedSkillsClient = {
  upload: (files: File[]) => send({ type: 'uploadedSkill:upload', files }),
  list: () => send({ type: 'uploadedSkill:list' }) as Promise<{ ok: boolean; skills: UploadedSkill[] }>,
  delete: (name: string) => send({ type: 'uploadedSkill:delete', name }),
  replace: (name: string, files: File[]) => send({ type: 'uploadedSkill:replace', name, files }),
};
```

- [ ] **Step 2: UI component** — folder-picker button (`webkitdirectory` set via ref per the cross-browser note) + a list of uploaded skills (name, delete button, replace button). Use Phase-0 tokens (`bg-surface`, `text-ink`, etc.). On upload/replace/delete, call the client then refresh the list. Surface `{error:'name-exists'}` and `{error:'no-skill-md'|'bad-frontmatter'}` clearly.

```tsx
// pages/content/src/components/sidebar/Skills/UploadedSkillsManager.tsx
import React, { useEffect, useRef, useState } from 'react';
import { uploadedSkillsClient } from '../../../skills/uploadedSkillsClient';
import type { UploadedSkill } from '../../../../../../chrome-extension/src/skills/uploaded-parser';

const TEXT_ERR: Record<string, string> = {
  'no-skill-md': 'No SKILL.md found in the folder.',
  'bad-frontmatter': 'SKILL.md frontmatter is missing or has no name.',
  'name-exists': 'A skill with that name already exists. Use Replace.',
};

export const UploadedSkillsManager: React.FC = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [skills, setSkills] = useState<UploadedSkill[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => setSkills((await uploadedSkillsClient.list()).skills || []);
  useEffect(() => { refresh(); }, []);

  // webkitdirectory isn't recognised by React; set via ref (Chrome + Firefox).
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.setAttribute('webkitdirectory', '');
      inputRef.current.setAttribute('directory', '');
    }
  }, []);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setBusy(true); setError(null);
    try {
      const res = await uploadedSkillsClient.upload(files);
      if (!res.ok) setError(TEXT_ERR[res.error] || res.error || 'Upload failed');
      await refresh();
    } finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  };

  const onDelete = async (name: string) => {
    setBusy(true);
    try { await uploadedSkillsClient.delete(name); await refresh(); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-2">
      <input ref={inputRef} type="file" multiple className="hidden" onChange={onPick} />
      <button
        type="button" disabled={busy} onClick={() => inputRef.current?.click()}
        className="w-full rounded-pill bg-ink px-3 py-1.5 text-[11px] font-semibold text-surface disabled:opacity-40"
      >+ Upload skill folder</button>
      {error && <p className="text-[10px] text-err">{error}</p>}
      {skills.map(s => (
        <div key={s.name} className="flex items-center gap-2 rounded-card border border-line bg-surface p-2">
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">{s.name}</span>
          <button type="button" disabled={busy} onClick={() => onDelete(s.name)}
            className="text-[10px] text-off hover:text-err">Delete</button>
        </div>
      ))}
    </div>
  );
};
```

- [ ] **Step 3:** Mount `<UploadedSkillsManager />` in the Sidebar Skills area (below the existing skills list / in the Skills pane). Keep it inside `.mcp-sidebar` for token + reduced-motion coverage.
- [ ] **Step 4:** `pnpm type-check` + `pnpm build` + `pnpm vitest run pages/content/__tests__` (existing skill-disclosure tests must stay green — uploaded skills flow through identically).
- [ ] **Step 5: Commit** — `feat(skills): uploaded-skills manager UI (upload/list/delete) — phase 1`

---

## Task 7: Cross-browser verify

- [ ] **Step 1:** `pnpm build` (Chrome) → load `dist/` unpacked in Chrome. Upload a skill folder; confirm it appears in AVAILABLE SKILLS; invoke it; `skill_read_asset` reads a reference; delete works.
- [ ] **Step 2:** `pnpm build:firefox` → load `dist/manifest.json` in Firefox (`about:debugging`). Repeat the smoke. Confirm the folder picker opens (Firefox supports `webkitdirectory`).
- [ ] **Step 3:** Restart the browser → uploaded skills persist (storage.local + IDB survive).
- [ ] **Step 4:** Upload a folder with a multi-MB text reference → confirms the IDB path past the `localStorage` ceiling.
- [ ] **Step 5:** Existing skill tests (`skill-progressive-disclosure`, `skill-enablement`, `tool-list`, `skill-asset-resolver`) all green — no regression to disk/MCP skills.

---

## Self-Review

**1. Spec coverage:** upload (folder picker) → T1+T5+T6 ✓; persist across sessions + past localStorage → T2 (storage.local + IDB) ✓; merge into disclosure L1/L2/L3 → T3 (cachedSkills) + T4 (skill_read_asset) ✓; full CRUD → T5+T6 ✓; text-only refs → T1 filter ✓; Chrome+Firefox → T7 + webkitdirectory-ref note ✓; TDD → T1+T2 test-first, integration via existing tests ✓. Phase 2 scripts explicitly out (separate spec) ✓.

**2. Placeholder scan:** All code blocks complete. The two `background/index.ts` edits (T3 Step 2, T5) say "read the real block first; match its style" with the exact line anchor (376 / 671) + the precise logic to add — that's a verification gate, not a placeholder.

**3. Type consistency:** `UploadedSkill` (T1) is imported by both the store (T2) and the client (T6); `uploadedSkillToSkill` (T1) used by `loadUploadedSkills` (T3); `uploadedStore` (T2) used by loader (T3), the skill_read_asset branch (T4), and the handler (T5); message types (`uploadedSkill:upload|list|delete|replace`) match between handler (T5) and client (T6). `source: 'uploaded'` consistent everywhere.

**4. Risk:** the fake-IDB in T2's test is hand-rolled; if brittle, swap to `fake-indexeddb` (called out inline). The `background/index.ts` edits touch a large file — T3/T4/T5 each anchor to a specific existing line and add a branch, not restructure.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-06-19-uploaded-skills-phase1.md`. **TDD mandatory** (`/tdd`). Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review, fast iteration. (Matches the sidebar work.)
**2. Inline Execution** — batch in this session with checkpoints.

Which approach?
