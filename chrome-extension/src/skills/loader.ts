import { parseSkillMarkdown, type Skill } from './parser';
import { uploadedSkillToSkill, type UploadedSkill } from './uploaded-parser';
import { uploadedStore } from './uploaded-store';
import { createLogger } from '@extension/shared/lib/logger';

const logger = createLogger('SkillLoader');

const DEFAULT_SKILLS_PATHS = [
  '~/.agents/skills',
  '~/.claude/skills',
];

let cachedSkills: Skill[] = [];

export function getCachedSkills(): Skill[] {
  return cachedSkills;
}

export function setCachedSkills(skills: Skill[]): void {
  cachedSkills = skills;
}

export async function getSkillsPaths(): Promise<string[]> {
  try {
    const result = await chrome.storage.local.get('mcp_skills_paths');
    return (result.mcp_skills_paths as string[]) || DEFAULT_SKILLS_PATHS;
  } catch {
    return DEFAULT_SKILLS_PATHS;
  }
}

export async function setSkillsPaths(paths: string[]): Promise<void> {
  await chrome.storage.local.set({ mcp_skills_paths: paths });
}

export async function loadSkillsFromMcpResources(client: any): Promise<Skill[]> {
  const skills: Skill[] = [];

  try {
    const capabilities = client.getServerCapabilities();
    if (!capabilities?.resources) {
      logger.debug('[SkillLoader] Server does not support resources');
      return skills;
    }

    const { resources } = await client.listResources();
    logger.debug(`[SkillLoader] Found ${resources.length} resources`);

    for (const resource of resources) {
      const uri = resource.uri || '';
      const name = (resource.name || '').toLowerCase();

      if (uri.startsWith('skill://') || uri.startsWith('skills://') || name.includes('skill')) {
        try {
          const result = await client.readResource({ uri });
          const textContent = extractTextFromResource(result);
          if (textContent) {
            const skill = parseSkillMarkdown(textContent, uri);
            if (skill) {
              skills.push(skill);
              logger.debug(`[SkillLoader] Loaded skill: ${skill.name}`);
            }
          }
        } catch (err) {
          logger.warn(`[SkillLoader] Failed to read resource ${uri}:`, err);
        }
      }
    }
  } catch (error) {
    logger.debug('[SkillLoader] Error loading skills from MCP resources:', error);
  }

  return skills;
}

export async function loadSkillsFromEndpoint(proxyUrl: string): Promise<Skill[]> {
  const skills: Skill[] = [];

  try {
    const baseUrl = proxyUrl.replace(/\/(sse|mcp|message)$/, '');
    const url = `${baseUrl}/skills`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return skills;

    const data = await response.json();
    const skillsList: Array<{ name: string; content: string }> = Array.isArray(data) ? data : data.skills || [];

    for (const item of skillsList) {
      const skill = parseSkillMarkdown(item.content, `endpoint:${item.name}`);
      if (skill) {
        skills.push(skill);
      }
    }

    logger.debug(`[SkillLoader] Loaded ${skills.length} skills from endpoint`);
  } catch (error) {
    logger.debug('[SkillLoader] Skills endpoint not available:', error instanceof Error ? error.message : String(error));
  }

  return skills;
}

const FILESYSTEM_TOOL_PREFIX = 'filesystem.';

type ToolCaller = (serverUrl: string, toolName: string, args: Record<string, unknown>) => Promise<any>;

/**
 * Parse the raw text returned by the filesystem server's `list_allowed_directories`
 * tool. The server prepends a human-readable `Allowed directories:` header and
 * indents each path; that header must NOT survive as a phantom allowed-directory
 * entry (it would corrupt home-dir inference and path matching). Only keep
 * entries that look like filesystem paths (absolute or `~`-prefixed).
 */
export function parseAllowedDirectories(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split('\n')
    .map(d => d.trim())
    .filter(d => Boolean(d) && /^(\/|~)/.test(d));
}

/**
 * True if `p` is equal to, or nested beneath, one of `allowedDirs`. Uses a path
 * BOUNDARY check (`p === d || p.startsWith(d + '/')`) so a short allowed dir
 * like `/Users/sha` can NOT grant access to `/Users/shannon/...`. `~`-prefixed
 * allowed dirs are expanded when `homeDir` is supplied.
 */
