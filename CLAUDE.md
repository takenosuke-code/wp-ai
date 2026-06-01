# WP_AI — AI Blog Assistant

A chat app where a user converses with an AI that **creates and publishes blog posts through chat** — it takes real actions via tool calls, not copy-paste. Built on the Anthropic Claude API. Published posts are read live by the client site (loop_asia). **Current focus: maximizing blog quality and virality (Japanese market) at a low, profitable per-blog API cost.**

## Run

- Node 18.17+.
- Copy `.env.local.example` → `.env`. **Required:** `ANTHROPIC_API_KEY`, `AUTH_SECRET` (session signing). Restart the dev server after editing `.env`.
- Storage + features (set for the full app):
  - `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — when BOTH set, storage switches from local JSON to Supabase. **Secret, server-only** — never expose service_role to the browser.
  - `SUPABASE_ANON_PUBLIC_KEY` — the public/publishable key. Used by the client site (loop_asia) for read-only access; **safe to expose** (protected by RLS).
  - `VOYAGE_API_KEY` — enables semantic search (embeddings); without it, grounding falls back to keyword search.
  - `SUPABASE_URI` — direct Postgres connection string, for running migrations only (not used by the app).
  - `OPENROUTER_API_KEY` — only for the writer A/B scripts (Kimi/DeepSeek eval), not the app.
- `npm install` → `npm run dev` → http://localhost:3000. `npm run build` for production.
- **DB schema:** run `supabase/*.sql` in order (`schema.sql`, `002_embeddings.sql`, `003_post_type.sql`, `004_rls.sql`, `005_auth.sql`, `006_images.sql`) in the Supabase **SQL Editor**. DDL is not run by the app. `006_images.sql` adds `blogs.featured_image_url` AND creates the public `blog-images` storage bucket (required for photo upload).
- **Auth bootstrap:** after `005`, add yourself: `node scripts/add-user.mjs <email> <password> [name]`. Only allowlisted users can log in.
- **Deploying:** WP_AI runs server-side — set all secrets (`AUTH_SECRET`, `ANTHROPIC_API_KEY`, `SUPABASE_*`, `VOYAGE_API_KEY`) as host env vars (e.g. Vercel project settings). `.env` does not ship.

## Architecture (Next.js 14 App Router + TypeScript)

**Two-model split (cost-to-performance):** a cheap model orchestrates the whole conversation; the premium model is invoked server-side *only* to write the article body — the one place quality drives virality/revenue.

- `src/lib/anthropic.ts` — Anthropic client + model constants. `MODEL_CHAT` (Haiku, orchestrator) and `MODEL_WRITER` (Sonnet, article writer). `MODEL` aliases `MODEL_CHAT` for pricing. **Change models here.** To revert to all-Sonnet set `MODEL_CHAT = MODEL_WRITER`.
- `src/app/api/chat/route.ts` — streaming, hand-written **agentic tool-use loop** (not LangChain), runs on `MODEL_CHAT`. Prompt caching on the system prompt + a rolling cache breakpoint on the conversation prefix (`withConversationCache`). Logs per-turn usage+cost. **Auth-guarded.**
- `src/lib/systemPrompt.ts` — `SYSTEM_PROMPT` (orchestrator's guided flow: goal → angle → outline → propose → SEO check → user adds images & publishes), `WRITER_SYSTEM` (writer sub-call; owns `BLOG_PLAYBOOK`, outputs strict `<TITLE>/<EXCERPT>/<BODY>`), and `SEO_ANALYST_SYSTEM` (SEO/competitor sub-call; uses web search; outputs strict `<SEO_JSON>`).
- `src/lib/blogContext.ts` — `BLOG_PLAYBOOK`: fact-checked Japanese viral/SEO writing guidance for the writer.
- `src/lib/tools.ts` — tools:
  - `list_existing_posts` — full inventory.
  - `search_existing_posts(query)` — **semantic** (vector) search for the topic×intent duplicate check + internal links.
  - `propose_blog_post(brief)` — takes a BRIEF (goal, post_type, topic, angle, audience, outline, key_points, metadata), calls `MODEL_WRITER` server-side to expand it into the article, emits a `draft` preview. Does NOT publish. Re-call with `revision_note` to revise. **Article written once here.**
  - `seo_analyze(keyword)` — SEO optimization + competitor analysis for the current draft. Runs a sub-call on `MODEL_CHAT` **with the Anthropic web-search server tool** (`web_search_20250305`, capped `max_uses`) to find the REAL top-ranking articles; pulls the draft body itself (no article text passed in), parses `<SEO_JSON>`, emits an `seo` report event (score / checklist / keyword candidates / real competitors / recommendation). Logs its cost separately. Search volumes/difficulty are Claude estimates (labeled); competitor data is real.
  - **No publish tool.** Publishing moved to the client (see `/api/publish`) so the user can place images first — a draft is written once and published with **zero** extra model calls.
- `src/lib/store.ts` — **PublishTarget seam** (`list`/`save`) + `searchRelatedPosts()`. `SupabaseStore` when configured, else `LocalJsonStore`. `save` embeds the post (Voyage) with a `content_hash` to skip needless re-embeds.
- `src/lib/voyage.ts` — Voyage embeddings (`voyage-3.5-lite`, 1024-dim). Stateless: text→vector; vectors live in Supabase pgvector.
- `src/lib/conversations.ts` — conversation persistence (Supabase or `data/conversations/`). Full Anthropic-format history.
- `src/lib/usage.ts` — per-turn token usage + cost (`usage_log` / `data/usage.json`).
- `src/lib/supabase.ts` — Supabase client + `isSupabaseConfigured()`.
- `src/lib/auth.ts` — scrypt password hashing, HMAC-signed httpOnly session cookie (`wpai_session`), `getSessionUser()`, `unauthorized()`, `authorized_users` allowlist lookup. Needs `AUTH_SECRET`.
- `src/app/api/auth/{login,logout,me}/route.ts` — email+password login against the allowlist; set/clear the session cookie.
- `src/app/api/upload/route.ts` — **auth-guarded** image upload to the public `blog-images` Supabase Storage bucket; returns the public URL. No model involved.
- `src/app/api/publish/route.ts` — **auth-guarded** no-model publish. Takes a fully-assembled post (draft body with the user's images merged in as Markdown + `featuredImageUrl`) and saves it via `store.save`. This is the ONLY publish path now (the model never publishes).
- `src/app/page.tsx` — chat UI + live "Site collection" panel + **8-step progress bar** (`StepBar`, driven by `step` events from the chat route + local actions) + interactive `draft` preview (`DraftCard`: per-section dashed **+** image slots → `/api/upload`; assembles final Markdown and publishes via `/api/publish` with a confirm step) + **SEO/competitor report card** (`SeoCard`, 4 cards). `renderMarkdown` supports images (`![]()`, scheme-validated + quote-escaped to avoid attribute breakout). **Login gate**. "Powered by NortiqLabs" badge.
- `supabase/*.sql` — migrations (see Run).

## Publishing → loop_asia (live)

Published posts go to Supabase `blogs`. The client site **loop_asia** (separate repo `rentaoshima100-rgb/loop_asia` — a static Babel-in-browser React site on Vercel) reads them **client-side** via the public anon key (read-only, RLS-gated) and renders them in its お知らせ/NEWS list + detail page. Publish in chat → appears on the live site, no redeploy. loop_asia's `data.jsx` holds the Supabase client + `useNews()` hook + a safe (escape-first) Markdown renderer.

**⚠️ SEO caveat (important):** loop_asia's news is **client-rendered with hash routing** (`#news-detail=N`). Posts display to humans but are **NOT individually discoverable in Google** — no per-post URL (hash fragments aren't indexed), JS-fetched content, and no per-post `<title>`/meta/OpenGraph/JSON-LD/sitemap. See "Deferred".

## Security / RLS / auth

- **Every API route is auth-guarded** (`chat`, `conversations`, `usage`, `blogs`): `if (!getSessionUser()) return unauthorized()` → 401 without a valid session. A leaked URL can't chat or publish.
- **Allowlist:** only emails in `authorized_users` can log in. Add: `scripts/add-user.mjs`. Revoke: delete the row.
- **RLS:** all tables have RLS enabled. Anon (public) key can **SELECT `blogs` only** (for loop_asia); `conversations`, `usage_log`, `authorized_users` are anon-denied. Server uses `service_role` (bypasses RLS).
- **Key hygiene:** `service_role` / `ANTHROPIC_API_KEY` / `AUTH_SECRET` = secret, server-only. `SUPABASE_ANON_PUBLIC_KEY` = public by design (shipped in loop_asia), safe because of RLS. Changing `AUTH_SECRET` invalidates all sessions.

## Conventions

- Reference models only via `MODEL_CHAT` / `MODEL_WRITER` — never hardcode model strings.
- New blog destinations go behind the `PublishTarget` interface in `store.ts`; storage backends key off `isSupabaseConfigured()`.
- The article body is written **once**, inside `propose_blog_post`'s writer sub-call — never paste article text into chat. Publishing is client-side (`/api/publish`) and re-uses that exact body + the user's images — **no second model call**. Adding images costs zero API. Keep it this way: image/publish work must never round-trip through the model.
- Images: the draft is split by heading into sections client-side; each section gets a **+** slot. Unused slots collapse. On publish the client interleaves `![alt](url)` after each section and sets `featuredImageUrl` to the first image. Inline images live in `content`; the featured URL is a column.
- Conversation state lives server-side (`conversations.ts`); the client sends only `{ conversationId, message }`.
- Keep `SYSTEM_PROMPT` and `WRITER_SYSTEM` stable — prompt caching applies to both.
- Duplicate detection is two-axis: **topic** (vector similarity — gray-area, calibrate, don't hard-gate) × **intent** (`post_type`: how-to | marketing | informational | opinion | news | personal). Same topic + same intent = redundant; same topic + different intent = fine, link internally.
- Guard every new API route with `getSessionUser()`/`unauthorized()`.

## Cost (measured, real `usage_log`)

- One published blog ≈ **$0.093** (Haiku orchestrator + Sonnet writer + caching), down from $0.21. Realistic blended with chatting/revisions ≈ **$0.14/blog (~7 blogs/$1)**. Chat turns are cheap (Haiku + cache); **revisions are the cost lever** (each re-runs the Sonnet writer), not chat volume.
- Embeddings (Voyage) are a rounding error (~$0.00003/post; free under 200M tokens; 3 req/min free-tier — batch bulk embeds).
- **SEO/competitor check (`seo_analyze`)** is opt-in per draft and adds cost only when run: Haiku tokens + Anthropic **web search** (~$10/1k searches, capped at `max_uses: 4`) ≈ a few cents per analysis. **Images add $0** (storage only).
- **Writer model decided: kept Sonnet.** Kimi K2.6 (OpenRouter) was ~2.6× cheaper but truncated 4/5 articles (reasoning-token overhead) + 90–360s latency → not viable. Re-test only with a non-thinking variant / higher token cap. See `scripts/writer-*.mjs`.

## Scripts (dev/admin, not app runtime)

- `scripts/add-user.mjs <email> <pw> [name]` — add/update an authorized user.
- `scripts/backfill-embeddings.mjs` — embed existing posts (one batched Voyage call).
- `scripts/cost-test.mjs`, `writer-ab.mjs`, `writer-batch*.mjs` — cost/quality harnesses (the Sonnet-vs-Kimi A/B). `writer-comparison*.md` are their outputs.

## Deferred / next

- **SEO pages are the biggest gap.** Posts display on loop_asia but aren't search-discoverable. The fix = **SSR `/blog/[slug]` pages in this Next.js app** (real URLs + `generateMetadata` title/description/OpenGraph + JSON-LD Article + `sitemap.ts`/robots), **public** (not behind auth), reading the same Supabase `blogs`. Then loop_asia's お知らせ links to those real URLs. Domain decision pending: serve under loopasia.com (builds the co-op's authority — needs a Vercel rewrite/subdomain) vs a WP_AI subdomain.
- **loop_asia image rendering** — published posts now embed `![alt](url)` images in `content` and carry `featured_image_url`. loop_asia's `data.jsx` Markdown renderer must support `<img>` (escape-first, like WP_AI's `renderMarkdown`) and ideally show the featured image as a hero/card thumbnail. Until then loop_asia will show image alt text but not the images.
- **No AI image *generation* yet** — `featuredImagePrompt` is still a text idea; actual photos are now user-uploaded. Generated images remain a future lever.
- Design notes from earlier framing live in `docs/` (some still mention WordPress).
