import { parseSkillMarkdown, type Skill } from './parser.js';
import { createLogger } from '@extension/shared/lib/logger';

const logger = createLogger('SkillLoader');

const SKILLS_DIRS = [
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
