import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- in-memory chrome.storage.local mock (snapshot taken at call time) ---
const storage: Record<string, any> = {};
let storageShouldThrow = false;

beforeEach(() => {
  Object.keys(storage).forEach(k => delete storage[k]);
  storageShouldThrow = false;
});

vi.stubGlobal('chrome', {
  storage: {
    local: {
      // Snapshot the value synchronously at CALL time so a write that happens
      // while the read promise is in flight still resolves to the STALE value
      // (mirrors real async storage I/O and lets us test the load/toggle race).
      get: vi.fn((keys: string | string[]) => {
        if (storageShouldThrow) return Promise.reject(new Error('storage unavailable'));
        const arr = Array.isArray(keys) ? keys : [keys];
        const snapshot: Record<string, any> = {};
        for (const k of arr) if (k in storage) snapshot[k] = storage[k];
        return Promise.resolve(snapshot);
      }),
      set: vi.fn((items: Record<string, any>) => {
        Object.assign(storage, items);
        return Promise.resolve();
      }),
      remove: vi.fn((keys: string | string[]) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        arr.forEach(k => delete storage[k]);
        return Promise.resolve();
      }),
    },
  },
  runtime: { id: 'test' },
});

import { useSkillStore } from '../src/stores/skill.store';

function resetStore(skills: { name: string; description: string }[] = []) {
  useSkillStore.setState({
    availableSkills: skills,
    enabledSkills: new Set<string>(),
    isLoadingEnablement: false,
    loadGeneration: 0,
  } as any);
}

describe('useSkillStore enablement persistence', () => {
  it('"all disabled" survives a reload (empty set is NOT treated as never-saved)', async () => {
    resetStore([{ name: 'a', description: '' }, { name: 'b', description: '' }]);
    useSkillStore.getState().disableAllSkills(); // persists []
    await useSkillStore.getState().loadSkillEnablementState();
    expect(useSkillStore.getState().enabledSkills.size).toBe(0);
  });

  it('never-saved state defaults to all enabled', async () => {
    resetStore([{ name: 'a', description: '' }, { name: 'b', description: '' }]);
    await useSkillStore.getState().loadSkillEnablementState();
    const s = useSkillStore.getState().enabledSkills;
    expect(s.has('a')).toBe(true);
    expect(s.has('b')).toBe(true);
  });

  it('a previously saved explicit set is honored (not defaulted)', async () => {
    resetStore([{ name: 'a', description: '' }, { name: 'b', description: '' }]);
    storage['mcp_skill_enablement'] = ['a']; // only 'a' enabled
    await useSkillStore.getState().loadSkillEnablementState();
    const s = useSkillStore.getState().enabledSkills;
    expect(s.has('a')).toBe(true);
    expect(s.has('b')).toBe(false);
  });

  it('storage error does NOT default-on (keeps current disabled state)', async () => {
    resetStore([{ name: 'a', description: '' }, { name: 'b', description: '' }]);
    useSkillStore.getState().disableAllSkills();
    storageShouldThrow = true;
    await useSkillStore.getState().loadSkillEnablementState();
    expect(useSkillStore.getState().enabledSkills.size).toBe(0);
  });

  it('a toggle made during an in-flight load is not clobbered by stale stored data', async () => {
    resetStore([{ name: 'a', description: '' }, { name: 'b', description: '' }]);
    storage['mcp_skill_enablement'] = ['a', 'b']; // both enabled on disk
    const loadPromise = useSkillStore.getState().loadSkillEnablementState();
    // flip 'a' off while the storage read is still in flight
    useSkillStore.getState().disableSkill('a');
    await loadPromise;
    expect(useSkillStore.getState().enabledSkills.has('a')).toBe(false);
  });
});
