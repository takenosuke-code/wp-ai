// Acts as a real client: drives a full blog-creation session against the running
// dev server, then reads the real per-turn cost from Supabase usage_log.
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

// --- load .env ---
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2];
}

const BASE = "http://localhost:3000";
const conversationId = randomUUID();
console.log("conversationId:", conversationId);

// The client persona: a Japanese cooperative promoting a new service. Each reply
// nudges the assistant forward and grants explicit approval so it reaches publish.
const clientTurns = [
  "外国人技能実習生の受け入れ支援サービスについて、SEO集客用のブログ記事を書きたいです。会社は協同組合で、初めて実習生を受け入れる中小企業の経営者向けです。",
  "おまかせします。その案で進めてください。",
  "いいですね、そのアウトラインでOKです。全文を書いてください。",
  "承認します。タイトルもメタ情報もあなたのおすすめでOKです。このまま公開してください。",
  "はい、承認します。save_blog_post を呼んで公開してください。",
  "OKです。公開を確定してください。",
];

async function sendTurn(message, i) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, message }),
  });
  if (!res.ok) throw new Error(`turn ${i}: HTTP ${res.status} ${await res.text()}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  let published = false;
  const toolsCalled = [];

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const ev = JSON.parse(line);
      if (ev.type === "text") text += ev.text;
      else if (ev.type === "tool") toolsCalled.push(ev.name);
      else if (ev.type === "blog") published = true;
      else if (ev.type === "error") throw new Error(`turn ${i} stream error: ${ev.message}`);
    }
  }
  return { text, toolsCalled, published };
}

const t0 = Date.now();
let publishedAt = -1;
for (let i = 0; i < clientTurns.length; i++) {
  const { text, toolsCalled, published } = await sendTurn(clientTurns[i], i);
  const preview = text.replace(/\[\[OPTIONS\]\][\s\S]*?\[\[\/OPTIONS\]\]/g, "").trim().slice(0, 120);
  console.log(`\n--- TURN ${i + 1} (client: "${clientTurns[i].slice(0, 30)}…")`);
  console.log(`   tools: [${toolsCalled.join(", ")}]  assistant: ${preview}…`);
  if (published) { publishedAt = i + 1; console.log("   *** PUBLISHED via save_blog_post ***"); break; }
}
const wallSec = ((Date.now() - t0) / 1000).toFixed(1);

// Give best-effort usage logging a moment to flush.
await new Promise((r) => setTimeout(r, 1500));

// --- read REAL cost from Supabase ---
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data, error } = await sb
  .from("usage_log")
  .select("*")
  .eq("conversation_id", conversationId)
  .order("created_at", { ascending: true });
if (error) throw error;

let tin = 0, tout = 0, tcr = 0, tcc = 0, tcost = 0;
console.log("\n========== USAGE_LOG (real, from Supabase) ==========");
data.forEach((r, i) => {
  tin += r.input_tokens; tout += r.output_tokens; tcr += r.cache_read_tokens; tcc += r.cache_creation_tokens; tcost += Number(r.cost);
  console.log(`turn ${i + 1}: in=${r.input_tokens} out=${r.output_tokens} cacheR=${r.cache_read_tokens} cacheW=${r.cache_creation_tokens} cost=$${Number(r.cost).toFixed(6)}`);
});
console.log("----------------------------------------------------");
console.log(`TOTALS: in=${tin} out=${tout} cacheRead=${tcr} cacheWrite=${tcc}`);
console.log(`TOTAL TOKENS: ${tin + tout + tcr + tcc}`);
console.log(`TOTAL COST (one published blog): $${tcost.toFixed(6)}`);
console.log(`published at turn: ${publishedAt}   wall time: ${wallSec}s   chat turns: ${data.length}`);

// Approx body size of the published post for the Voyage embedding estimate.
const { data: blogs } = await sb.from("blogs").select("title,content").eq("id", (await sb.from("blogs").select("id").order("created_at",{ascending:false}).limit(1).maybeSingle()).data?.id ?? "00000000-0000-0000-0000-000000000000").maybeSingle();
if (blogs?.content) {
  const chars = (blogs.title + "\n" + blogs.content).length;
  console.log(`\npublished post chars: ${chars}  (~${Math.round(chars / 2.2)} est. tokens for Japanese)`);
}
