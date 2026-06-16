import { describe, it, expect } from 'vitest';
import { buildCombinedToolList, buildEnabledSkillTools } from '../src/utils/toolList';

const baseTool = (name: string) => ({ name, description: `${name} desc`, input_schema: { type: 'object' }, schema: '{"type":"object"}' });

describe('buildCombinedToolList', () => {
  it('includes only enabled tools and enabled skills', () => {
    const tools = [baseTool('read_file'), baseTool('write_file')];
    const isToolEnabled = (n: string) => n === 'read_file'; // write_file disabled
    const skills = [{ name: 'find-docs', description: 'find docs' }, { name: 'caveman', description: 'caveman' }];
    const enabledSkills = new Set(['find-docs']); // caveman disabled

    const out = buildCombinedToolList(tools as any, isToolEnabled, skills as any, enabledSkills);

    const names = out.map(t => t.name);
    expect(names).toContain('read_file');
    expect(names).not.toContain('write_file');
    expect(names).toContain('skill_find_docs');
    expect(names).not.toContain('skill_caveman');
  });

  it('adds the skill_read_asset tool when at least one skill is enabled', () => {
    const out = buildCombinedToolList([], () => true, [{ name: 'find-docs', description: 'd' }], new Set(['find-docs']));
    expect(out.map(t => t.name)).toContain('skill_read_asset');
  });

  it('omits skill_read_asset when no skills are enabled', () => {
    const out = buildCombinedToolList([baseTool('read_file')], () => true, [{ name: 'find-docs', description: 'd' }], new Set());
    const names = out.map(t => t.name);
    expect(names).not.toContain('skill_read_asset');
    expect(names).not.toContain('skill_find_docs');
    expect(names).toContain('read_file');
  });

  it('reacts to the enabled set: disabling a skill drops it from the output', () => {
    const skills = [{ name: 'find-docs', description: 'd' }];
    const withEnabled = buildCombinedToolList([], () => true, skills as any, new Set(['find-docs']));
    expect(withEnabled.map(t => t.name)).toContain('skill_find_docs');

    const withDisabled = buildCombinedToolList([], () => true, skills as any, new Set());
    expect(withDisabled.map(t => t.name)).not.toContain('skill_find_docs');
  });
});

describe('buildEnabledSkillTools', () => {
  // The InstructionManager uses this to populate the AVAILABLE SKILLS section of
  // the MCP instructions prompt. It MUST source from the skill store (not the
  // tool store, which no longer holds skill_* pseudo-tools).
  it('includes only enabled skills, encoded as skill_ tools', () => {
    const available = [{ name: 'find-docs', description: 'find docs' }, { name: 'caveman', description: 'caveman' }];
    const enabled = new Set(['find-docs']);
    const out = buildEnabledSkillTools(available, enabled);
    expect(out.map(s => s.name)).toEqual(['skill_find_docs']);
    expect(out[0].description).toBe('find docs');
  });

  it('returns [] when nothing is enabled', () => {
    const out = buildEnabledSkillTools([{ name: 'find-docs', description: 'd' }], new Set());
    expect(out).toEqual([]);
  });

  it('omits skills not in the available list even if "enabled"', () => {
    const out = buildEnabledSkillTools([{ name: 'find-docs', description: 'd' }], new Set(['ghost']));
    expect(out).toEqual([]);
  });

  it('tool name matches the background call-tool matcher for underscored skill names', () => {
    // Background routes via `skill_${encodeSkillName(s.name)} === toolName`,
    // where encodeSkillName escapes '_' -> '__' then '-' -> '_'. The helper MUST
    // emit the same encoding or invocation fails for any name containing '_'.
    const underscored = [{ name: 'foo_bar', description: 'd' }];
    const fromCombined = buildCombinedToolList([], () => true, underscored as any, new Set(['foo_bar']))[0].name;
    const fromEnabled = buildEnabledSkillTools(underscored, new Set(['foo_bar']))[0].name;
    expect(fromCombined).toBe('skill_foo__bar');
    expect(fromEnabled).toBe('skill_foo__bar');

    // common kebab-case stays the single-underscore form
    const hyphen = buildEnabledSkillTools([{ name: 'find-docs', description: 'd' }], new Set(['find-docs']))[0].name;
    expect(hyphen).toBe('skill_find_docs');
  });
});
