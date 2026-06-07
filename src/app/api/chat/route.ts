import type { NextRequest } from "next/server";
import { getClient, MODEL_CHAT, MAX_TOKENS } from "@/lib/anthropic";
import { SYSTEM_PROMPT } from "@/lib/systemPrompt";
import { tools, runTool } from "@/lib/tools";
import {
  loadConversation,
  saveConversation,
  titleFrom,
  isValidId,
  type Conversation,
} from "@/lib/conversations";
import { computeCost, logUsage, type TurnUsage } from "@/lib/usage";
import { getSessionUser, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Map tool calls to the 8-step progress bar (see STEPS in page.tsx). The client
// fills in the steps it owns locally (draft shown → 画像, publish → 公開).
const STEP_BY_TOOL: Record<string, number> = {
  search_existing_posts: 3, // 構成・重複チェック
  propose_blog_post: 4, // AI下書き
  seo_analyze: 6, // SEOチェック
};

// Put a cache breakpoint on the last message so the whole conversation prefix is
// cached for the next turn (0.1× input on a hit). Returns a copy — never mutates
// the stored conversation. Pairs with the cached system prompt (2 breakpoints).
function withConversationCache(messages: any[]): any[] {
  if (messages.length === 0) return messages;
  const out = messages.slice();
  const last = out[out.length - 1];
  let blocks =
    typeof last.content === "string"
      ? [{ type: "text", text: last.content }]
      : last.content.slice();
  const lastBlock = { ...blocks[blocks.length - 1], cache_control: { type: "ephemeral" } };
  blocks = [...blocks.slice(0, -1), lastBlock];
  out[out.length - 1] = { ...last, content: blocks };
  return out;
}

export async function POST(req: NextRequest) {
  if (!getSessionUser()) return unauthorized();
  const { conversationId, message } = await req.json();
  if (!isValidId(conversationId)) {
    return new Response("invalid conversationId", { status: 400 });
  }

  const now = new Date().toISOString();
  const conv: Conversation =
    (await loadConversation(conversationId)) ??
    { id: conversationId, title: "", createdAt: now, updatedAt: now, messages: [] };

  conv.messages.push({ role: "user", content: message });

  const client = getClient();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      const turn: TurnUsage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

      try {
        // Manual agentic loop: keep going until Claude stops calling tools.
        while (true) {
          const ms = client.messages.stream({
            model: MODEL_CHAT,
            max_tokens: MAX_TOKENS,
            system: [
              { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
            ],
            tools: tools as any,
            messages: withConversationCache(conv.messages),
          });

          ms.on("text", (delta: string) => emit({ type: "text", text: delta }));

          const msg = await ms.finalMessage();
          conv.messages.push({ role: "assistant", content: msg.content });

          // Accumulate token usage across every model call in this turn.
          const u = msg.usage;
          turn.input += u?.input_tokens ?? 0;
          turn.output += u?.output_tokens ?? 0;
          turn.cacheRead += u?.cache_read_input_tokens ?? 0;
          turn.cacheCreation += u?.cache_creation_input_tokens ?? 0;

          if (msg.stop_reason !== "tool_use") break;

          const toolResults: any[] = [];
          let draftProduced = false;
          for (const block of msg.content) {
            if (block.type === "tool_use") {
              emit({ type: "tool", name: block.name });
              // Drive the top progress bar from real tool milestones (no extra cost).
              const step = STEP_BY_TOOL[block.name];
              if (step) emit({ type: "step", step });
              const result = await runTool(block.name, block.input, emit, { conversation: conv });
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: result.content,
                is_error: result.isError,
              });
              if (block.name === "propose_blog_post" && !result.isError) draftProduced = true;
            }
          }
          conv.messages.push({ role: "user", content: toolResults });

          // Cost optimization: once a draft exists, the live preview + a canned
          // follow-up cover the next steps. Skipping the extra orchestrator turn
          // here saves one MODEL_CHAT call per draft (the user's draft→publish path
          // makes zero further model calls). The synthetic assistant message keeps
          // the conversation well-formed for the next user turn.
          if (draftProduced) {
            const canned =
              "下書きができました。右の「ライブプレビュー」でご確認ください。" +
              "画像の追加や公開はプレビュー上で行えます。\n\n" +
              "[[OPTIONS]]\nSEOチェックをする\n内容を修正したい\n[[/OPTIONS]]";
            conv.messages.push({ role: "assistant", content: [{ type: "text", text: canned }] });
            emit({ type: "text", text: canned });
            break;
          }
        }

        // Persist the conversation after the turn completes.
        conv.updatedAt = new Date().toISOString();
        if (!conv.title) conv.title = titleFrom(conv.messages);
        await saveConversation(conv);

        // Log token usage + cost for this turn (best-effort).
        try {
          await logUsage({
            conversationId: conv.id,
            model: MODEL_CHAT,
            ...turn,
            cost: computeCost(MODEL_CHAT, turn),
            createdAt: new Date().toISOString(),
          });
        } catch {
          /* don't fail the response if logging fails */
        }

        emit({ type: "done" });
      } catch (err: any) {
        emit({ type: "error", message: err?.message ?? String(err) });
        // Best-effort persist so a partial turn isn't lost.
        try {
          conv.updatedAt = new Date().toISOString();
          if (!conv.title) conv.title = titleFrom(conv.messages);
          await saveConversation(conv);
        } catch {
          /* ignore */
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
