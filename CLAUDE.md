# WP_AI — AI Blog Assistant

A chat app where a user converses with an AI that **creates and publishes blog posts through chat** — it takes real actions via tool calls, not copy-paste. Built on the Anthropic Claude API. **Current focus: maximizing blog quality and virality (Japanese market) at a low, profitable per-blog API cost.**

## Run

- Node 18.17+.
- Copy `.env.local.example` → `.env` and fill in values. Required: `ANTHROPIC_API_KEY`. Restart the dev server after editing `.env`.
- Optional env (storage + features):
  - `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — when BOTH are set, storage switches from local JSON to Supabase automatically. Server-only; never expose the service role key to the browser.
  - `SUPABASE_URI` — direct Postgres connection string, used **only** for running schema migrations (not by the app).
  - `VOYAGE_API_KEY` — enables semantic search (embeddings). Without it, grounding falls back to keyword search.
- `npm install` → `npm run dev` → http://localhost:3000. `npm run build` for production.
- **DB schema:** run the files in `supabase/` (in order: `schema.sql`, `002_embeddings.sql`, `003_post_type.sql`) in the Supabase **SQL Editor**. DDL is not run by the app.

## Architecture (Next.js 14 App Router + TypeScript)

**Two-model split (cost-to-performance):** a cheap model orchestrates the whole conversation; the premium model is invoked server-side *only* to write the article body — the one place quality drives virality/revenue.

- `src/lib/anthropic.ts` — Anthropic client + model constants. `MODEL_CHAT` (Haiku, the orchestrator) and `MODEL_WRITER` (Sonnet, the article writer). `MODEL` aliases `MODEL_CHAT` for pricing. **Change models here, in one place.** To revert to all-Sonnet (max quality, higher cost) set `MODEL_CHAT = MODEL_WRITER`.
- `src/app/api/chat/route.ts` — streaming, hand-written **agentic tool-use loop** (not LangChain), runs on `MODEL_CHAT`. Streams text token-by-token; runs tools between turns. Applies prompt caching to the system prompt AND a rolling cache breakpoint on the conversation prefix (`withConversationCache`). Logs per-turn token usage + cost.
- `src/lib/systemPrompt.ts` — `SYSTEM_PROMPT` (orchestrator's guided flow: goal → angle → outline → propose → approve → publish) and `WRITER_SYSTEM` (the writer sub-call's prompt; owns the `BLOG_PLAYBOOK`, outputs a strict `<TITLE>/<EXCERPT>/<BODY>` format).
- `src/lib/blogContext.ts` — `BLOG_PLAYBOOK`: fact-checked Japanese viral/SEO writing guidance injected into `WRITER_SYSTEM`.
- `src/lib/tools.ts` — tool defs + handlers:
  - `list_existing_posts` — full inventory (no query).
  - `search_existing_posts(query)` — **semantic** search (vector) for the topic×intent duplicate check + internal links.
  - `propose_blog_post(brief)` — takes a BRIEF (goal, post_type, topic, angle, audience, outline, key_points, metadata), calls `MODEL_WRITER` server-side to expand it into the finished article, emits a `draft` preview event. Does NOT publish. Re-call with `revision_note` to revise. The article is written **once** here.
  - `publish_blog_post()` — no args; pulls the last proposed draft out of the conversation's tool results and saves it. Never re-sends content.
- `src/lib/store.ts` — the **PublishTarget seam** (`list`/`save`) + `searchRelatedPosts()`. `SupabaseStore` when Supabase is configured, else `LocalJsonStore` (`data/blogs.json`). `save` embeds the post on write (Voyage) with a `content_hash` to avoid needless re-embeds.
- `src/lib/supabase.ts` — Supabase client + `isSupabaseConfigured()`.
- `src/lib/voyage.ts` — Voyage embeddings client (`voyage-3.5-lite`, 1024-dim) + `isVoyageConfigured()`. Stateless: text→vector; vectors live in Supabase (pgvector).
- `src/lib/conversations.ts` — conversation persistence (Supabase or `data/conversations/`), replacing the old in-memory session store. Full Anthropic-format history (incl. tool_use/tool_result blocks).
- `src/lib/usage.ts` — per-turn token usage + cost (`usage_log` table or `data/usage.json`); model pricing table.
- `src/app/page.tsx` — chat UI + live "Site collection" panel + cost readout. Renders the inline `draft` preview (proposed, pre-publish).
- `supabase/*.sql` — schema migrations (blogs/conversations/usage_log; pgvector + `match_blogs`; `post_type`).

## Conventions

- Reference models only via `MODEL_CHAT` / `MODEL_WRITER` — never hardcode model strings elsewhere.
- New blog destinations go behind the `PublishTarget` interface in `store.ts`. New storage backends key off `isSupabaseConfigured()`.
- The model writes the article body **once**, inside `propose_blog_post`'s writer sub-call — never paste article text into chat, and `publish_blog_post` references the draft (don't re-emit content). This is a deliberate cost design.
- Conversation state lives server-side (`conversations.ts`); the client sends only `{ conversationId, message }`.
- Keep `SYSTEM_PROMPT` and `WRITER_SYSTEM` stable — prompt caching is applied to both.
- Duplicate detection is two-axis: **topic** (vector similarity, gray-area — calibrate, don't hard-gate) × **intent** (`post_type`: how-to | marketing | informational | opinion | news | personal). Same topic + same intent = redundant; same topic + different intent = fine, link internally.

## Cost (measured, real `usage_log`)

- One published blog ≈ **$0.093** (Haiku orchestrator + Sonnet writer + caching), down from $0.21 (original all-Sonnet, double-write).
- Embeddings (Voyage `voyage-3.5-lite`) are a rounding error (~$0.00003/post; free under 200M tokens). Free-tier rate limit is 3 req/min — batch bulk embeds.

## Current state / deferred

- **No image generation yet** — posts carry a text `featuredImagePrompt` only.
- **SEO data captured, not yet emitted as pages** — title/excerpt/slug/tags exist as fields, but there's no rendered crawlable page emitting `<head>` meta / OpenGraph / JSON-LD. That's the page-level SEO work, tied to connecting the real rendered site.
- **loop_asia integration is deferred** — publish target is local/Supabase for now; priority is blog-writing quality + cost.
- **Cheaper-writer A/B (open):** evaluating Kimi K2.6 / DeepSeek (via OpenRouter, US-hosted to avoid China data-residency) as a possible `MODEL_WRITER` replacement — gated on Japanese writing quality, tested on real prompts.
- Design notes from earlier framing live in `docs/` (some still mention WordPress).
