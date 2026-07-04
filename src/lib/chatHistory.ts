// Pure helpers for keeping the Anthropic conversation history valid. Kept in a
// dependency-free module so they're trivially unit-testable (no fs/Supabase/SDK
// imports) — these guard the invariant whose violation caused the "JSON error"
// (a dangling tool_use bricking every future turn).

// Coerce a stored message's content into a clean block array (a plain string
// becomes one text block; empty/whitespace strings collapse to no blocks).
export function toBlocks(content: any): any[] {
  if (typeof content === "string") {
    return content.trim() ? [{ type: "text", text: content }] : [];
  }
  if (Array.isArray(content)) return content.filter(Boolean);
  return [];
}

// Repair a stored conversation so it always satisfies the Anthropic Messages API
// invariants before we send it back to the model. This is the SELF-HEAL that
// makes a one-off hiccup (a tool that threw mid-turn, an empty content block,
// two racing writes) non-fatal instead of bricking every future turn.
//   1. Every assistant `tool_use` MUST be answered by a following user
//      `tool_result` — inject a placeholder error result for any that is missing
//      (e.g. a turn persisted half-built because a tool threw before its result).
//   2. Drop empty-content messages (an empty content array is a 400).
//   3. The first message must be from the user — drop any leading assistant turns.
//   4. Roles must alternate — merge consecutive same-role messages (keeping
//      tool_result blocks first in a user message, where the API wants them).
// Idempotent: running it on an already-clean history returns an equivalent one.
export function sanitizeHistory(messages: any[]): any[] {
  if (!Array.isArray(messages)) return [];

  // Pass 1: keep valid messages, guarantee tool_use → tool_result adjacency.
  const withResults: any[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    const blocks = toBlocks(m.content);
    if (blocks.length === 0) continue;
    withResults.push({ role: m.role, content: blocks });

    if (m.role === "assistant") {
      const toolUseIds = blocks
        .filter((b: any) => b?.type === "tool_use")
        .map((b: any) => b.id);
      if (toolUseIds.length) {
        const next = messages[i + 1];
        const answered = new Set<string>();
        if (next && next.role === "user") {
          for (const b of toBlocks(next.content)) {
            if (b?.type === "tool_result") answered.add(b.tool_use_id);
          }
        }
        const missing = toolUseIds.filter((id: string) => !answered.has(id));
        if (missing.length) {
          withResults.push({
            role: "user",
            content: missing.map((id: string) => ({
              type: "tool_result",
              tool_use_id: id,
              content: "（前回の処理が中断されました。続けてください。）",
              is_error: true,
            })),
          });
        }
      }
    }
  }

  // Pass 2: first message must be from the user.
  while (withResults.length && withResults[0].role === "assistant") withResults.shift();

  // Pass 3: merge consecutive same-role messages so roles strictly alternate.
  const out: any[] = [];
  for (const m of withResults) {
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) {
      prev.content = prev.content.concat(m.content);
      if (m.role === "user") {
        // Keep tool_result blocks at the front of the merged user message.
        const results = prev.content.filter((b: any) => b?.type === "tool_result");
        const rest = prev.content.filter((b: any) => b?.type !== "tool_result");
        prev.content = results.concat(rest);
      }
    } else {
      out.push({ role: m.role, content: m.content.slice() });
    }
  }
  return out;
}

// Put a cache breakpoint on the last message so the whole conversation prefix is
// cached for the next turn (0.1× input on a hit). Returns a copy — never mutates
// the input. Guards the empty-content case so it can never emit a typeless block.
export function withConversationCache(messages: any[]): any[] {
  if (messages.length === 0) return messages;
  const out = messages.slice();
  const last = out[out.length - 1];
  let blocks =
    typeof last.content === "string"
      ? [{ type: "text", text: last.content }]
      : last.content.slice();
  // Never attach cache_control to a missing block (empty content would otherwise
  // yield a typeless block → 400). If there's nothing to cache, leave it be.
  if (blocks.length === 0) return out;
  const lastBlock = { ...blocks[blocks.length - 1], cache_control: { type: "ephemeral" } };
  blocks = [...blocks.slice(0, -1), lastBlock];
  out[out.length - 1] = { ...last, content: blocks };
  return out;
}
