import type { NextRequest } from "next/server";
import { store } from "@/lib/store";
import type { NewBlogPost } from "@/lib/types";
import { getSessionUser, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Publish a fully-assembled post (draft body with the user's images already merged
// in, plus the chosen featured image). This is intentionally a NO-MODEL path: the
// article was written once inside propose_blog_post; publishing is a pure copy +
// the images the user placed, so it adds zero API cost. Auth-guarded.
export async function POST(req: NextRequest) {
  if (!getSessionUser()) return unauthorized();

  const b = await req.json().catch(() => null);
  if (!b || typeof b.title !== "string" || typeof b.content !== "string") {
    return Response.json({ error: "公開する内容が不正です。" }, { status: 400 });
  }

  const post: NewBlogPost = {
    title: b.title,
    slug: String(b.slug ?? "").trim(),
    excerpt: String(b.excerpt ?? ""),
    content: b.content,
    category: String(b.category ?? ""),
    tags: Array.isArray(b.tags) ? b.tags.map(String) : [],
    featuredImagePrompt: String(b.featuredImagePrompt ?? ""),
    featuredImageUrl: b.featuredImageUrl ? String(b.featuredImageUrl) : undefined,
    postType: b.postType ? String(b.postType) : undefined,
  };

  try {
    const saved = await store.save(post);
    return Response.json(saved);
  } catch (e) {
    return Response.json(
      { error: `公開に失敗しました: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
