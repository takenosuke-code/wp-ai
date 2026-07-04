import { promises as fs } from "fs";
import path from "path";
import { isSupabaseConfigured, getSupabase } from "./supabase";

const DIR = path.join(process.cwd(), "data", "conversations");
const UUID = /^[0-9a-fA-F-]{36}$/;

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: any[]; // full Anthropic-format history (incl. tool_use / tool_result blocks)
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface DisplayMessage {
  role: "user" | "assistant";
  text: string;
}

export function isValidId(id: string): boolean {
  return typeof id === "string" && UUID.test(id);
}

function fileFor(id: string): string {
  if (!isValidId(id)) throw new Error("invalid conversation id");
  return path.join(DIR, `${id}.json`);
}

// ---------- public API (routes Supabase vs local) ----------

export async function loadConversation(id: string): Promise<Conversation | null> {
  if (!isValidId(id)) return null;
  if (isSupabaseConfigured()) {
    const { data, error } = await getSupabase()
      .from("conversations")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id,
      title: data.title ?? "",
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      messages: data.messages ?? [],
    };
  }
  try {
    return JSON.parse(await fs.readFile(fileFor(id), "utf8")) as Conversation;
  } catch {
    return null;
  }
}

export async function saveConversation(conv: Conversation): Promise<void> {
  if (isSupabaseConfigured()) {
    const { error } = await getSupabase().from("conversations").upsert({
      id: conv.id,
      title: conv.title,
      created_at: conv.createdAt,
      updated_at: conv.updatedAt,
      messages: conv.messages,
    });
    if (error) throw error;
    return;
  }
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(fileFor(conv.id), JSON.stringify(conv, null, 2), "utf8");
}

export async function deleteConversation(id: string): Promise<void> {
  if (!isValidId(id)) return;
  if (isSupabaseConfigured()) {
    const { error } = await getSupabase().from("conversations").delete().eq("id", id);
    if (error) throw error;
    return;
  }
  try {
    await fs.unlink(fileFor(id));
  } catch {
    /* already gone */
  }
}

export async function listConversations(): Promise<ConversationSummary[]> {
  if (isSupabaseConfigured()) {
    const { data, error } = await getSupabase()
      .from("conversations")
      .select("id,title,updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      title: r.title || "新しいチャット",
      updatedAt: r.updated_at,
    }));
  }
  let files: string[];
  try {
    files = await fs.readdir(DIR);
  } catch {
    return [];
  }
  const out: ConversationSummary[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const c = JSON.parse(await fs.readFile(path.join(DIR, f), "utf8")) as Conversation;
      out.push({ id: c.id, title: c.title || "新しいチャット", updatedAt: c.updatedAt });
    } catch {
      /* skip unreadable file */
    }
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return out;
}

// ---------- projection helpers ----------

// Project stored Anthropic messages into chat-display messages (assistant text
// keeps its raw [[OPTIONS]] block; the client parses it). Internal tool_result
// turns and tool-only assistant turns are skipped.
export function toDisplay(messages: any[]): DisplayMessage[] {
  const out: DisplayMessage[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      if (typeof m.content === "string") out.push({ role: "user", text: m.content });
    } else if (m.role === "assistant") {
      const blocks = Array.isArray(m.content) ? m.content : [];
      const text = blocks
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
      if (text.trim()) out.push({ role: "assistant", text });
    }
  }
  return out;
}

// The assembled draft is stored in the conversation as a tool_result carrying
// `__draft` (see tools.ts propose_blog_post). Scan from the end for the most
// recent one so the client can restore the live preview after a reload/crash —
// the draft otherwise lives only in browser memory and is lost on refresh.
export function latestDraft(messages: any[]): any | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    for (let j = m.content.length - 1; j >= 0; j--) {
      const block = m.content[j];
      if (block?.type !== "tool_result") continue;
      try {
        const text = typeof block.content === "string" ? block.content : "";
        const obj = JSON.parse(text);
        if (obj && obj.__draft) return obj.__draft;
      } catch {
        /* not a draft result */
      }
    }
  }
  return null;
}

// The conversation-history invariant guards live in a dependency-free module so
// they're unit-testable in isolation. Re-exported here so existing importers of
// `@/lib/conversations` keep working.
export { sanitizeHistory } from "./chatHistory";

export function titleFrom(messages: any[]): string {
  const firstUser = messages.find((m) => m.role === "user" && typeof m.content === "string");
  const t = String(firstUser?.content ?? "").trim().replace(/\s+/g, " ");
  return t.length > 30 ? t.slice(0, 30) + "…" : t || "新しいチャット";
}