export function isPathWithinAllowed(p: string, allowedDirs: string[], homeDir?: string): boolean {
  const expand = (d: string) => (homeDir && d.startsWith('~') ? d.replace(/^~/, homeDir) : d);
  return allowedDirs.some(d => {
    const dir = expand(d).replace(/\/+$/, '');
    return p === dir || p.startsWith(`${dir}/`);
  });
}

export async function loadSkillsFromFilesystemServer(
  serverUrl: string,
  callTool: ToolCaller,
): Promise<Skill[]> {
  const skills: Skill[] = [];

  try {
    const skillsPaths = await getSkillsPaths();
    if (skillsPaths.length === 0) return skills;

    const hasListDirectory = await callTool(serverUrl, `${FILESYSTEM_TOOL_PREFIX}list_allowed_directories`, {});
    const allowedDirs: string[] = parseAllowedDirectories(extractTextFromToolResult(hasListDirectory));

    const homeDir = inferHomeDirFromAllowedDirs(allowedDirs);
    const expandedPaths = skillsPaths.map(p => p.startsWith('~') ? p.replace(/^~/, homeDir) : p);
    const accessiblePaths = expandedPaths.filter(p => isPathWithinAllowed(p, allowedDirs, homeDir));

    if (accessiblePaths.length === 0) {
      logger.debug('[SkillLoader] No skills paths within filesystem server allowed directories');
      return skills;
    }

    for (const skillsPath of accessiblePaths) {
      try {
        const expandedPath = skillsPath.replace(/^~/, getHomeDir());
        const listResult = await callTool(serverUrl, `${FILESYSTEM_TOOL_PREFIX}list_directory`, { path: expandedPath });
        const entries = extractTextFromToolResult(listResult)?.split('\n') || [];

        for (const entry of entries) {
          const dirMatch = entry.match(/\[DIR\]\s+(.+)/);
          if (!dirMatch) continue;

          const dirName = dirMatch[1].trim();
          const skillFilePath = `${expandedPath}/${dirName}/SKILL.md`;

          try {
            const readResult = await callTool(serverUrl, `${FILESYSTEM_TOOL_PREFIX}read_text_file`, { path: skillFilePath });
            const content = extractTextFromToolResult(readResult);
            if (content) {
              const skill = parseSkillMarkdown(content, `filesystem:${skillFilePath}`);
              if (skill) {
                const skillDirPath = `${expandedPath}/${dirName}`;
                skill.sourceDir = skillDirPath;
                try {
                  const allFiles = await listAllFiles(serverUrl, callTool, skillDirPath, 'SKILL.md');

                  if (allFiles.length > 0) {
                    skill.content += `\n\n---\n\nAvailable files in this skill directory (use \`skill_read_asset\` to load any file):\n${
                      allFiles.map(f => `- ${f}`).join('\n')
                    }`;
                  }
                } catch {
                  logger.debug(`[SkillLoader] Could not list files in ${dirName}`);
                }

                skills.push(skill);
                logger.debug(`[SkillLoader] Loaded skill from filesystem: ${skill.name}`);
              }
            }
          } catch {
            logger.debug(`[SkillLoader] No SKILL.md in ${dirName}`);
          }
        }
      } catch (err) {
        logger.debug(`[SkillLoader] Failed to list ${skillsPath}:`, err);
      }
    }

    logger.debug(`[SkillLoader] Loaded ${skills.length} skills from filesystem server`);
  } catch (error) {
    logger.debug('[SkillLoader] Filesystem server not available:', error instanceof Error ? error.message : String(error));
  }

  return skills;
}

function getHomeDir(): string {
  if (typeof process !== 'undefined' && process.env?.HOME) return process.env.HOME;
  if (typeof navigator !== 'undefined' && (navigator as any).userAgent?.includes('Mac')) return '/Users';
  return '/home';
}

function inferHomeDirFromAllowedDirs(allowedDirs: string[]): string {
  for (const dir of allowedDirs) {
    const match = dir.match(/^(\/Users\/[^/]+)/);
    if (match) return match[1];
  }
  for (const dir of allowedDirs) {
    const match = dir.match(/^(\/home\/[^/]+)/);
    if (match) return match[1];
  }
  return getHomeDir();
}

