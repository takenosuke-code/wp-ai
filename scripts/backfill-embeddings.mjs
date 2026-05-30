// One-time backfill: embed existing blog posts that don't have an embedding yet.
// Uses the HTTPS data API (proper TLS) for the DB and one batched Voyage call
// (so it stays within the free-tier 3-requests/min limit).
import { readFileSync } from "fs";
import { createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2];
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: posts, error } = await sb
  .from("blogs")
  .select("id,title,content")
  .is("embedding", null);
if (error) throw error;
if (!posts.length) {
  console.log("nothing to backfill — all posts already embedded.");
  process.exit(0);
}
console.log(`embedding ${posts.length} post(s)…`);

const texts = posts.map((p) => `${p.title}\n\n${p.content}`);
const res = await fetch("https://api.voyageai.com/v1/embeddings", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
  },
  body: JSON.stringify({ input: texts, model: "voyage-3.5-lite", input_type: "document" }),
});
const json = await res.json();
if (!res.ok) throw new Error(`Voyage ${res.status}: ${JSON.stringify(json)}`);
console.log("Voyage tokens used:", json.usage?.total_tokens);

for (let i = 0; i < posts.length; i++) {
  const embedding = JSON.stringify(json.data[i].embedding);
  const content_hash = createHash("sha256").update(texts[i]).digest("hex");
  const { error: upErr } = await sb
    .from("blogs")
    .update({ embedding, content_hash })
    .eq("id", posts[i].id);
  console.log(`  ${upErr ? "✗ " + upErr.message : "✓"} ${posts[i].title.slice(0, 40)}`);
}
console.log("backfill done.");
