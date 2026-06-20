/**
 * Extract the body of an SuperAssistant `<system>` message block from a
 * rendered function-result element's text.
 *
 * Matches `<system>` or `<SYSTEM>` (the extension emits/recognizes both).
 * Returns the trimmed inner text, or null if no CLOSED tag pair is present
 * (so a stray opening tag in tool output can't trigger a system-message box).
 */
export function extractSystemMessage(content: string): string | null {
  if (typeof content !== 'string' || !content) return null;
  const match = content.match(/<(?:SYSTEM|system)>([\s\S]*?)<\/(?:SYSTEM|system)>/);
  if (!match) return null;
  const body = match[1].trim();
  return body.length > 0 ? body : null;
}