export async function listAllFiles(
  serverUrl: string,
  callTool: ToolCaller,
  dirPath: string,
  excludeFile?: string,
  prefix: string = '',
  maxDepth: number = 10,
  depth: number = 0,
): Promise<string[]> {
  const files: string[] = [];
  try {
    const result = await callTool(serverUrl, `${FILESYSTEM_TOOL_PREFIX}list_directory`, { path: dirPath });
    const entries = extractTextFromToolResult(result)?.split('\n') || [];

    for (const entry of entries) {
      const fileMatch = entry.match(/\[FILE\]\s+(.+)/);
      if (fileMatch) {
        const name = fileMatch[1].trim();
        if (name !== excludeFile) {
          files.push(prefix ? `${prefix}/${name}` : name);
        }
        continue;
      }

      const dirMatch = entry.match(/\[DIR\]\s+(.+)/);
      if (dirMatch) {
        const subDirName = dirMatch[1].trim();
        // Guard against symlink loops / pathological depth that would otherwise
        // hang the loader (or overflow the stack) before skills are shown.
        if (depth >= maxDepth) {
          logger.debug(`[SkillLoader] maxDepth (${maxDepth}) reached at ${dirPath}/${subDirName}, skipping`);
          continue;
        }
        const subDirPath = `${dirPath}/${subDirName}`;
        const subPrefix = prefix ? `${prefix}/${subDirName}` : subDirName;
        const subFiles = await listAllFiles(serverUrl, callTool, subDirPath, excludeFile, subPrefix, maxDepth, depth + 1);
        files.push(...subFiles);
      }
    }
  } catch {
    // skip unreadable directories
  }
  return files;
}

function extractTextFromToolResult(result: any): string | null {
  if (!result) return null;
  if (typeof result === 'string') return result;
  if (result.content && Array.isArray(result.content)) {
    return result.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n');
  }
  if (result.text) return result.text;
  return null;
}

function extractTextFromResource(result: any): string | null {
  if (!result) return null;

  if (result.contents && Array.isArray(result.contents)) {
    return result.contents
      .filter((c: any) => c.text)
      .map((c: any) => c.text)
      .join('\n');
  }

  if (Array.isArray(result)) {
    return result
      .filter((item: any) => item.text || item.content)
      .map((item: any) => item.text || item.content)
      .join('\n');
  }

  if (typeof result === 'string') return result;
  if (result.text) return result.text;

  return null;
}

export async function persistSkills(skills: Skill[]): Promise<void> {
  try {
    const serializable = skills.map(s => ({
      name: s.name,
      description: s.description,
      content: s.content,
      allowedTools: s.allowedTools,
      source: s.source,
      sourceDir: s.sourceDir,
    }));
    await chrome.storage.local.set({ mcp_skills: serializable });
    cachedSkills = skills;
    logger.debug(`[SkillLoader] Persisted ${skills.length} skills`);
  } catch (error) {
    logger.warn('[SkillLoader] Failed to persist skills:', error);
  }
}

export async function loadPersistedSkills(): Promise<Skill[]> {
  try {
    const result = await chrome.storage.local.get('mcp_skills');
    const skills = (result.mcp_skills || []) as Skill[];
    cachedSkills = skills;
    logger.debug(`[SkillLoader] Loaded ${skills.length} persisted skills`);
    return skills;
  } catch (error) {
    logger.warn('[SkillLoader] Failed to load persisted skills:', error);
    return [];
  }
}

export async function loadUploadedSkills(): Promise<Skill[]> {
  try {
    if (!uploadedStore) return [];
    const uploaded: UploadedSkill[] = await uploadedStore.listUploadedSkills();
    return uploaded.map(uploadedSkillToSkill);
  } catch (err) {
    logger.warn('[SkillLoader] Failed to load uploaded skills:', err);
    return [];
  }
}

/** Refresh uploaded skills into the cache (de-dupe source==='uploaded', append fresh). */
export async function refreshUploadedSkillsInCache(): Promise<void> {
  const uploaded = await loadUploadedSkills();
  const withoutUploaded = getCachedSkills().filter(s => s.source !== 'uploaded');
  setCachedSkills([...withoutUploaded, ...uploaded]);
}
