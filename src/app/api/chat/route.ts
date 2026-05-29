import type { NextRequest } from "next/server";
import { getClient, MODEL, MAX_TOKENS } from "@/lib/anthropic";
import { SYSTEM_PROMPT } from "@/lib/systemPrompt";
import { tools, runTool } from "@/lib/tools";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { sessionId, message } = await req.json();
  const messages = getSession(sessionId);
  messages.push({ role: "user", content: message });

  const client = getClient();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      try {
        // Manual agentic loop: keep going until Claude stops calling tools.
        while (true) {
          const ms = client.messages.stream({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            // System prompt + tools form a stable, cacheable prefix.
            system: [
              { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
            ],
            tools: tools as any,
            messages,
          });

          ms.on("text", (delta: string) => emit({ type: "text", text: delta }));

          const msg = await ms.finalMessage();
          // Append the full assistant turn (text + tool_use blocks) to history.
          messages.push({ role: "assistant", content: msg.content });

          if (msg.stop_reason !== "tool_use") break;

          const toolResults: any[] = [];
          for (const block of msg.content) {
            if (block.type === "tool_use") {
              emit({ type: "tool", name: block.name });
              const result = await runTool(block.name, block.input, emit);
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: result.content,
                is_error: result.isError,
              });
            }
          }
          messages.push({ role: "user", content: toolResults });
        }

        emit({ type: "done" });
      } catch (err: any) {
        emit({ type: "error", message: err?.message ?? String(err) });
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
