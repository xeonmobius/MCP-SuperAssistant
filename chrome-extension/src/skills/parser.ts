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
  source: string;
  sourceDir?: string;
}

export interface SkillToolResult {
  content: Array<{ type: 'text'; text: string }>;
}

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

export function parseSkillMarkdown(raw: string, source: string): Skill | null {
  const match = raw.match(FRONTMATTER_REGEX);
  if (!match) return null;

  const frontmatter = match[1];
  const content = match[2].trim();

  let name = '';
  let description = '';
  let allowedTools: string | undefined;

  for (const line of frontmatter.split('\n')) {
    if (line.startsWith('name:')) {
      name = line.slice(5).trim();
    } else if (line.startsWith('description:')) {
      let desc = line.slice(13).trim();
      if (desc === '>' || desc === '>-') {
        continue;
      }
      if (desc.startsWith('>') ) {
        desc = desc.slice(1).trim();
      }
      description = desc;
    } else if (line.startsWith('allowed-tools:')) {
      allowedTools = line.slice(14).trim();
    } else if (description && !name && !line.startsWith('name:') && !line.startsWith('allowed-tools:')) {
      description += ' ' + line.trim();
    }
  }

  if (!name) return null;

  return { name, description, content, allowedTools, source };
}

export function skillToPseudoTool(skill: Skill) {
  const toolName = `skill_${skill.name.replace(/-/g, '_')}`;
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
    _skillContent: skill.content,
  };
}
