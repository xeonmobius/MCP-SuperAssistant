import { describe, it, expect, beforeAll } from 'vitest';
import { generateInstructionsJson } from '../src/components/sidebar/Instructions/instructionGeneratorJson';

beforeAll(() => {
  globalThis.window = { location: { hostname: 'chatgpt.com' } } as any;
});

describe('Skill progressive disclosure in instructions', () => {
  const baseTool = { name: 'read_file', schema: '{"type":"object","properties":{"path":{"type":"string","description":"File path"}},"required":["path"]}', description: 'Read a file from disk' };

  it('includes AVAILABLE SKILLS section when skills are provided', () => {
    const skills = [
      { name: 'skill_brainstorming', schema: '{}', description: 'You MUST use this before any creative work. Explores user intent, requirements and design before implementation.' },
      { name: 'skill_caveman', schema: '{}', description: 'Use when user says "caveman mode", "talk like caveman", or "less tokens".' },
    ];

    const result = generateInstructionsJson([baseTool, ...skills], '', false, skills);

    expect(result).toContain('## AVAILABLE SKILLS');
    expect(result).toContain('skill_brainstorming');
    expect(result).toContain('skill_caveman');
    expect(result).toContain('Invoke the skill tool to load its full instructions');
  });

  it('separates skills from tools in the output', () => {
    const skills = [
      { name: 'skill_brainstorming', schema: '{}', description: 'Brainstorm ideas before building.' },
    ];

    const result = generateInstructionsJson([baseTool, ...skills], '', false, skills);

    const toolsIdx = result.indexOf('## AVAILABLE TOOLS');
    const skillsIdx = result.indexOf('## AVAILABLE SKILLS');

    expect(toolsIdx).toBeGreaterThan(-1);
    expect(skillsIdx).toBeGreaterThan(-1);
    expect(toolsIdx).toBeLessThan(skillsIdx);
  });

  it('shows skill description with trigger guidance', () => {
    const skills = [
      { name: 'skill_caveman', schema: '{}', description: 'Use when user says "caveman mode", "talk like caveman", or "less tokens".' },
    ];

    const result = generateInstructionsJson([baseTool, ...skills], '', false, skills);

    expect(result).toContain('caveman mode');
    expect(result).toContain('talk like caveman');
  });

  it('omits AVAILABLE SKILLS section when no skills provided', () => {
    const result = generateInstructionsJson([baseTool], '', false, []);

    expect(result).not.toContain('## AVAILABLE SKILLS');
    expect(result).toContain('## AVAILABLE TOOLS');
  });

  it('skills do not appear in AVAILABLE TOOLS section', () => {
    const skills = [
      { name: 'skill_brainstorming', schema: '{}', description: 'Brainstorm ideas.' },
    ];

    const result = generateInstructionsJson([baseTool, ...skills], '', false, skills);

    const toolsSection = result.substring(
      result.indexOf('## AVAILABLE TOOLS'),
      result.indexOf('## AVAILABLE SKILLS') > -1 ? result.indexOf('## AVAILABLE SKILLS') : result.length
    );

    expect(toolsSection).toContain('read_file');
    expect(toolsSection).not.toContain('skill_brainstorming');
  });
});
