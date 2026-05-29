# AI Blog Assistant for WordPress — Overview

An AI chat assistant that writes and publishes WordPress blog posts. Unlike a generic
chatbot, it is grounded in the user's own site, so it improves content quality, SEO,
and works proactively instead of only reacting to prompts.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React (chat interface) |
| Backend | Node.js + TypeScript |
| AI (chat + actions) | Anthropic Claude API — Sonnet for writing, Haiku for cheap tasks, Opus only when needed |
| Embeddings | OpenAI `text-embedding-3-small` (or Voyage) — Claude has no embedding model |
| Database + vectors | Supabase (Postgres + pgvector) |
| Image generation | Flux 2 Pro API (featured images) |
| WordPress integration | WordPress REST API (Application Passwords auth) |

---

## Architecture

```
                          ┌───────────────────────┐
                          │   USER (chat)          │
                          └───────────┬───────────┘
                                      │  "write a post about X"
                                      ▼
       ┌────────────────────────────────────────────────────────┐
       │                 BACKEND (Node/TS)                        │
       │   Agent loop: Claude decides → calls a tool → repeats    │
       └───┬──────────────┬───────────────┬─────────────────┬────┘
           │              │               │                 │
           ▼              ▼               ▼                 ▼
    ┌────────────┐  ┌───────────┐  ┌──────────────┐  ┌──────────────┐
    │ CLAUDE API │  │ EMBEDDING │  │   SUPABASE    │  │  WORDPRESS   │
    │ chat +     │  │ model     │  │ Postgres +    │  │  REST API    │
    │ tool use   │  │ text→vec  │  │ pgvector      │  │  (publish)   │
    │ [prompt    │  └───────────┘  │               │  └──────────────┘
    │  cache]    │                 │  posts_index  │ ◄─ existing posts
    └────────────┘                 │  drafts       │    (cached + embedded)
                                    │  preferences  │ ◄─ brand voice
                                    │  sessions     │ ◄─ chat history
                                    │ [vector index]│
                                    └──────────────┘
```

The backend is the brain. Claude never touches WordPress directly — it asks the
backend to act ("create draft", "find related posts", "publish"). The backend runs the
action and returns the result. **The user confirms before anything is published.**

---

## The Main Idea

Make the AI **proactive** and make the output **higher quality and better for SEO** —
which a generic ChatGPT cannot do, because it has no live knowledge of the user's site.

Three concrete payoffs:

1. **Proactive** — it finds content gaps and suggests posts on its own, instead of
   waiting to be asked.
2. **Quality** — every new post is consistent with past posts (terminology, tone,
   facts) and reuses the site's own context.
3. **SEO** — it auto-links new posts to related existing posts (internal linking) and
   avoids writing two posts that compete for the same topic (cannibalization).

---

## How We Do It

### 1. Sync once, embed once
We copy the user's posts into Supabase and convert each one into a vector (a numeric
representation of its meaning). We only re-embed a post when it actually changes — so
we never pay to process the same content twice.

### 2. Top-k retrieval (the core technique)
When the AI needs context, we embed the request, search the vectors, and return only
the **k most relevant posts** (e.g. k = 8) — never the whole site.

```
"write about email deliverability"
        │
        ▼
   embed the request ─► vector search in Supabase ─► return 8 closest posts
        │                                                    │
        │                    NOT all 500 posts ──────────────┘
        ▼
   send only those 8 to Claude
```

This keeps cost flat: a blog with 50 posts and one with 5,000 posts cost the same per
message, because we always send ~8.

Those 8 results drive the quality and SEO behaviors:
- **Very similar match found** → "You already covered this in March — update it, or
  pick a new angle?" (avoids duplicates / cannibalization)
- **Related posts found** → write fresh, and link to them internally + stay consistent.
- **Nothing similar** → genuine gap, just write it.

### 3. Prompt caching
The instructions and tool definitions sent to Claude are identical every message.
Claude caches that block, making it ~90% cheaper on every turn after the first.

### 4. Proactive background job (no AI cost to run)
On a schedule, a plain SQL query counts posts per category and checks the last-post
date. Only when it finds a gap does it spend AI tokens to draft suggestions:

```
Daily: SQL counts posts per category ─► finds thin/empty topics
       checks "last post 3 weeks ago"
                    │
                    ▼
       THEN ask AI to draft 3 gap-filling ideas
                    │
                    ▼
       "You haven't posted in 3 weeks. Here are 3 topics your audience
        searches for that you haven't covered."
```

---

## Why It Beats "Just Use ChatGPT"

1. **It knows your site, live.** ChatGPT's knowledge of your blog is a manual file
   upload that goes stale the moment you publish again.
2. **It finishes the job.** Writes *and* publishes — correct formatting, image, SEO,
   scheduling. No copy-paste.
3. **It's proactive.** ChatGPT only acts when prompted; ours surfaces gaps on its own.
