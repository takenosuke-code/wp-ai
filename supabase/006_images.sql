-- 006_images.sql — featured image URL + public storage bucket for uploaded photos.
-- Run in the Supabase SQL editor (Dashboard → SQL → New query) after 005_auth.sql.

-- Store the public URL of a post's featured image (the first image the user places
-- in the draft). Inline body images are embedded directly in `content` as Markdown.
alter table blogs add column if not exists featured_image_url text;

-- Public bucket that holds uploaded blog photos. Public so loop_asia (anon key) and
-- the article pages can render <img src> directly. Uploads happen server-side with the
-- service role (which bypasses RLS), so only authenticated app users can write.
insert into storage.buckets (id, name, public)
values ('blog-images', 'blog-images', true)
on conflict (id) do update set public = true;

-- Anyone may READ objects in this bucket (it backs public <img> tags). Writes/deletes
-- are not granted to anon/authenticated here — they go through the service role only.
drop policy if exists "blog-images public read" on storage.objects;
create policy "blog-images public read"
  on storage.objects for select
  to public
  using (bucket_id = 'blog-images');
