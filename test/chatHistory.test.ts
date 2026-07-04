import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeHistory, withConversationCache, toBlocks } from "../src/lib/chatHistory.ts";

// Assert the output satisfies the Anthropic Messages invariants that, when
// violated, produced the "JSON error" (400) that bricked conversations.
function assertValid(messages: any[]) {
  // First message must be from the user.
  if (messages.length) assert.equal(messages[0].role, "user", "first message must be user");
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    // No empty content arrays.
    assert.ok(Array.isArray(m.content) && m.content.length > 0, "no empty content");
    // Roles must strictly alternate.
    if (i > 0) assert.notEqual(m.role, messages[i - 1].role, "roles alternate");
    // Every assistant tool_use is answered by a tool_result in the next message.
    if (m.role === "assistant") {
      const ids = m.content.filter((b: any) => b?.type === "tool_use").map((b: any) => b.id);
      if (ids.length) {
        const next = messages[i + 1];
        assert.ok(next && next.role === "user", "tool_use must be followed by a user turn");
        const answered = new Set(
          next.content.filter((b: any) => b?.type === "tool_result").map((b: any) => b.tool_use_id)
        );
        for (const id of ids) assert.ok(answered.has(id), `tool_use ${id} answered`);
      }
    }
  }
}

test("toBlocks: string → text block, empty string → nothing", () => {
  assert.deepEqual(toBlocks("hi"), [{ type: "text", text: "hi" }]);
  assert.deepEqual(toBlocks("   "), []);
  assert.deepEqual(toBlocks([{ type: "text", text: "x" }, null]), [{ type: "text", text: "x" }]);
  assert.deepEqual(toBlocks(undefined), []);
});

test("clean conversation is preserved and valid", () => {
  const conv = [
    { role: "user", content: "こんにちは" },
    { role: "assistant", content: [{ type: "text", text: "どんな記事にしますか？" }] },
    { role: "user", content: "在宅勤務について" },
  ];
  const out = sanitizeHistory(conv);
  assertValid(out);
  assert.equal(out.length, 3);
  // idempotent
  assertValid(sanitizeHistory(out));
});

test("REGRESSION: dangling tool_use at end gets a synthetic tool_result", () => {
  // This is exactly the corrupted shape the crash persisted.
  const conv = [
    { role: "user", content: "書いて" },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "search_existing_posts", input: {} }] },
  ];
  const out = sanitizeHistory(conv);
  assertValid(out);
  const last = out[out.length - 1];
  assert.equal(last.role, "user");
  assert.equal(last.content[0].type, "tool_result");
  assert.equal(last.content[0].tool_use_id, "t1");
  assert.equal(last.content[0].is_error, true);
});

test("REGRESSION: dangling tool_use followed by a new user message → merged, tool_result first", () => {
  // What happens on the NEXT send after corruption: a user string is appended.
  const conv = [
    { role: "user", content: "書いて" },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "list_existing_posts", input: {} }] },
    { role: "user", content: "やっぱり公開して" },
  ];
  const out = sanitizeHistory(conv);
  assertValid(out);
  // The synthetic tool_result and the user's text collapse into ONE user turn,
  // with the tool_result first (never two user turns in a row → no 400).
  const userTurn = out[out.length - 1];
  assert.equal(userTurn.role, "user");
  assert.equal(userTurn.content[0].type, "tool_result");
  assert.ok(userTurn.content.some((b: any) => b.type === "text" && /公開/.test(b.text)));
});

test("properly answered tool_use is left alone (no double injection)", () => {
  const conv = [
    { role: "user", content: "書いて" },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "x", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
    { role: "assistant", content: [{ type: "text", text: "できました" }] },
  ];
  const out = sanitizeHistory(conv);
  assertValid(out);
  assert.equal(out.length, 4);
  // Exactly one tool_result for t1.
  const results = out.flatMap((m: any) => m.content).filter((b: any) => b?.type === "tool_result");
  assert.equal(results.length, 1);
});

test("empty content messages are dropped", () => {
  const conv = [
    { role: "user", content: "hi" },
    { role: "assistant", content: [] },
    { role: "assistant", content: [{ type: "text", text: "回答" }] },
  ];
  const out = sanitizeHistory(conv);
  assertValid(out);
  assert.equal(out.length, 2);
});

test("leading assistant messages are dropped", () => {
  const conv = [
    { role: "assistant", content: [{ type: "text", text: "先に喋った" }] },
    { role: "user", content: "hi" },
  ];
  const out = sanitizeHistory(conv);
  assertValid(out);
  assert.equal(out[0].role, "user");
});

test("consecutive same-role messages are merged", () => {
  const conv = [
    { role: "user", content: "a" },
    { role: "user", content: "b" },
    { role: "assistant", content: [{ type: "text", text: "c" }] },
  ];
  const out = sanitizeHistory(conv);
  assertValid(out);
  assert.equal(out.length, 2);
  assert.equal(out[0].content.length, 2);
});

test("non-array / garbage input is safe", () => {
  assert.deepEqual(sanitizeHistory(null as any), []);
  assert.deepEqual(sanitizeHistory(undefined as any), []);
  assert.deepEqual(sanitizeHistory([{ role: "system", content: "x" } as any]), []);
});

test("withConversationCache: adds cache_control to the last block", () => {
  const msgs = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
  const out = withConversationCache(msgs);
  assert.deepEqual(out[0].content[0].cache_control, { type: "ephemeral" });
  // input not mutated
  assert.equal((msgs[0].content[0] as any).cache_control, undefined);
});

test("withConversationCache: string content is wrapped into a text block", () => {
  const out = withConversationCache([{ role: "user", content: "hi" }]);
  assert.equal(out[0].content[0].type, "text");
  assert.deepEqual(out[0].content[0].cache_control, { type: "ephemeral" });
});

test("withConversationCache: empty content array never yields a typeless block", () => {
  const out = withConversationCache([{ role: "user", content: [] }]);
  // No cache_control-only block was created.
  assert.equal(out[0].content.length, 0);
  assert.equal(out.length, 1);
});

test("withConversationCache: empty history returned as-is", () => {
  assert.deepEqual(withConversationCache([]), []);
});
