// In-memory conversation store keyed by sessionId. The full Anthropic-format
// message history (including tool_use / tool_result blocks) lives here so the
// client never has to serialize tool blocks. Fine for a local single-user MVP;
// resets when the dev server restarts. Swap for a real store later.
const sessions = new Map<string, any[]>();

export function getSession(id: string): any[] {
  let messages = sessions.get(id);
  if (!messages) {
    messages = [];
    sessions.set(id, messages);
  }
  return messages;
}
