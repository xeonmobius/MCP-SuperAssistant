import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createUploadedStore, type StoreDeps } from '../uploaded-store';
import type { UploadedSkill, ScriptBlob } from '../uploaded-parser';

// fake-indexeddb/auto registers a global `indexedDB` (and IDBKeyRange, etc.)
// We pass that global as the injected idbFactory — no hand-rolled mock needed.

const storageMap: Record<string, any> = {};
const storage = {
  get: vi.fn(async (k: string) => ({ [k]: storageMap[k] })),
  set: vi.fn(async (items: Record<string, any>) => {
    Object.assign(storageMap, items);
  }),
};
const deps: StoreDeps = { storage: storage as any, idbFactory: indexedDB };

const skill = (name: string): UploadedSkill => ({
  name,
  description: 'd',
  content: 'c',
  source: 'uploaded',
  uploadedAt: 1,
  references: ['a.md'],
});

beforeEach(() => {
  Object.keys(storageMap).forEach(k => delete storageMap[k]);
});

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

describe('uploaded-store scripts store (Phase 2)', () => {
  const wasmBytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d]).buffer;
  const wasmBlob: ScriptBlob = { path: 'scripts/s.wasm', blob: wasmBytes, language: 'wasm' };

  it('saveScript + readScript roundtrip the blob + language', async () => {
    const store = createUploadedStore(deps);
    await store.saveScript('s1', 'scripts/s.wasm', wasmBytes, 'wasm');
    const got = await store.readScript('s1', 'scripts/s.wasm');
    expect(got).toBeDefined();
    expect(got?.language).toBe('wasm');
    // IDB structured-clones the ArrayBuffer → compare bytes, not identity.
    expect(Array.from(new Uint8Array(got!.blob))).toEqual([0x00, 0x61, 0x73, 0x6d]);
    expect(got?.size).toBe(4);
  });

  it('readScript returns undefined for a missing script', async () => {
    const store = createUploadedStore(deps);
    expect(await store.readScript('s1', 'nope.wasm')).toBeUndefined();
  });

  it('saveUploadedSkill persists an optional scriptBlob', async () => {
    const store = createUploadedStore(deps);
    await store.saveUploadedSkill(skill('s1'), new Map(), wasmBlob);
    const got = await store.readScript('s1', 'scripts/s.wasm');
    expect(got?.language).toBe('wasm');
    expect(Array.from(new Uint8Array(got!.blob))).toEqual([0x00, 0x61, 0x73, 0x6d]);
  });

  it('deleteUploadedSkill cascades into the scripts store', async () => {
    const store = createUploadedStore(deps);
    await store.saveUploadedSkill(skill('s1'), new Map(), wasmBlob);
    expect(await store.readScript('s1', 'scripts/s.wasm')).toBeDefined();
    await store.deleteUploadedSkill('s1');
    expect(await store.readScript('s1', 'scripts/s.wasm')).toBeUndefined();
  });

  it('deleteScripts removes only the named skill\u2019s scripts', async () => {
    const store = createUploadedStore(deps);
    await store.saveScript('a', 'x.wasm', wasmBytes, 'wasm');
    await store.saveScript('b', 'x.wasm', wasmBytes, 'wasm');
    await store.deleteScripts('a');
    expect(await store.readScript('a', 'x.wasm')).toBeUndefined();
    expect(await store.readScript('b', 'x.wasm')).toBeDefined();
  });

  it('re-saving a skill without a scriptBlob clears the old script', async () => {
    const store = createUploadedStore(deps);
    await store.saveUploadedSkill(skill('s1'), new Map(), wasmBlob);
    await store.saveUploadedSkill(skill('s1'), new Map()); // no script this time
    expect(await store.readScript('s1', 'scripts/s.wasm')).toBeUndefined();
  });
});
