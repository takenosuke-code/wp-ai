import { promises as fs } from "fs";
import path from "path";
import { randomUUID, createHash } from "crypto";
import type { BlogPost, NewBlogPost } from "./types";
import { isSupabaseConfigured, getSupabase } from "./supabase";
import {
  isVoyageConfigured,
  embedDocument,
  embedQuery,
  postEmbeddingText,
} from "./voyage";

export interface RelatedPost {
  title: string;
  slug: string;
  excerpt: string;
  category: string;
  tags: string[];
  postType?: string; // intent/format axis for the topic×intent duplicate check
  createdAt: string;
  similarity?: number; // 0–1 cosine similarity when semantic search is used
}

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * PublishTarget is the seam between the AI and wherever posts actually live.
 * Uses Supabase when configured, otherwise a local JSON file.
 */
export interface PublishTarget {
  list(): Promise<BlogPost[]>;
  save(post: NewBlogPost): Promise<BlogPost>;
}

const DATA_FILE = path.join(process.cwd(), "data", "blogs.json");

class LocalJsonStore implements PublishTarget {
  async list(): Promise<BlogPost[]> {
    try {
      return JSON.parse(await fs.readFile(DATA_FILE, "utf8")) as BlogPost[];
    } catch {
      return [];
    }
  }

  async save(input: NewBlogPost): Promise<BlogPost> {
    const posts = await this.list();
    const now = new Date().toISOString();
    const post: BlogPost = {
      ...input,
      tags: input.tags ?? [],
      id: randomUUID(),
      createdAt: now,
      publishAt: input.publishAt ?? now,
    };
    posts.unshift(post);
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(posts, null, 2), "utf8");
    return post;
  }
}

function rowToBlog(r: any): BlogPost {
  return {
    id: r.id,
    title: r.title,
    slug: r.slug,
    excerpt: r.excerpt ?? "",
    content: r.content ?? "",
    category: r.category ?? "",
    tags: r.tags ?? [],
    featuredImagePrompt: r.featured_image_prompt ?? "",
    featuredImageUrl: r.featured_image_url ?? "",
    postType: r.post_type ?? "",
    createdAt: r.created_at,
    publishAt: r.publish_at ?? r.created_at,
  };
}

class SupabaseStore implements PublishTarget {
  async list(): Promise<BlogPost[]> {
    const { data, error } = await getSupabase()
      .from("blogs")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(rowToBlog);
  }

  async save(input: NewBlogPost): Promise<BlogPost> {
    // Embed at write time so the post is immediately searchable. Best-effort:
    // if embedding fails (rate limit, key issue) we still publish the post.
    let embedding: string | null = null;
    let content_hash: string | null = null;
    if (isVoyageConfigured()) {
      try {
        const text = postEmbeddingText(input.title, input.content);
        content_hash = contentHash(text);
        // pgvector accepts its text form '[1,2,3]', which is JSON of the array.
        embedding = JSON.stringify(await embedDocument(text));
      } catch (e) {
        console.error("embedding failed (publishing without it):", (e as Error).message);
      }
    }

    const { data, error } = await getSupabase()
      .from("blogs")
      .insert({
        title: input.title,
        slug: input.slug,
        excerpt: input.excerpt,
        content: input.content,
        category: input.category,
        tags: input.tags ?? [],
        featured_image_prompt: input.featuredImagePrompt,
        featured_image_url: input.featuredImageUrl ?? null,
        post_type: input.postType ?? null,
        publish_at: input.publishAt ?? new Date().toISOString(),
        embedding,
        content_hash,
      })
      .select()
      .single();
    if (error) throw error;
    return rowToBlog(data);
  }
}

export const store: PublishTarget = isSupabaseConfigured()
  ? new SupabaseStore()
  : new LocalJsonStore();

/**
 * Find posts related to a topic. With Supabase + Voyage it's true semantic
 * (vector) search via the match_blogs RPC — so grounding cost stays flat as the
 * site grows instead of dumping every post into the model's context. Without
 * them it falls back to a naive keyword scan over the (small) local store.
 */
export async function searchRelatedPosts(query: string, k = 8): Promise<RelatedPost[]> {
  if (isSupabaseConfigured() && isVoyageConfigured()) {
    try {
      const queryEmbedding = JSON.stringify(await embedQuery(query));
      const { data, error } = await getSupabase().rpc("match_blogs", {
        query_embedding: queryEmbedding,
        match_count: k,
      });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        title: r.title,
        slug: r.slug,
        excerpt: r.excerpt ?? "",
        category: r.category ?? "",
        tags: r.tags ?? [],
        postType: r.post_type ?? "",
        createdAt: r.created_at,
        similarity: typeof r.similarity === "number" ? r.similarity : undefined,
      }));
    } catch (e) {
      console.error("semantic search failed, falling back to keyword:", (e as Error).message);
    }
  }

  // Fallback: keyword overlap over all posts (fine at small scale / local dev).
  const all = await store.list();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = all.map((p) => {
    const hay = `${p.title} ${p.excerpt} ${p.category} ${p.tags.join(" ")}`.toLowerCase();
    const score = terms.reduce((s, t) => (hay.includes(t) ? s + 1 : s), 0);
    return { p, score };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ p }) => ({
      title: p.title,
      slug: p.slug,
      excerpt: p.excerpt,
      category: p.category,
      tags: p.tags,
      postType: p.postType ?? "",
      createdAt: p.createdAt,
    }));
}
