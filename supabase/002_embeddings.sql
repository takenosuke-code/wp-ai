-- Migration 002: semantic search over blog posts (pgvector + Voyage embeddings).
-- Run after schema.sql. Safe to re-run (idempotent).
--
-- Voyage `voyage-3.5-lite` outputs 1024-dim vectors. If you ever switch to
-- voyage-multimodal-3 (also 1024) the column stays the same — just re-embed.

create extension if not exists vector;

-- One embedding per post + a hash of the text we embedded, so we only re-embed
-- when the title/content actually changes (embeddings cost money + rate limits).
alter table blogs add column if not exists embedding   vector(1024);
alter table blogs add column if not exists content_hash text;

-- At single-blog scale exact search is fine; HNSW makes it sub-linear once the
-- collection grows. cosine distance (<=>) matches how Voyage vectors compare.
create index if not exists blogs_embedding_idx
  on blogs using hnsw (embedding vector_cosine_ops);

-- Top-k semantic search. Returns posts most similar to a query embedding,
-- skipping any post not yet embedded. similarity = 1 - cosine_distance (1=identical).
create or replace function match_blogs(
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
  created_at timestamptz,
  similarity float
)
language sql stable as $$
  select b.id, b.title, b.slug, b.excerpt, b.category, b.tags, b.created_at,
         1 - (b.embedding <=> query_embedding) as similarity
  from blogs b
  where b.embedding is not null
  order by b.embedding <=> query_embedding
  limit match_count;
$$;
