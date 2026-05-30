import Anthropic from "@anthropic-ai/sdk";

// Two-model split for cost-to-performance:
// - MODEL_CHAT runs the whole conversation (goal/angle/outline/metadata/approval).
//   It's cheap and never writes the long article body.
// - MODEL_WRITER is invoked server-side ONLY to expand an approved brief into the
//   finished article — the one place premium quality pays for itself (virality).
// To revert to all-Sonnet (max quality, higher cost) set MODEL_CHAT to the writer.
export const MODEL_CHAT = "claude-haiku-4-5";
export const MODEL_WRITER = "claude-sonnet-4-6";

// Back-compat default (used as the pricing key for the chat loop).
export const MODEL = MODEL_CHAT;
export const MAX_TOKENS = 16000;

// Lazy singleton so the client is only constructed at request time (it reads
// ANTHROPIC_API_KEY then), not at import/build time.
let _client: Anthropic | null = null;
export function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}
