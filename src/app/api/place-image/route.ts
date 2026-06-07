import type { NextRequest } from "next/server";
import { getClient, MODEL_CHAT } from "@/lib/anthropic";
import { computeCost, logUsage } from "@/lib/usage";
import { getSessionUser, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// §03 vision placement: given a draft's sections and ONE uploaded image (public
// URL), Claude (cheap model, with vision) decides which section the image best
// fits and writes an SEO-friendly Japanese alt text. Only called when the user
// actually adds an image — skipping images makes no call (zero cost).
export async function POST(req: NextRequest) {
  if (!getSessionUser()) return unauthorized();

  const { imageUrl, sections, title } = await req.json().catch(() => ({}));
  if (typeof imageUrl !== "string" || !/^https?:\/\//i.test(imageUrl)) {
    return Response.json({ error: "invalid imageUrl" }, { status: 400 });
  }
  const secs: string[] = Array.isArray(sections) ? sections.map((s) => String(s)) : [];
  if (secs.length === 0) {
    return Response.json({ error: "no sections" }, { status: 400 });
  }

  // Keep token cost low: send only a short summary of each section.
  const sectionList = secs
    .map((s, i) => `${i}: ${s.replace(/\s+/g, " ").slice(0, 120)}`)
    .join("\n");

  const system =
    "あなたは日本語ブログの編集者です。1枚の画像を、記事のどのセクションに置くと最も自然で読者の理解を助けるかを判断し、SEOを意識した簡潔な日本語のalt（代替テキスト、15〜40字）を作成します。" +
    "出力は次のタグで囲んだJSONだけにしてください（前後の説明は不要）:\n" +
    '<PLACE>{"section": 整数, "alt": "日本語のalt"}</PLACE>';

  const userText =
    (title ? `記事タイトル: ${title}\n\n` : "") +
    `セクション一覧（番号: 内容の冒頭）:\n${sectionList}\n\n` +
    `この画像に最も合うセクション番号（0〜${secs.length - 1}）と、SEOを意識した日本語のaltを返してください。`;

  try {
    const client = getClient();
    const resp = await client.messages.create({
      model: MODEL_CHAT,
      max_tokens: 300,
      system: [{ type: "text", text: system }],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image", source: { type: "url", url: imageUrl } } as any,
          ],
        },
      ],
    });

    const text = resp.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");

    // Log the vision call's cost (best-effort) so it shows in usage like the rest.
    const u: any = resp.usage ?? {};
    const usage = {
      input: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheCreation: u.cache_creation_input_tokens ?? 0,
    };
    logUsage({
      conversationId: "place-image",
      model: MODEL_CHAT,
      ...usage,
      cost: computeCost(MODEL_CHAT, usage),
      createdAt: new Date().toISOString(),
    }).catch(() => {});

    const m = text.match(/<PLACE>([\s\S]*?)<\/PLACE>/) ?? text.match(/\{[\s\S]*\}/);
    let section = 0;
    let alt = "";
    if (m) {
      try {
        const json = JSON.parse(m[1] ?? m[0]);
        section = Number.isFinite(json.section) ? Math.trunc(json.section) : 0;
        alt = typeof json.alt === "string" ? json.alt.trim() : "";
      } catch {
        /* fall through to defaults */
      }
    }
    section = Math.max(0, Math.min(secs.length - 1, section));
    return Response.json({ section, alt });
  } catch (e) {
    // Non-fatal: the client falls back to positional placement on failure.
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
