import { store, searchRelatedPosts } from "./store";
import type { Conversation } from "./conversations";
import { getClient, MODEL_CHAT, MODEL_WRITER, MAX_TOKENS } from "./anthropic";
import { WRITER_SYSTEM, SEO_ANALYST_SYSTEM } from "./systemPrompt";
import { computeCost, logUsage } from "./usage";

// Tool definitions handed to Claude. Custom (client-side) tools: plain JSON schema.
export const tools = [
  {
    name: "list_existing_posts",
    description:
      "List ALL blog posts that already exist on the site (no query). Use on a small site to survey every category/tag. For checking whether a specific topic is already covered, prefer search_existing_posts. Returns title, category, tags, excerpt, and date for each post.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "search_existing_posts",
    description:
      "Semantic search over existing posts: returns the posts most related in MEANING to a topic/query (not just keyword match), with a similarity score (0–1). Call this before drafting to check whether a similar post already exists (judge both topic AND intent overlap) and to find posts worth linking to internally. Scales as the site grows — it sends only the relevant posts.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The topic, angle, or title you're considering — what to find related posts for.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_blog_post",
    description:
      "Hand a BRIEF to the expert writer, who expands it into the finished article and shows the user a rendered preview. You do NOT write the article body — you provide the brief and metadata. Call again with a revision_note if the user wants changes. After the user approves the preview, call publish_blog_post (no arguments).",
    input_schema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "Purpose: marketing/SEO/authority/how-to/personal." },
        post_type: {
          type: "string",
          enum: ["how-to", "marketing", "informational", "opinion", "news", "personal"],
          description:
            "The post's intent/format. This is the INTENT axis of the duplicate check — set it to match the kind of post you're writing.",
        },
        topic: { type: "string", description: "The subject of the post." },
        angle: { type: "string", description: "The specific angle / unique take." },
        audience: { type: "string", description: "Who it's for (the target reader)." },
        outline: {
          type: "array",
          items: { type: "string" },
          description: "Agreed section headings, in order.",
        },
        key_points: {
          type: "array",
          items: { type: "string" },
          description: "Concrete facts, data, named examples, product details to include.",
        },
        slug: { type: "string", description: "URL-friendly slug: lowercase words separated by hyphens." },
        category: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        featured_image_prompt: {
          type: "string",
          description: "A prompt an image model could use to generate the featured image.",
        },
        revision_note: {
          type: "string",
          description: "Only when revising a previously proposed draft: exactly what to change.",
        },
      },
      required: ["goal", "post_type", "topic", "angle", "audience", "outline", "slug", "category", "tags", "featured_image_prompt"],
      additionalProperties: false,
    },
  },
  {
    name: "seo_analyze",
    description:
      "Run an SEO optimization + competitor analysis for the CURRENT draft (the last one you proposed). Uses real web search to find the actual top-ranking articles for the target keyword. Call this after a draft exists, when the user wants an SEOチェック・競合調査. Pass the single most important target keyword in Japanese — it pulls the draft body itself, so you do NOT pass the article text. Shows the user a report card; afterwards give a one-line takeaway.",
    input_schema: {
      type: "object",
      properties: {
        keyword: {
          type: "string",
          description: "The single primary target keyword for this post, in Japanese (e.g. 在宅勤務 集中力).",
        },
      },
      required: ["keyword"],
      additionalProperties: false,
    },
  },
];

export interface ToolResult {
  content: string;
  isError: boolean;
}

type Emit = (event: Record<string, unknown>) => void;
export interface ToolContext {
  conversation: Conversation;
}

interface DraftPost {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  category: string;
  tags: string[];
  featuredImagePrompt: string;
  postType?: string;
}

// Pull the most recently assembled draft back out of the conversation's tool
// results, so publish never needs the model to repeat the article content.
function latestDraft(conv: Conversation): DraftPost | null {
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    const m = conv.messages[i];
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    for (let j = m.content.length - 1; j >= 0; j--) {
      const block = m.content[j];
      if (block?.type !== "tool_result") continue;
      try {
        const text = typeof block.content === "string" ? block.content : "";
        const obj = JSON.parse(text);
        if (obj && obj.__draft) return obj.__draft as DraftPost;
      } catch {
        /* not a draft result */
      }
    }
  }
  return null;
}

function briefToText(input: any): string {
  const lines = [
    `目的: ${input.goal ?? ""}`,
    `トピック: ${input.topic ?? ""}`,
    `角度: ${input.angle ?? ""}`,
    `想定読者: ${input.audience ?? ""}`,
    `見出し構成:`,
    ...(input.outline ?? []).map((o: string) => `- ${o}`),
  ];
  if (input.key_points?.length) {
    lines.push("盛り込む具体的な要点:");
    lines.push(...input.key_points.map((k: string) => `- ${k}`));
  }
  return lines.join("\n");
}

// Parse the writer's strict tagged output.
function parseWriter(text: string, fallbackTitle: string): { title: string; excerpt: string; content: string } {
  const grab = (tag: string) => {
    const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
    return m ? m[1].trim() : "";
  };
  const title = grab("TITLE") || fallbackTitle;
  const excerpt = grab("EXCERPT");
  const content = grab("BODY") || text.trim(); // fallback: whole output as body
  return { title, excerpt, content };
}

