/**
 * Pure builder for the combined tool+skill list the sidebar exposes.
 *
 * Extracted from the `useMcpCommunication` useMemo so it can be unit-tested
 * independently of React and so the memo can subscribe to the skill store
 * reactively (the old memo read `useSkillStore.getState()` non-reactively, so
 * toggling a skill never recomputed the list sent to the model).
 */

export interface CombinedTool {
  name: string;
  description: string;
  schema: string;
  input_schema: unknown;
}

// Import the canonical encoder so tool names built here EXACTLY match what the
// background call-tool handler routes (`skill_${encodeSkillName(name)}`).
// Using a different (lossy) encoder here breaks skill invocation for any name
// containing an underscore.
import { encodeSkillName } from '../../../../chrome-extension/src/skills/parser';

const SKILL_QUERY_SCHEMA = (skillName: string) => ({
  type: 'object' as const,
  properties: { query: { type: 'string' as const, description: `Query for ${skillName}` } },
});

const SKILL_READ_ASSET_SCHEMA = {
  type: 'object' as const,
  properties: {
    skill_name: { type: 'string' as const, description: 'Name of the skill that owns the file' },
    file_path: { type: 'string' as const, description: 'Relative path to the file within the skill directory (e.g., "references/api.md")' },
  },
  required: ['skill_name', 'file_path'],
};

export function buildCombinedToolList(
  tools: Array<{ name: string; description?: string; input_schema?: unknown; schema?: unknown }>,
  isToolEnabled: (name: string) => boolean,
  availableSkills: Array<{ name: string; description?: string }>,
  enabledSkillNames: Set<string>,
): CombinedTool[] {
  const normalized: CombinedTool[] = tools.map(tool => ({
    name: tool.name,
    description: tool.description || '',
    schema: typeof tool.schema === 'string' ? (tool.schema as string) : JSON.stringify(tool.input_schema || {}),
    input_schema: tool.input_schema || {},
  }));

  const enabledTools = normalized.filter(tool => isToolEnabled(tool.name));

  const enabledSkills = availableSkills.filter(s => enabledSkillNames.has(s.name));

  const skillToolEntries: CombinedTool[] = enabledSkills.map(s => ({
    name: `skill_${encodeSkillName(s.name)}`,
    description: s.description || '',
    schema: JSON.stringify(SKILL_QUERY_SCHEMA(s.name)),
    input_schema: SKILL_QUERY_SCHEMA(s.name),
  }));

  const skillReadAssetTool: CombinedTool[] = enabledSkills.length > 0
    ? [{
        name: 'skill_read_asset',
        description: 'Read an external file from a skill directory. Use when a skill references files in its manifest that you need to load.',
        schema: JSON.stringify(SKILL_READ_ASSET_SCHEMA),
        input_schema: SKILL_READ_ASSET_SCHEMA,
      }]
    : [];

  return [...enabledTools, ...skillToolEntries, ...skillReadAssetTool];
}

/**
 * Build the list of enabled skill pseudo-tools (for the MCP instructions prompt's
 * AVAILABLE SKILLS section) from the SKILL STORE.
 *
 * This MUST source from the skill store, not the tool store: after the
 * handleToolUpdate/getAvailableTools split, skill_* pseudo-tools are intentionally
 * kept out of the tool store, so deriving them from `tools.filter(skill_)` yields
 * an empty list and the model never learns the skills exist.
 */
export function buildEnabledSkillTools(
  availableSkills: Array<{ name: string; description?: string }>,
  enabledSkillNames: Set<string>,
): Array<{ name: string; description: string; schema: string }> {
  return availableSkills
    .filter(s => enabledSkillNames.has(s.name))
    .map(s => ({
      name: `skill_${encodeSkillName(s.name)}`,
      description: s.description || '',
      schema: JSON.stringify({ type: 'object', properties: { query: { type: 'string' } } }),
    }));
}
