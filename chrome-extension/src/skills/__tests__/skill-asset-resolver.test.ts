import { describe, it, expect } from 'vitest';
import { resolveSkillAssetPath, isPathWithinSkillDir } from '../asset-resolver';

describe('skill_read_asset path resolution', () => {
  const skillDir = '/Users/test/.agents/skills/camofox-browser';

  it('resolves a file in references/ subdirectory', () => {
    const result = resolveSkillAssetPath(skillDir, 'references/anti-detection.md');
    expect(result).toBe(`${skillDir}/references/anti-detection.md`);
  });

  it('resolves a file in templates/ subdirectory', () => {
    const result = resolveSkillAssetPath(skillDir, 'templates/stealth-scraping.sh');
    expect(result).toBe(`${skillDir}/templates/stealth-scraping.sh`);
  });

  it('resolves a file in deeply nested subdirectory', () => {
    const result = resolveSkillAssetPath(skillDir, 'scripts/deep/nested/file.py');
    expect(result).toBe(`${skillDir}/scripts/deep/nested/file.py`);
  });

  it('resolves a top-level file', () => {
    const result = resolveSkillAssetPath(skillDir, 'README.md');
    expect(result).toBe(`${skillDir}/README.md`);
  });
});

describe('skill_read_asset security', () => {
  const skillDir = '/Users/test/.agents/skills/camofox-browser';

  it('allows paths within skill directory', () => {
    expect(isPathWithinSkillDir(skillDir, `${skillDir}/references/anti-detection.md`)).toBe(true);
    expect(isPathWithinSkillDir(skillDir, `${skillDir}/scripts/compress.py`)).toBe(true);
    expect(isPathWithinSkillDir(skillDir, skillDir)).toBe(true);
  });

  it('rejects path traversal with ..', () => {
    expect(isPathWithinSkillDir(skillDir, `${skillDir}/../../etc/passwd`)).toBe(false);
  });

  it('rejects absolute paths outside skill dir', () => {
    expect(isPathWithinSkillDir(skillDir, '/etc/passwd')).toBe(false);
    expect(isPathWithinSkillDir(skillDir, '/Users/test/.ssh/id_rsa')).toBe(false);
  });

  it('rejects empty path', () => {
    expect(isPathWithinSkillDir(skillDir, '')).toBe(false);
  });

  it('rejects path that starts with skill dir but escapes', () => {
    const fakePath = `${skillDir}/../../../etc/passwd`;
    expect(isPathWithinSkillDir(skillDir, fakePath)).toBe(false);
  });
});
