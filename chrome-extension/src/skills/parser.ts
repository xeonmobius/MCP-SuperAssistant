export interface SkillMeta {
  name: string;
  description: string;
  allowedTools?: string;
}

export interface Skill {
  name: string;
  description: string;
  content: string;
  allowedTools?: string;
  run?: string;
  source: string;
  sourceDir?: string;
}

export interface SkillToolResult {
  content: Array<{ type: 'text'; text: string }>;
}

/**
 * Frontmatter fence. Closing `---` may be followed by optional whitespace, an
 * optional newline, and an optional body (a SKILL.md ending exactly at the
 * closing fence with no trailing newline must still parse). Matching is done
 * AFTER normalizing CRLF/CR to LF so Windows-authored files parse too.
 */
const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---[ \t]*\n?([\s\S]*)$/;

export function parseSkillMarkdown(raw: string, source: string): Skill | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const match = normalized.match(FRONTMATTER_REGEX);
  if (!match) return null;

  const frontmatter = match[1];
  const content = match[2].trim();

  let name = '';
  let description = '';
  let allowedTools: string | undefined;
  let run: string | undefined;
  // True while consuming the indented continuation lines of a folded (>) or
  // literal (|) YAML block scalar for `description`.
  let collectingDescription = false;

  for (const line of frontmatter.split('\n')) {
    if (collectingDescription) {
      // A non-indented line ends the block scalar and must be processed normally.
      if (/^\s+/.test(line) && !line.startsWith('name:') && !line.startsWith('allowed-tools:') && !line.startsWith('run:')) {
        const trimmed = line.trim();
        if (trimmed) {
          description = description ? `${description} ${trimmed}` : trimmed;
        }
        continue;
      }
      collectingDescription = false;
    }

    if (line.startsWith('name:')) {
      name = line.slice('name:'.length).trim();
    } else if (line.startsWith('description:')) {
      let desc = line.slice('description:'.length).trim();
      if (desc === '>' || desc === '>-' || desc === '|' || desc === '|-') {
        collectingDescription = true;
        description = '';
        continue;
      }
      if (desc.startsWith('>')) desc = desc.slice(1).trim();
      description = desc;
    } else if (line.startsWith('allowed-tools:')) {
      allowedTools = line.slice('allowed-tools:'.length).trim();
    } else if (line.startsWith('run:')) {
      run = line.slice('run:'.length).trim();
    } else if (description && !line.startsWith('name:') && !line.startsWith('allowed-tools:') && !line.startsWith('run:')) {
      description += ' ' + line.trim();
    }
  }

  if (!name) return null;

  return { name, description, content, allowedTools, run, source };
}

/**
 * Encode a skill name into the MCP tool namespace segment.
 *
 * NOT a perfect injection — runs of `-` and `_` can collide (e.g. `__` and
 * `-_-` both map to `____`). The robust identifier is the `_skillName` field
 * stamped by `skillToPseudoTool` (and read by `skillNameFromToolName`); this
 * encoder only needs to be deterministic and to match across every site that
 * builds or matches a `skill_*` tool name. Kebab-case names (the convention)
 * are unaffected.
 */
export function encodeSkillName(toolSegment: string): string {
  return toolSegment.replace(/_/g, '__').replace(/-/g, '_');
}

/** Reverse of encodeSkillName, applied to the segment after the `skill_` prefix. */
function decodeSkillSegment(segment: string): string {
  // '__' originally meant a literal '_', a single '_' meant a literal '-'.
  // Use a placeholder so the two passes don't collide.
  const PLACEHOLDER = '\u0000';
  return segment
    .replace(/__/g, PLACEHOLDER)
    .replace(/_/g, '-')
    .replace(new RegExp(PLACEHOLDER, 'g'), '_');
}

export function skillToPseudoTool(skill: Skill) {
  const toolName = `skill_${encodeSkillName(skill.name)}`;
  return {
    name: toolName,
    description: skill.description,
    schema: JSON.stringify({
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: `What you need help with related to ${skill.name}`,
        },
      },
    }),
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: `What you need help with related to ${skill.name}`,
        },
      },
    },
    _isSkill: true,
    _skillName: skill.name,
    _skillContent: skill.content,
  };
}

/**
 * Recover the original skill name from a skill pseudo-tool. Prefers the
 * `_skillName` field (always present on tools built by `skillToPseudoTool`);
 * falls back to decoding the tool name for legacy/tool objects without it.
 */
export function skillNameFromToolName(tool: { name: string; _skillName?: string }): string {
  if (tool._skillName) return tool._skillName;
  const segment = tool.name.replace(/^skill_/, '');
  return decodeSkillSegment(segment);
}
