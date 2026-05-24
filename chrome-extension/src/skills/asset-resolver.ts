import { resolve, normalize } from 'node:path';

export function resolveSkillAssetPath(skillDir: string, relativePath: string): string {
  return resolve(skillDir, relativePath);
}

export function isPathWithinSkillDir(skillDir: string, filePath: string): boolean {
  if (!filePath) return false;
  const normalizedSkillDir = normalize(skillDir);
  const normalizedFilePath = normalize(filePath);
  return normalizedFilePath.startsWith(normalizedSkillDir + '/') || normalizedFilePath === normalizedSkillDir;
}
