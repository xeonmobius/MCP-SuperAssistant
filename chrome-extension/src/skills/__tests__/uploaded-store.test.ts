import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createUploadedStore, type StoreDeps } from '../uploaded-store';
import type { UploadedSkill } from '../uploaded-parser';

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
