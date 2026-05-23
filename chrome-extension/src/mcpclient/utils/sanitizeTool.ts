const SAFE_TOOL_FIELDS = ['name', 'title', 'description', 'inputSchema', 'input_schema', 'annotations', 'uri', 'arguments'] as const;

export function sanitizeTool(tool: any): any {
  if (!tool || typeof tool !== 'object') return tool;

  const sanitized: Record<string, any> = {};
  for (const field of SAFE_TOOL_FIELDS) {
    if (field in tool) {
      sanitized[field] = tool[field];
    }
  }

  if (!sanitized.inputSchema && !sanitized.input_schema) {
    sanitized.inputSchema = { type: 'object' };
  }

  return sanitized;
}

export function sanitizeTools(tools: any[]): any[] {
  if (!Array.isArray(tools)) return [];
  return tools.map(sanitizeTool);
}