// Parse the SEO analyst's tagged JSON output. Tolerant: prefers the <SEO_JSON>
// block, then falls back to the first {...} span, so a stray sentence around the
// JSON doesn't sink the whole report.
function parseSeoReport(text: string, fallbackKeyword: string): Record<string, any> | null {
  let raw = "";
  const tagged = text.match(/<SEO_JSON>([\s\S]*?)<\/SEO_JSON>/i);
  if (tagged) {
    raw = tagged[1].trim();
  } else {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) raw = text.slice(start, end + 1);
  }
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    return {
      score: typeof obj.score === "number" ? obj.score : 0,
      keyword: obj.keyword || fallbackKeyword,
      monthlySearches: obj.monthly_searches ?? "",
      competition: obj.competition ?? "",
      checks: Array.isArray(obj.checks) ? obj.checks : [],
      keywords: Array.isArray(obj.keywords) ? obj.keywords : [],
      competitors: Array.isArray(obj.competitors) ? obj.competitors : [],
      recommendation: obj.recommendation ?? "",
    };
  } catch {
    return null;
  }
}

export async function runTool(
  name: string,
  input: any,
  emit: Emit,
  ctx: ToolContext
): Promise<ToolResult> {
  if (name === "list_existing_posts") {
    const posts = await store.list();
    const summary = posts.map((p) => ({
      title: p.title,
      category: p.category,
      tags: p.tags,
      excerpt: p.excerpt,
      createdAt: p.createdAt,
    }));
    return { content: JSON.stringify(summary), isError: false };
  }

  if (name === "search_existing_posts") {
    const related = await searchRelatedPosts(String(input?.query ?? ""));
    return { content: JSON.stringify(related), isError: false };
  }

  if (name === "propose_blog_post") {
    // Expand the brief into the finished article using the premium writer model.
    // For revisions, feed the writer the previous draft + the change request.
    let userContent = briefToText(input);
    if (input.revision_note) {
      const prev = latestDraft(ctx.conversation);
      userContent +=
        `\n\n修正指示: ${input.revision_note}` +
        (prev ? `\n\n前回の下書き本文:\n${prev.content}` : "");
    }

    let writerText = "";
    try {
      const client = getClient();
      const resp = await client.messages.create({
        model: MODEL_WRITER,
        max_tokens: MAX_TOKENS,
        system: [{ type: "text", text: WRITER_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userContent }],
      });
      writerText = resp.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");

      // Log the writer sub-call's cost separately (it's the Sonnet spend).
      const u: any = resp.usage ?? {};
      const wu = {
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheCreation: u.cache_creation_input_tokens ?? 0,
      };
      await logUsage({
        conversationId: ctx.conversation.id,
        model: MODEL_WRITER,
        ...wu,
        cost: computeCost(MODEL_WRITER, wu),
        createdAt: new Date().toISOString(),
      }).catch(() => {});
    } catch (e) {
      return {
        content: `Writer failed to draft the post: ${(e as Error).message}. Tell the user and try again.`,
        isError: true,
      };
    }

    const parsed = parseWriter(writerText, input.topic ?? "");
    const draft: DraftPost = {
      title: parsed.title,
      slug: input.slug,
      excerpt: parsed.excerpt,
      content: parsed.content,
      category: input.category,
      tags: input.tags ?? [],
      featuredImagePrompt: input.featured_image_prompt,
      postType: input.post_type,
    };

    emit({ type: "draft", draft });
    // Persist the assembled draft in the tool result so publish can reference it.
    return {
      content: JSON.stringify({
        __draft: draft,
        note: "Draft preview shown to the user. Note the title in one short line and ask for approval; once approved call publish_blog_post (no arguments). For changes, call propose_blog_post again with a revision_note.",
      }),
      isError: false,
    };
  }

  if (name === "seo_analyze") {
    const draft = latestDraft(ctx.conversation);
    if (!draft) {
      return {
        content: "No proposed draft found. Propose a draft first, then run seo_analyze.",
        isError: true,
      };
    }
    const keyword = String(input?.keyword ?? "").trim() || draft.title;
    const userContent =
      `狙うキーワード: ${keyword}\n\n` +
      `ブログ下書きタイトル: ${draft.title}\n\n` +
      `ブログ下書き本文:\n${draft.content}`;

    let analystText = "";
    try {
      const client = getClient();
      const resp = await client.messages.create({
        model: MODEL_CHAT, // Haiku + web search keeps the analysis cheap; web supplies the facts.
        max_tokens: MAX_TOKENS,
        system: [{ type: "text", text: SEO_ANALYST_SYSTEM, cache_control: { type: "ephemeral" } }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 } as any],
        messages: [{ role: "user", content: userContent }],
      });
      analystText = resp.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");

      const u: any = resp.usage ?? {};
      const su = {
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheCreation: u.cache_creation_input_tokens ?? 0,
      };
      await logUsage({
        conversationId: ctx.conversation.id,
        model: MODEL_CHAT,
        ...su,
        cost: computeCost(MODEL_CHAT, su),
        createdAt: new Date().toISOString(),
      }).catch(() => {});
    } catch (e) {
      return {
        content: `SEO analysis failed: ${(e as Error).message}. Tell the user and offer to retry.`,
        isError: true,
      };
    }

    const report = parseSeoReport(analystText, keyword);
    if (!report) {
      return {
        content: "SEO analysis produced no parseable report. Tell the user and offer to retry.",
        isError: true,
      };
    }
    emit({ type: "seo", report });
    return {
      content: JSON.stringify({
        __seo: true,
        score: report.score,
        recommendation: report.recommendation,
        note: "SEO report card shown to the user. Give a ONE-line takeaway (score + biggest improvement) and offer to apply a concrete improvement as a revision if useful. Do not repeat the full report.",
      }),
      isError: false,
    };
  }

  return { content: `Unknown tool: ${name}`, isError: true };
}
