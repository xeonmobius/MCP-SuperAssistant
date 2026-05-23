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

const DEFAULT_SKILLS_PATHS = [
  '~/.agents/skills',
  '~/.claude/skills',
];

async function getSkillsPaths(): Promise<string[]> {
  try {
    const result = await chrome.storage.local.get('mcp_skills_paths');
    return (result.mcp_skills_paths as string[]) || DEFAULT_SKILLS_PATHS;
  } catch {
    return DEFAULT_SKILLS_PATHS;
  }
}

async function setSkillsPaths(paths: string[]): Promise<void> {
  await chrome.storage.local.set({ mcp_skills_paths: paths });
}

describe('Skills paths storage', () => {
  it('returns defaults when nothing stored', async () => {
    const paths = await getSkillsPaths();
    expect(paths).toEqual(DEFAULT_SKILLS_PATHS);
  });

  it('returns stored paths after saving', async () => {
    const custom = ['/custom/path1', '/custom/path2'];
    await setSkillsPaths(custom);
    const paths = await getSkillsPaths();
    expect(paths).toEqual(custom);
  });

  it('persists across multiple reads', async () => {
    await setSkillsPaths(['/persisted']);
    await getSkillsPaths();
    const paths = await getSkillsPaths();
    expect(paths).toEqual(['/persisted']);
  });

  it('returns defaults on storage error', async () => {
    (chrome.storage.local.get as any).mockRejectedValueOnce(new Error('storage error'));
    const paths = await getSkillsPaths();
    expect(paths).toEqual(DEFAULT_SKILLS_PATHS);
  });
});
