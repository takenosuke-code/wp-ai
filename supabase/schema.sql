-- Supabase schema for WP_AI.
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query).
-- After running it, set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env and
-- restart the dev server; storage automatically switches from local JSON to Supabase.

create extension if not exists pgcrypto;

-- Published blog posts
create table if not exists blogs (
  id                    uuid primary key default gen_random_uuid(),
  title                 text not null,
  slug                  text not null,
  excerpt               text,
  content               text,
  category              text,
  tags                  text[] default '{}',
  featured_image_prompt text,
  created_at            timestamptz not null default now()
);

-- Chat conversations (full Anthropic-format message history in JSONB)
create table if not exists conversations (
  id         uuid primary key,
  title      text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  messages   jsonb not null default '[]'::jsonb
);
create index if not exists conversations_updated_at_idx on conversations (updated_at desc);

-- Per-turn token usage + cost
create table if not exists usage_log (
  id                    bigserial primary key,
  conversation_id       uuid,
  model                 text,
  input_tokens          int default 0,
  output_tokens         int default 0,
  cache_read_tokens     int default 0,
  cache_creation_tokens int default 0,
  cost                  numeric(12, 6) default 0,
  created_at            timestamptz not null default now()
);
create index if not exists usage_log_created_at_idx on usage_log (created_at desc);

-- Note: access is server-side via the service role key, so RLS is not required
-- for this single-tenant setup. Add RLS + per-user policies when you move to
-- multi-user with the anon key on the client.
