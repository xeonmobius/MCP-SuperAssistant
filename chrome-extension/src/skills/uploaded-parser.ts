import { parseSkillMarkdown, type Skill } from './parser';

export interface UploadedSkill {
  name: string;
  description: string;
  allowedTools?: string;
  content: string;
  source: 'uploaded';
  sourceDir?: string;
  uploadedAt: number;
  references: string[];
}

export interface ParsedFolder {
  skill: UploadedSkill;
  references: Map<string, string>;
}

export type ParseError = { error: 'no-skill-md' | 'bad-frontmatter' };

export interface FileEntry {
  // Relative path including the folder root (e.g. 'my-skill/examples/demo.md').
  // Content-side extraction preserves webkitRelativePath BEFORE the message
  // clone, since File objects lose that property across sendMessage.
  path: string;
  text: string;
}

const SKILL_MD_NAME = 'skill.md';
const TEXT_EXT = /\.(md|markdown|txt|text|json|ya?ml|csv|tsv|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|c|cc|cpp|h|hpp|sh|bash|zsh|ps1|sql|html?|css|scss|less|xml|toml|ini|env)$/i;

function baseName(p: string): string {
  const parts = p.split('/');
  return parts[parts.length - 1] || '';
}

function relPath(f: File): string {
  // webkitRelativePath is set by directory inputs; fall back to name.
  return (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
}

export async function parseUploadedFolder(
  files: File[],
): Promise<ParsedFolder | ParseError> {
  const skillFile = files.find(f => baseName(relPath(f)).toLowerCase() === SKILL_MD_NAME);
  if (!skillFile) return { error: 'no-skill-md' };

  const raw = await skillFile.text();
  const parsed = parseSkillMarkdown(raw, 'uploaded');
  if (!parsed || !parsed.name) return { error: 'bad-frontmatter' };

  const skillRel = relPath(skillFile);
  const rootPrefix = skillRel.includes('/') ? skillRel.replace(/\/?[^/]+$/, '') : '';

  const references = new Map<string, string>();
  for (const f of files) {
    if (f === skillFile) continue;
    if (!TEXT_EXT.test(baseName(relPath(f)))) continue; // Phase 1: text-only
    let rel = relPath(f);
    if (rootPrefix && rel.startsWith(rootPrefix + '/')) rel = rel.slice(rootPrefix.length + 1);
    references.set(rel, await f.text());
  }

  const skill: UploadedSkill = {
    name: parsed.name,
    description: parsed.description,
    allowedTools: parsed.allowedTools,
    content: parsed.content,
    source: 'uploaded',
    sourceDir: rootPrefix || undefined,
    uploadedAt: Date.now(),
    references: [...references.keys()],
  };
  return { skill, references };
}

export function uploadedSkillToSkill(u: UploadedSkill): Skill {
  return {
    name: u.name,
    description: u.description,
    content: u.content,
    allowedTools: u.allowedTools,
    source: 'uploaded',
    sourceDir: u.sourceDir,
  };
}

/**
 * Serializable-shape sibling of {@link parseUploadedFolder}. Accepts
 * pre-extracted `{path, text}` entries instead of `File[]` so the payload can
 * survive `chrome.runtime.sendMessage`'s structured clone (File objects and
 * the non-enumerable `webkitRelativePath` do not clone reliably across
 * content→background).
 */
export async function parseUploadedFiles(
  entries: FileEntry[],
): Promise<ParsedFolder | ParseError> {
  const skillEntry = entries.find(e => baseName(e.path).toLowerCase() === SKILL_MD_NAME);
  if (!skillEntry) return { error: 'no-skill-md' };

  const parsed = parseSkillMarkdown(skillEntry.text, 'uploaded');
  if (!parsed || !parsed.name) return { error: 'bad-frontmatter' };

  const skillRel = skillEntry.path;
  const rootPrefix = skillRel.includes('/') ? skillRel.replace(/\/?[^/]+$/, '') : '';

  const references = new Map<string, string>();
  for (const e of entries) {
    if (e === skillEntry) continue;
    if (!TEXT_EXT.test(baseName(e.path))) continue; // Phase 1: text-only
    let rel = e.path;
    if (rootPrefix && rel.startsWith(rootPrefix + '/')) rel = rel.slice(rootPrefix.length + 1);
    references.set(rel, e.text);
  }

  const skill: UploadedSkill = {
    name: parsed.name,
    description: parsed.description,
    allowedTools: parsed.allowedTools,
    content: parsed.content,
    source: 'uploaded',
    sourceDir: rootPrefix || undefined,
    uploadedAt: Date.now(),
    references: [...references.keys()],
  };
  return { skill, references };
}
