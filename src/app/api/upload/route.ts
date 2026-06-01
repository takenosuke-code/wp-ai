import type { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { getSessionUser, unauthorized } from "@/lib/auth";
import { isSupabaseConfigured, getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "blog-images";
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

// Image upload for blog photos. Auth-guarded; stores to the public Supabase
// `blog-images` bucket and returns the public URL. No model is involved — this
// is a plain file → storage round-trip, so adding images costs zero API tokens.
export async function POST(req: NextRequest) {
  if (!getSessionUser()) return unauthorized();
  if (!isSupabaseConfigured()) {
    return Response.json(
      { error: "画像アップロードには Supabase の設定が必要です。" },
      { status: 503 }
    );
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "ファイルが見つかりません。" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "画像は8MBまでです。" }, { status: 413 });
  }
  const ext = EXT[file.type];
  if (!ext) {
    return Response.json({ error: "対応していない画像形式です。" }, { status: 415 });
  }

  const path = `${new Date().getFullYear()}/${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const sb = getSupabase();
  const { error } = await sb.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: false });
  if (error) {
    const hint = /bucket/i.test(error.message)
      ? "（supabase/006_images.sql を実行して blog-images バケットを作成してください）"
      : "";
    return Response.json({ error: `アップロードに失敗しました${hint}` }, { status: 500 });
  }

  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  return Response.json({ url: data.publicUrl });
}
