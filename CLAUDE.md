# WP_AI — AI Blog Assistant

A chat app where a user converses with an AI that **creates and publishes blog posts through chat** — it takes real actions via tool calls, not copy-paste. Built on the Anthropic Claude API. **Current focus: maximizing blog quality and virality** (especially for the Japanese market).

## Run

- Node 18.17+.
- Put your key in `.env` (or `.env.local`) — the variable name must be exactly `ANTHROPIC_API_KEY`. Restart the dev server after adding it.
- `npm install`
- `npm run dev` → http://localhost:3000
- `npm run build` for a production build.

## Architecture (Next.js 14 App Router + TypeScript)

- `src/app/api/chat/route.ts` — streaming, hand-written **agentic tool-use loop** on the Anthropic SDK (not LangChain). Streams text token-by-token; runs tools between turns; publishing is gated behind explicit user approval (enforced via the system prompt).
- `src/lib/anthropic.ts` — Anthropic client + the `MODEL` constant (currently `claude-sonnet-4-6`) + `MAX_TOKENS`. **Change the model here, in one place.**
- `src/lib/systemPrompt.ts` — the assistant's guided-flow instructions (topic → angle → outline → draft → SEO → approve → publish).
- `src/lib/tools.ts` — tool definitions + handlers: `list_existing_posts` (grounding) and `save_blog_post` (the publish action).
- `src/lib/store.ts` — the **PublishTarget seam**. `LocalJsonStore` writes `data/blogs.json` today; swap in another target (Supabase, etc.) later without touching chat/tool code.
- `src/lib/session.ts` — in-memory conversation history per `sessionId` (resets on server restart).
- `src/app/page.tsx` — chat UI + live "Site collection" panel.

## Conventions

- Reference the model only via the `MODEL` constant — never hardcode model strings elsewhere.
- New blog destinations go behind the `PublishTarget` interface in `store.ts`.
- Conversation state (including tool_use/tool_result blocks) lives server-side in `session.ts`; the client sends only `{ sessionId, message }`.
- Keep the system prompt stable — prompt caching is applied to it.

## Current state / deferred

- **No image generation yet** — `save_blog_post` only carries a text `featuredImagePrompt`.
- **No embeddings/vector search** — `list_existing_posts` hands the model existing posts as plain text (fine at small scale).
- **loop_asia integration is deferred** — the publish target is local for now; the priority is blog-writing quality.
- Design notes from earlier framing live in `docs/` (some still mention WordPress/Supabase).
