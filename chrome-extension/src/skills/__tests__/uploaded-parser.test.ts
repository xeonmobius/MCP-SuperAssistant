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

const skillMd = (name: string, body = 'body') =>
  `---\nname: ${name}\ndescription: d\n---\n${body}`;

describe('parseUploadedFolder', () => {
  it('parses a single SKILL.md frontmatter into one skill', async () => {
    const res = await parseUploadedFolder([dirFile('my-skill/SKILL.md', SKILL_MD)]);
    expect('error' in res).toBe(false);
    if ('error' in res) return;
    expect(res.skills).toHaveLength(1);
    const s = res.skills[0];
    expect(s.skill.name).toBe('my-skill');
    expect(s.skill.description).toBe('A test skill. Use when testing.');
    expect(s.skill.content).toContain('# My Skill body instructions');
    expect(s.skill.source).toBe('uploaded');
  });

  it('returns {error: "no-skill-md"} when no SKILL.md is present', async () => {
    const res = await parseUploadedFolder([dirFile('foo/README.md', '# readme')]);
    expect(res).toEqual({ error: 'no-skill-md' });
  });

  it('returns {error: "bad-frontmatter"} when a SKILL.md has no name', async () => {
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
    const s = res.skills[0];
    expect([...s.references.keys()].sort()).toEqual(['data/ref.json', 'examples/demo.md']);
    expect(s.references.get('examples/demo.md')).toBe('# demo');
    expect(s.skill.references.sort()).toEqual(['data/ref.json', 'examples/demo.md']);
  });

  it('skips non-text files (Phase 1 text-only)', async () => {
    const res = await parseUploadedFolder([
      dirFile('my-skill/SKILL.md', SKILL_MD),
      dirFile('my-skill/img/logo.png', 'binary-bytes'),
    ]);
    if ('error' in res) throw new Error('should not error');
    expect(res.skills[0].references.size).toBe(0);
    expect(res.skills[0].skill.references).toEqual([]);
  });
});

describe('parseUploadedFiles ({path, text} shape)', () => {
  it('parses a single SKILL.md and builds references from pre-extracted entries', async () => {
    const res = await parseUploadedFiles([
      { path: 'my-skill/SKILL.md', text: SKILL_MD },
      { path: 'my-skill/examples/demo.md', text: '# demo' },
      { path: 'my-skill/img/logo.png', text: 'binary' }, // non-text → skipped
    ]);
    if ('error' in res) throw new Error('should not error');
    expect(res.skills).toHaveLength(1);
    expect(res.skills[0].skill.name).toBe('my-skill');
    expect([...res.skills[0].references.keys()]).toEqual(['examples/demo.md']);
    expect(res.skills[0].references.get('examples/demo.md')).toBe('# demo');
  });

  it('parses a single SKILL.md with no folder (file-only upload)', async () => {
    const res = await parseUploadedFiles([{ path: 'SKILL.md', text: skillMd('solo') }]);
    if ('error' in res) throw new Error('should not error');
    expect(res.skills).toHaveLength(1);
    expect(res.skills[0].skill.name).toBe('solo');
    expect(res.skills[0].skill.sourceDir).toBeUndefined();
  });

  it('parses MULTIPLE skills in one folder (one parsed skill per SKILL.md)', async () => {
    const res = await parseUploadedFiles([
      { path: 'skills/foo/SKILL.md', text: skillMd('foo') },
      { path: 'skills/foo/ref.md', text: 'foo ref' },
      { path: 'skills/bar/SKILL.md', text: skillMd('bar') },
      { path: 'skills/bar/data.json', text: '{}' },
    ]);
    if ('error' in res) throw new Error('should not error');
    expect(res.skills.map(p => p.skill.name).sort()).toEqual(['bar', 'foo']);
    const foo = res.skills.find(p => p.skill.name === 'foo')!;
    expect([...foo.references.keys()]).toEqual(['ref.md']);
    const bar = res.skills.find(p => p.skill.name === 'bar')!;
    expect([...bar.references.keys()]).toEqual(['data.json']);
  });

  it('assigns a nested file to its NEAREST (deepest) skill root', async () => {
    const res = await parseUploadedFiles([
      { path: 'outer/SKILL.md', text: skillMd('outer') },
      { path: 'outer/inner/SKILL.md', text: skillMd('inner') },
      { path: 'outer/inner/note.md', text: 'inner note' },
      { path: 'outer/top.md', text: 'top' },
    ]);
    if ('error' in res) throw new Error('should not error');
    const inner = res.skills.find(p => p.skill.name === 'inner')!;
    expect([...inner.references.keys()]).toEqual(['note.md']); // belongs to inner, not outer
    const outer = res.skills.find(p => p.skill.name === 'outer')!;
    expect([...outer.references.keys()]).toEqual(['top.md']); // top.md stays with outer
  });

  it('returns {error: "no-skill-md"} when no path ends in skill.md', async () => {
    const res = await parseUploadedFiles([{ path: 'foo/README.md', text: '# r' }]);
    expect(res).toEqual({ error: 'no-skill-md' });
  });
});
