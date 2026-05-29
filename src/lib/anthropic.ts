import Anthropic from "@anthropic-ai/sdk";

// Writer/chat model. "claude-sonnet-4-6" is the speed/cost balance;
// swap to "claude-opus-4-7" for max quality or "claude-haiku-4-5" for cheapest.
export const MODEL = "claude-sonnet-4-6";
export const MAX_TOKENS = 16000;

// Lazy singleton so the client is only constructed at request time (it reads
// ANTHROPIC_API_KEY then), not at import/build time.
let _client: Anthropic | null = null;
export function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}
