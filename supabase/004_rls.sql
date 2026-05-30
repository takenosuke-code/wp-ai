-- Migration 004: lock down Row-Level Security before loop_asia reads `blogs`
-- with the PUBLIC anon key. Run in the Supabase SQL Editor.
--
-- Why: without RLS, an exposed anon key would make every public-schema table
-- readable AND writable by anyone. After this:
--   - anon (public / loop_asia)  → READ-ONLY on `blogs`, nothing else.
--   - service_role (WP_AI server) → unaffected (it bypasses RLS entirely).

alter table blogs        enable row level security;
alter table conversations enable row level security;
alter table usage_log    enable row level security;

-- Public read access to published blog posts (loop_asia's お知らせ feed).
-- SELECT only — anon cannot insert/update/delete.
drop policy if exists "public can read blogs" on blogs;
create policy "public can read blogs"
  on blogs
  for select
  to anon
  using (true);

-- conversations + usage_log: RLS enabled with NO anon policy → anon is denied.
-- WP_AI's server keeps full access because the service_role key bypasses RLS.
