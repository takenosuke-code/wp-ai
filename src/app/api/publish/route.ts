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
    // §07 schedule: ISO (UTC) instant; only accept a valid future-or-now date,
    // else publish immediately. Guards against bad/past client input.
    publishAt:
      typeof b.publishAt === "string" && !Number.isNaN(Date.parse(b.publishAt))
        ? new Date(b.publishAt).toISOString()
        : undefined,
  };

  try {
    const saved = await store.save(post);
    return Response.json(saved);
  } catch (e) {
    // Log the detail server-side only; don't leak internals (DB errors etc.) to the client.
    console.error("[publish] store.save failed:", e);
    return Response.json(
      { error: "公開に失敗しました。しばらく経ってから再度お試しください。" },
      { status: 500 }
    );
  }
}
