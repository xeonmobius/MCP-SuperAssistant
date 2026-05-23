import { describe, it, expect } from 'vitest';

type SkillsPathsState = {
  skillsPaths: string[];
  skillsPathsInput: string;
  isEditingSkillsPaths: boolean;
  configFetched: boolean;
};

const DEFAULT_PATHS = ['~/.agents/skills', '~/.claude/skills'];

function onSkillsPathsLoaded(state: SkillsPathsState, loadedPaths: string[]): SkillsPathsState {
  if (state.isEditingSkillsPaths) return state;
  if (state.configFetched) return state;
  return {
    ...state,
    skillsPaths: loadedPaths,
    skillsPathsInput: loadedPaths.join('\n'),
    configFetched: true,
  };
}

function onSkillsPathsInputChange(state: SkillsPathsState, value: string): SkillsPathsState {
  return {
    ...state,
    skillsPathsInput: value,
    isEditingSkillsPaths: true,
  };
}

function onSaveSkillsPaths(state: SkillsPathsState): SkillsPathsState {
  const paths = state.skillsPathsInput.split('\n').map(p => p.trim()).filter(Boolean);
  return {
    ...state,
    skillsPaths: paths,
    isEditingSkillsPaths: false,
    configFetched: true,
  };
}

function onCancelSettings(state: SkillsPathsState): SkillsPathsState {
  return {
    ...state,
    skillsPathsInput: state.skillsPaths.join('\n'),
    isEditingSkillsPaths: false,
  };
}

describe('Skills paths UI state machine', () => {
  const initialState: SkillsPathsState = {
    skillsPaths: [],
    skillsPathsInput: '',
    isEditingSkillsPaths: false,
    configFetched: false,
  };

  it('initial load populates textarea from storage', () => {
    const result = onSkillsPathsLoaded(initialState, DEFAULT_PATHS);
    expect(result.skillsPathsInput).toBe('~/.agents/skills\n~/.claude/skills');
    expect(result.skillsPaths).toEqual(DEFAULT_PATHS);
  });

  it('initial load does NOT overwrite when user is editing', () => {
    const editing = { ...initialState, isEditingSkillsPaths: true, skillsPathsInput: 'my custom path' };
    const result = onSkillsPathsLoaded(editing, DEFAULT_PATHS);
    expect(result.skillsPathsInput).toBe('my custom path');
  });

  it('typing in textarea sets editing flag', () => {
    const loaded = onSkillsPathsLoaded(initialState, DEFAULT_PATHS);
    const result = onSkillsPathsInputChange(loaded, '/new/path');
    expect(result.isEditingSkillsPaths).toBe(true);
    expect(result.skillsPathsInput).toBe('/new/path');
  });

  it('subsequent loads do NOT overwrite after initial fetch', () => {
    const loaded = onSkillsPathsLoaded(initialState, DEFAULT_PATHS);
    const result = onSkillsPathsLoaded(loaded, ['/different']);
    expect(result.skillsPathsInput).toBe('~/.agents/skills\n~/.claude/skills');
  });

  it('save persists and clears editing flag', () => {
    const loaded = onSkillsPathsLoaded(initialState, DEFAULT_PATHS);
    const editing = onSkillsPathsInputChange(loaded, '/saved/path1\n/saved/path2');
    const saved = onSaveSkillsPaths(editing);
    expect(saved.skillsPaths).toEqual(['/saved/path1', '/saved/path2']);
    expect(saved.isEditingSkillsPaths).toBe(false);
  });

  it('cancel resets textarea to last saved value', () => {
    const loaded = onSkillsPathsLoaded(initialState, DEFAULT_PATHS);
    const editing = onSkillsPathsInputChange(loaded, '/typed/something');
    const cancelled = onCancelSettings(editing);
    expect(cancelled.skillsPathsInput).toBe('~/.agents/skills\n~/.claude/skills');
    expect(cancelled.isEditingSkillsPaths).toBe(false);
  });

  it('full flow: load -> edit -> save -> re-render does not overwrite', () => {
    let state = initialState;
    state = onSkillsPathsLoaded(state, DEFAULT_PATHS);
    state = onSkillsPathsInputChange(state, '/my/skills');
    state = onSaveSkillsPaths(state);
    const reRendered = onSkillsPathsLoaded(state, DEFAULT_PATHS);
    expect(reRendered.skillsPathsInput).toBe('/my/skills');
  });
});
