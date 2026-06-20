import { describe, it, expect } from 'vitest';
import { parseSkillMarkdown, skillToPseudoTool, skillNameFromToolName } from '../parser';

describe('parseSkillMarkdown - line endings', () => {
  it('parses Unix LF frontmatter', () => {
    const raw = '---\nname: my-skill\ndescription: A skill\n---\n# Body\ncontent';
    const skill = parseSkillMarkdown(raw, 'test');
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('my-skill');
    expect(skill!.description).toBe('A skill');
    expect(skill!.content).toContain('# Body');
  });

  it('parses Windows CRLF frontmatter', () => {
    const raw = '---\r\nname: my-skill\r\ndescription: A skill\r\n---\r\n# Body\r\ncontent';
    const skill = parseSkillMarkdown(raw, 'test');
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('my-skill');
    expect(skill!.description).toBe('A skill');
  });

  it('parses mixed CR/LF line endings', () => {
    const raw = '---\nname: my-skill\r\ndescription: A skill\r\n---\nbody';
    const skill = parseSkillMarkdown(raw, 'test');
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('my-skill');
  });
});

describe('parseSkillMarkdown - closing fence', () => {
  it('parses frontmatter with no trailing newline after closing ---', () => {
    const raw = '---\nname: my-skill\ndescription: A skill\n---';
    const skill = parseSkillMarkdown(raw, 'test');
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('my-skill');
    expect(skill!.description).toBe('A skill');
  });

  it('parses frontmatter ending exactly at closing fence with no body', () => {
    const raw = '---\nname: solo\ndescription: d\n---';
    const skill = parseSkillMarkdown(raw, 'test');
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('solo');
  });
});

describe('parseSkillMarkdown - folded YAML description', () => {
  it('captures continuation lines for description: >', () => {
    const raw = '---\nname: my-skill\ndescription: >\n  First line of description.\n  Second line.\n---\nbody';
    const skill = parseSkillMarkdown(raw, 'test');
    expect(skill).not.toBeNull();
    expect(skill!.description).toContain('First line');
    expect(skill!.description).toContain('Second line');
  });

  it('captures continuation lines for description: >- (strip indicator)', () => {
    const raw = '---\nname: my-skill\ndescription: >-\n  Folded content here.\n---\nbody';
    const skill = parseSkillMarkdown(raw, 'test');
    expect(skill).not.toBeNull();
    expect(skill!.description).toContain('Folded content');
  });
});

describe('skill name <-> tool name round-trip', () => {
  it('skillToPseudoTool preserves original name even with underscores', () => {
    const skill = { name: 'foo_bar', description: 'd', content: 'c', source: 's' };
    const tool = skillToPseudoTool(skill as any);
    // injective encoding: '_' -> '__' so it can't collide with a 'foo-bar' skill
    expect(tool.name).toBe('skill_foo__bar');
    expect((tool as any)._skillName).toBe('foo_bar');
  });

  it('skillNameFromToolName recovers exact original underscored name', () => {
    const skill = { name: 'foo_bar', description: 'd', content: 'c', source: 's' };
    const tool = skillToPseudoTool(skill as any);
    expect(skillNameFromToolName(tool)).toBe('foo_bar');
  });

  it('skillNameFromToolName falls back to hyphen decode when _skillName absent', () => {
    // a bare tool object without the _skillName field (legacy/compat).
    // tool names are encoded (hyphens->single underscore), so 'find_docs' decodes to 'find-docs'.
    expect(skillNameFromToolName({ name: 'skill_find_docs' } as any)).toBe('find-docs');
  });

  it('two skills differing only by _ vs - do not collide on tool name', () => {
    const a = skillToPseudoTool({ name: 'foo-bar', description: '', content: '', source: '' } as any);
    const b = skillToPseudoTool({ name: 'foo_bar', description: '', content: '', source: '' } as any);
    expect(a.name).not.toBe(b.name);
  });
});

describe('parseSkillMarkdown - run frontmatter (Phase 2)', () => {
  it('extracts run: pointing at a .wasm script', () => {
    const raw = '---\nname: scorer\ndescription: d\nrun: scripts/score.wasm\n---\nbody';
    const skill = parseSkillMarkdown(raw, 'test');
    expect(skill).not.toBeNull();
    expect(skill!.run).toBe('scripts/score.wasm');
  });

  it('extracts run: pointing at a .py script', () => {
    const raw = '---\nname: analyzer\ndescription: d\nrun: scripts/analyze.py\n---\nbody';
    const skill = parseSkillMarkdown(raw, 'test');
    expect(skill).not.toBeNull();
    expect(skill!.run).toBe('scripts/analyze.py');
  });

  it('leaves run undefined when frontmatter has no run field', () => {
    const raw = '---\nname: plain\ndescription: d\n---\nbody';
    const skill = parseSkillMarkdown(raw, 'test');
    expect(skill).not.toBeNull();
    expect(skill!.run).toBeUndefined();
  });

  it('does not absorb run value into description', () => {
    const raw = '---\nname: x\ndescription: the desc\nrun: scripts/x.py\n---\nbody';
    const skill = parseSkillMarkdown(raw, 'test');
    expect(skill!.description).toBe('the desc');
    expect(skill!.run).toBe('scripts/x.py');
  });
});
