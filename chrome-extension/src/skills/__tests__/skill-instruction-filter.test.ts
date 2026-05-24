import { describe, it, expect } from 'vitest';

describe('Skill instruction filter', () => {
  it('includes skill_* tools when enabled in skill store', () => {
    const tools = [
      { name: 'read_file', schema: '{}', description: 'Read a file' },
      { name: 'skill_brainstorming', schema: '{"type":"object","properties":{"query":{"type":"string"}}}', description: 'Brainstorm ideas' },
      { name: 'skill_find_docs', schema: '{"type":"object","properties":{"query":{"type":"string"}}}', description: 'Find docs' },
    ];

    const toolEnabledSet = new Set(['read_file']);
    const skillEnabledSet = new Set(['brainstorming']);

    const isToolEnabled = (name: string) => toolEnabledSet.has(name);
    const isSkillEnabled = (toolName: string) => {
      const skillName = toolName.replace(/^skill_/, '').replace(/_/g, '-');
      return skillEnabledSet.has(skillName);
    };

    const enabledTools = tools.filter(tool => {
      if (tool.name.startsWith('skill_')) {
        return isSkillEnabled(tool.name);
      }
      return isToolEnabled(tool.name);
    });

    expect(enabledTools.map(t => t.name)).toEqual(['read_file', 'skill_brainstorming']);
  });

  it('excludes skill_* tools when disabled in skill store', () => {
    const tools = [
      { name: 'read_file', schema: '{}', description: 'Read a file' },
      { name: 'skill_brainstorming', schema: '{}', description: 'Brainstorm' },
    ];

    const toolEnabledSet = new Set(['read_file']);
    const skillEnabledSet = new Set<string>();

    const isToolEnabled = (name: string) => toolEnabledSet.has(name);
    const isSkillEnabled = (toolName: string) => {
      const skillName = toolName.replace(/^skill_/, '').replace(/_/g, '-');
      return skillEnabledSet.has(skillName);
    };

    const enabledTools = tools.filter(tool => {
      if (tool.name.startsWith('skill_')) {
        return isSkillEnabled(tool.name);
      }
      return isToolEnabled(tool.name);
    });

    expect(enabledTools.map(t => t.name)).toEqual(['read_file']);
  });

  it('handles skill names with hyphens converted to underscores', () => {
    const tools = [
      { name: 'skill_find_docs', schema: '{}', description: 'Find docs' },
      { name: 'skill_caveman_commit', schema: '{}', description: 'Commit' },
    ];

    const skillEnabledSet = new Set(['find-docs', 'caveman-commit']);

    const isSkillEnabled = (toolName: string) => {
      const skillName = toolName.replace(/^skill_/, '').replace(/_/g, '-');
      return skillEnabledSet.has(skillName);
    };

    const enabledTools = tools.filter(tool => tool.name.startsWith('skill_') && isSkillEnabled(tool.name));

    expect(enabledTools.map(t => t.name)).toEqual(['skill_find_docs', 'skill_caveman_commit']);
  });

  it('shows no tools when all are disabled', () => {
    const tools = [
      { name: 'read_file', schema: '{}', description: 'Read' },
      { name: 'skill_brainstorming', schema: '{}', description: 'Brainstorm' },
    ];

    const toolEnabledSet = new Set<string>();
    const skillEnabledSet = new Set<string>();

    const isToolEnabled = (name: string) => toolEnabledSet.has(name);
    const isSkillEnabled = (toolName: string) => {
      const skillName = toolName.replace(/^skill_/, '').replace(/_/g, '-');
      return skillEnabledSet.has(skillName);
    };

    const enabledTools = tools.filter(tool => {
      if (tool.name.startsWith('skill_')) {
        return isSkillEnabled(tool.name);
      }
      return isToolEnabled(tool.name);
    });

    expect(enabledTools).toEqual([]);
  });

  it('current behavior: isToolEnabled alone fails for skill_* tools', () => {
    const tools = [
      { name: 'read_file', schema: '{}', description: 'Read' },
      { name: 'skill_brainstorming', schema: '{}', description: 'Brainstorm' },
    ];

    const toolEnabledSet = new Set(['read_file']);

    const isToolEnabled = (name: string) => toolEnabledSet.has(name);

    const buggyEnabledTools = tools.filter(tool => isToolEnabled(tool.name));

    expect(buggyEnabledTools.map(t => t.name)).not.toContain('skill_brainstorming');
  });
});
