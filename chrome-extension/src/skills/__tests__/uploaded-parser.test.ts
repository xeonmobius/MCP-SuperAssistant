import { describe, it, expect } from 'vitest';
import { parseUploadedFolder, parseUploadedFiles } from '../uploaded-parser';

const file = (path: string, text: string): File =>
  new File([text], path.split('/').pop() || path, { type: 'text/plain' });

// webkitRelativePath is non-standard; the File constructor doesn't set it.
const dirFile = (relPath: string, text: string): File => {
  const f = file(relPath, text);
  Object.defineProperty(f, 'webkitRelativePath', { value: relPath, configurable: true });
  return f;
};

const SKILL_MD = `---
name: my-skill
description: A test skill. Use when testing.
---
# My Skill body instructions`;

describe('parseUploadedFolder', () => {
  it('parses SKILL.md frontmatter into the skill', async () => {
    const res = await parseUploadedFolder([dirFile('my-skill/SKILL.md', SKILL_MD)]);
    expect('error' in res).toBe(false);
    if ('error' in res) return;
    expect(res.skill.name).toBe('my-skill');
    expect(res.skill.description).toBe('A test skill. Use when testing.');
    expect(res.skill.content).toContain('# My Skill body instructions');
    expect(res.skill.source).toBe('uploaded');
  });

  it('returns {error: "no-skill-md"} when no SKILL.md is present', async () => {
    const res = await parseUploadedFolder([dirFile('foo/README.md', '# readme')]);
    expect(res).toEqual({ error: 'no-skill-md' });
  });

  it('returns {error: "bad-frontmatter"} when SKILL.md has no name', async () => {
    const res = await parseUploadedFolder([dirFile('x/SKILL.md', '---\ndescription: no name\n---\nbody')]);
    expect(res).toEqual({ error: 'bad-frontmatter' });
  });

  it('collects text reference files keyed by path relative to the folder root', async () => {
    const res = await parseUploadedFolder([
      dirFile('my-skill/SKILL.md', SKILL_MD),
      dirFile('my-skill/examples/demo.md', '# demo'),
      dirFile('my-skill/data/ref.json', '{"a":1}'),
    ]);
    if ('error' in res) throw new Error('should not error');
    expect([...res.references.keys()].sort()).toEqual(['data/ref.json', 'examples/demo.md']);
    expect(res.references.get('examples/demo.md')).toBe('# demo');
    expect(res.skill.references.sort()).toEqual(['data/ref.json', 'examples/demo.md']);
  });

  it('skips non-text files (Phase 1 text-only)', async () => {
    const res = await parseUploadedFolder([
      dirFile('my-skill/SKILL.md', SKILL_MD),
      dirFile('my-skill/img/logo.png', 'binary-bytes'),
    ]);
    if ('error' in res) throw new Error('should not error');
    expect(res.references.size).toBe(0);
    expect(res.skill.references).toEqual([]);
  });
});

describe('parseUploadedFiles ({path, text} shape)', () => {
  it('parses SKILL.md and builds references from pre-extracted entries', async () => {
    const res = await parseUploadedFiles([
      { path: 'my-skill/SKILL.md', text: SKILL_MD },
      { path: 'my-skill/examples/demo.md', text: '# demo' },
      { path: 'my-skill/img/logo.png', text: 'binary' }, // non-text → skipped
    ]);
    if ('error' in res) throw new Error('should not error');
    expect(res.skill.name).toBe('my-skill');
    expect([...res.references.keys()]).toEqual(['examples/demo.md']);
    expect(res.references.get('examples/demo.md')).toBe('# demo');
  });

  it('returns {error: "no-skill-md"} when no path ends in skill.md', async () => {
    const res = await parseUploadedFiles([{ path: 'foo/README.md', text: '# r' }]);
    expect(res).toEqual({ error: 'no-skill-md' });
  });
});
