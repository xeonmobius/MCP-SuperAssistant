import { describe, it, expect, beforeEach, vi } from 'vitest';

const storage: Record<string, any> = {};

beforeEach(() => {
  Object.keys(storage).forEach(k => delete storage[k]);
});

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn((keys: string | string[]) => {
        const keyArr = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, any> = {};
        for (const k of keyArr) {
          if (k in storage) result[k] = storage[k];
        }
        return Promise.resolve(result);
      }),
      set: vi.fn((items: Record<string, any>) => {
        Object.assign(storage, items);
        return Promise.resolve();
      }),
    },
  },
});

const SKILL_ENABLEMENT_KEY = 'mcp_skill_enablement';

interface SkillItem {
  name: string;
  description: string;
}

interface SkillState {
  availableSkills: SkillItem[];
  enabledSkills: Set<string>;
  isLoadingEnablement: boolean;
  setAvailableSkills: (skills: SkillItem[]) => void;
  enableSkill: (name: string) => void;
  disableSkill: (name: string) => void;
  enableAllSkills: () => void;
  disableAllSkills: () => void;
  isSkillEnabled: (name: string) => boolean;
  loadSkillEnablementState: () => Promise<void>;
}

function createSkillStore(): SkillState {
  let state: SkillState = {
    availableSkills: [],
    enabledSkills: new Set(),
    isLoadingEnablement: false,
    setAvailableSkills: (skills: SkillItem[]) => {
      state = { ...state, availableSkills: skills };
      state.loadSkillEnablementState();
    },
    enableSkill: (name: string) => {
      const newSet = new Set([...state.enabledSkills, name]);
      state = { ...state, enabledSkills: newSet };
      chrome.storage.local.set({ [SKILL_ENABLEMENT_KEY]: Array.from(newSet) });
    },
    disableSkill: (name: string) => {
      const newSet = new Set(state.enabledSkills);
      newSet.delete(name);
      state = { ...state, enabledSkills: newSet };
      chrome.storage.local.set({ [SKILL_ENABLEMENT_KEY]: Array.from(newSet) });
    },
    enableAllSkills: () => {
      const newSet = new Set(state.availableSkills.map(s => s.name));
      state = { ...state, enabledSkills: newSet };
      chrome.storage.local.set({ [SKILL_ENABLEMENT_KEY]: Array.from(newSet) });
    },
    disableAllSkills: () => {
      state = { ...state, enabledSkills: new Set() };
      chrome.storage.local.set({ [SKILL_ENABLEMENT_KEY]: [] });
    },
    isSkillEnabled: (name: string) => state.enabledSkills.has(name),
    loadSkillEnablementState: async () => {
      state = { ...state, isLoadingEnablement: true };
      try {
        const result = await chrome.storage.local.get(SKILL_ENABLEMENT_KEY);
        const stored = result[SKILL_ENABLEMENT_KEY] as string[] | undefined;
        if (!stored || stored.length === 0) {
          const allEnabled = new Set(state.availableSkills.map(s => s.name));
          state = { ...state, enabledSkills: allEnabled, isLoadingEnablement: false };
          await chrome.storage.local.set({ [SKILL_ENABLEMENT_KEY]: Array.from(allEnabled) });
        } else {
          state = { ...state, enabledSkills: new Set(stored), isLoadingEnablement: false };
        }
      } catch {
        state = { ...state, isLoadingEnablement: false };
      }
    },
  };
  return state;
}

describe('Skill Store', () => {
  it('enables all skills by default when no stored state', async () => {
    const store = createSkillStore();
    store.setAvailableSkills([
      { name: 'brainstorming', description: 'desc1' },
      { name: 'find-docs', description: 'desc2' },
    ]);
    await store.loadSkillEnablementState();
    expect(store.isSkillEnabled('brainstorming')).toBe(true);
    expect(store.isSkillEnabled('find-docs')).toBe(true);
  });

  it('respects stored enablement state', async () => {
    await chrome.storage.local.set({ [SKILL_ENABLEMENT_KEY]: ['find-docs'] });
    const store = createSkillStore();
    store.setAvailableSkills([
      { name: 'brainstorming', description: 'desc1' },
      { name: 'find-docs', description: 'desc2' },
    ]);
    await store.loadSkillEnablementState();
    expect(store.isSkillEnabled('brainstorming')).toBe(false);
    expect(store.isSkillEnabled('find-docs')).toBe(true);
  });

  it('enables a disabled skill', async () => {
    const store = createSkillStore();
    store.setAvailableSkills([{ name: 'test', description: 'desc' }]);
    await store.loadSkillEnablementState();
    store.disableSkill('test');
    expect(store.isSkillEnabled('test')).toBe(false);
    store.enableSkill('test');
    expect(store.isSkillEnabled('test')).toBe(true);
  });

  it('disables an enabled skill', async () => {
    const store = createSkillStore();
    store.setAvailableSkills([{ name: 'test', description: 'desc' }]);
    await store.loadSkillEnablementState();
    expect(store.isSkillEnabled('test')).toBe(true);
    store.disableSkill('test');
    expect(store.isSkillEnabled('test')).toBe(false);
  });

  it('enableAllSkills enables everything', async () => {
    const store = createSkillStore();
    store.setAvailableSkills([
      { name: 'a', description: 'a' },
      { name: 'b', description: 'b' },
    ]);
    await store.loadSkillEnablementState();
    store.disableAllSkills();
    expect(store.isSkillEnabled('a')).toBe(false);
    store.enableAllSkills();
    expect(store.isSkillEnabled('a')).toBe(true);
    expect(store.isSkillEnabled('b')).toBe(true);
  });

  it('disableAllSkills disables everything', async () => {
    const store = createSkillStore();
    store.setAvailableSkills([
      { name: 'a', description: 'a' },
      { name: 'b', description: 'b' },
    ]);
    await store.loadSkillEnablementState();
    store.disableAllSkills();
    expect(store.isSkillEnabled('a')).toBe(false);
    expect(store.isSkillEnabled('b')).toBe(false);
  });

  it('persists enablement to storage', async () => {
    const store = createSkillStore();
    store.setAvailableSkills([{ name: 'test', description: 'desc' }]);
    await store.loadSkillEnablementState();
    store.disableSkill('test');
    const result = await chrome.storage.local.get(SKILL_ENABLEMENT_KEY);
    expect(result[SKILL_ENABLEMENT_KEY]).toEqual([]);
  });

  it('returns false for unknown skill', () => {
    const store = createSkillStore();
    expect(store.isSkillEnabled('nonexistent')).toBe(false);
  });
});
