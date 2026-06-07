-- Migration 007: scheduled publishing (§07 スケジュール). Run in the Supabase
-- SQL Editor (DDL is not run by the app).
--
-- How it works (no cron / background job needed): every post gets a `publish_at`
-- timestamp. The PUBLIC anon policy is tightened so loop_asia can only read rows
-- whose publish_at has already passed. A post scheduled for the future is simply
-- invisible to the anon key until its time arrives — Supabase enforces it at read
-- time. WP_AI keeps using service_role, so it still sees scheduled posts.
--
-- Timezone note: timestamptz stores an absolute instant in UTC, and now() is UTC,
-- so comparisons are correct regardless of the viewer's timezone. WP_AI converts
-- the user's chosen JST time to a UTC ISO string before saving.

alter table blogs
  add column if not exists publish_at timestamptz not null default now();

-- Backfill existing rows so nothing disappears from the live feed.
update blogs set publish_at = created_at where publish_at is null;

-- Helps the loop_asia feed query (order by publish_at desc, filter <= now()).
create index if not exists blogs_publish_at_idx on blogs (publish_at desc);

-- Replace the public read policy: anon sees only already-published posts.
drop policy if exists "public can read blogs" on blogs;
create policy "public can read blogs"
  on blogs
  for select
  to anon
  using (publish_at <= now());
