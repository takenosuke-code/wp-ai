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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
          for (const block of msg.content) {
            if (block.type === "tool_use") {
              emit({ type: "tool", name: block.name });
              const result = await runTool(block.name, block.input, emit, { conversation: conv });
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: result.content,
                is_error: result.isError,
              });
            }
          }
          conv.messages.push({ role: "user", content: toolResults });
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
