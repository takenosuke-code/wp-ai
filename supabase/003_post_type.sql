-- Migration 003: explicit intent/format axis for the topic×intent duplicate check.
-- Makes the "same topic AND same intent = redundant" rule deterministic instead
-- of inferred from category. post_type is one of:
--   how-to | marketing | informational | opinion | news | personal
-- Run in the Supabase SQL Editor. Required before publishing again (save writes
-- this column).

alter table blogs add column if not exists post_type text;

-- match_blogs return signature changes (adds post_type) → must drop & recreate.
drop function if exists match_blogs(vector, int);
create function match_blogs(
  query_embedding vector(1024),
  match_count int default 8
)
returns table (
  id         uuid,
  title      text,
  slug       text,
  excerpt    text,
  category   text,
  tags       text[],
  post_type  text,
  created_at timestamptz,
  similarity float
)
language sql stable as $$
  select b.id, b.title, b.slug, b.excerpt, b.category, b.tags, b.post_type, b.created_at,
         1 - (b.embedding <=> query_embedding) as similarity
  from blogs b
  where b.embedding is not null
  order by b.embedding <=> query_embedding
  limit match_count;
$$;
