import { describe, it, expect } from 'vitest';
import { parseAllowedDirectories, isPathWithinAllowed, listAllFiles } from '../loader';

describe('parseAllowedDirectories', () => {
  it('strips the "Allowed directories:" header line the MCP filesystem server emits', () => {
    const text = 'Allowed directories:\n/Users/x/.agents/skills\n/Users/x/.claude/skills';
    expect(parseAllowedDirectories(text)).toEqual([
      '/Users/x/.agents/skills',
      '/Users/x/.claude/skills',
    ]);
  });

  it('drops blank and non-path lines', () => {
    const text = 'Allowed directories:\n\n  /Users/x/a\nnot-a-path\n/Users/x/b';
    expect(parseAllowedDirectories(text)).toEqual(['/Users/x/a', '/Users/x/b']);
  });

  it('keeps ~-prefixed entries', () => {
    expect(parseAllowedDirectories('~/.agents/skills\n~/projects')).toEqual([
      '~/.agents/skills',
      '~/projects',
    ]);
  });

  it('returns [] for null/empty input', () => {
    expect(parseAllowedDirectories(null as any)).toEqual([]);
    expect(parseAllowedDirectories('')).toEqual([]);
  });
});

describe('isPathWithinAllowed', () => {
  const allowed = ['/Users/x/.agents/skills', '/Users/x/projects'];

  it('accepts an exact match', () => {
    expect(isPathWithinAllowed('/Users/x/.agents/skills', allowed)).toBe(true);
  });

  it('accepts a nested path', () => {
    expect(isPathWithinAllowed('/Users/x/.agents/skills/find-docs', allowed)).toBe(true);
    expect(isPathWithinAllowed('/Users/x/projects/a/b/c', allowed)).toBe(true);
  });

  it('rejects a sibling that merely shares a string prefix (boundary bug)', () => {
    // /Users/x/.agents-sibling must NOT match /Users/x/.agents
    expect(isPathWithinAllowed('/Users/x/.agents-sibling/evil', ['/Users/x/.agents'])).toBe(false);
    // /Users/shannon must NOT match allowed dir /Users/sha
    expect(isPathWithinAllowed('/Users/shannon/secrets', ['/Users/sha'])).toBe(false);
  });

  it('expands ~ in allowed dirs when homeDir provided', () => {
    expect(isPathWithinAllowed('/Users/x/.agents/skills', ['~/.agents/skills'], '/Users/x')).toBe(true);
  });

  it('rejects completely unrelated paths', () => {
    expect(isPathWithinAllowed('/etc/passwd', allowed)).toBe(false);
  });
});

describe('listAllFiles depth cap', () => {
  it('stops recursing at maxDepth even with a cyclic/deep structure', async () => {
    // callTool returns one [DIR] sub for every list_directory call -> would loop forever without a cap
    let calls = 0;
    const callTool = async (_url: string, _tool: string, _args: Record<string, unknown>) => {
      calls++;
      return { content: [{ type: 'text', text: '[DIR] sub' }] };
    };

    const files = await listAllFiles('http://x', callTool as any, '/root', 'SKILL.md', '', 3);
    // bounded: should not spiral to thousands of calls
    expect(calls).toBeLessThanOrEqual(5);
    expect(files.length).toBeLessThanOrEqual(3);
  });

  it('collects files at the top level', async () => {
    const callTool = async (_url: string, _tool: string, args: Record<string, unknown>) => {
      if ((args as any).path === '/root') {
        return { content: [{ type: 'text', text: '[FILE] a.md\n[FILE] SKILL.md\n[FILE] b.txt' }] };
      }
      return { content: [{ type: 'text', text: '' }] };
    };
    const files = await listAllFiles('http://x', callTool as any, '/root', 'SKILL.md');
    // excludes SKILL.md, keeps the other two
    expect(files).toEqual(expect.arrayContaining(['a.md', 'b.txt']));
    expect(files).not.toContain('SKILL.md');
  });
});
