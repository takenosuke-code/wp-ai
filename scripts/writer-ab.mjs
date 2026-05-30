// Writer A/B: same brief → Claude Sonnet (current writer) vs an OpenRouter
// challenger (Kimi K2.6 or DeepSeek V3.2). Prints both Japanese drafts + tokens +
// cost so you can judge quality yourself before swapping MODEL_WRITER.
//
//   node scripts/writer-ab.mjs kimi      (default)
//   node scripts/writer-ab.mjs deepseek
import { readFileSync } from "fs";
import Anthropic from "@anthropic-ai/sdk";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2];
}

const CHALLENGERS = {
  kimi: { id: "moonshotai/kimi-k2.6", label: "Kimi K2.6", in: 0.6, out: 2.8 },
  deepseek: { id: "deepseek/deepseek-v3.2-exp", label: "DeepSeek V3.2", in: 0.28, out: 0.42 },
};
const pick = process.argv[2] || "kimi";
const challenger = CHALLENGERS[pick];
if (!challenger) throw new Error(`unknown challenger '${pick}' (use kimi|deepseek)`);

// Faithful-enough copy of WRITER_SYSTEM for the test (Japanese writer, tagged output).
const WRITER_SYSTEM = `あなたは日本語のプロのブログライターです。編集者から渡される「ブリーフ」をもとに、そのまま公開できる完成度の記事を一本書き上げます。日本語ネイティブとして、自然で具体的・信頼できる文章を書いてください。一般的で当たり障りのないAIっぽい文章は避け、具体的な数字・固有名詞・実例で裏づけること。結論を先に述べ(PREP)、走査しやすい見出しを使い、タイトルはSEOと拡散を意識して約30〜35字で作ること。マーケティング記事なら商品/サービスを自然に織り込み、最後は押し付けないCTAで締める。

出力は次のタグ形式「だけ」にしてください（前置き・説明・コードフェンス不要）:
<TITLE>記事タイトル</TITLE>
<EXCERPT>1〜2文の要約（メタディスクリプション）</EXCERPT>
<BODY>
（Markdown本文）
</BODY>`;

// A realistic brief, matching what propose_blog_post would pass.
const BRIEF = `目的: マーケティング（協同組合の技能実習生受け入れ支援サービスの認知・利用促進）
post_type: marketing
トピック: 初めて外国人技能実習生を受け入れる中小企業向けの実務ガイド
角度: 「受け入れて終わり」ではなく、受け入れ後の管理・育成にこそ想像以上の手間がかかる——その現実を先に知ってもらい、協同組合のサポート価値につなげる
想定読者: 初めて技能実習生を受け入れる中小企業の経営者（製造・建設・農業など）
見出し構成:
- なぜ「受け入れ後」でつまずく企業が多いのか
- 受け入れ後に発生する5つの実務（在留管理・生活サポート・教育・トラブル対応・行政手続き）
- 自社だけで抱えるリスクと、協同組合に任せられる範囲
- 失敗しないための受け入れ前チェックリスト
盛り込む具体的な要点:
- 監理団体（協同組合）の役割と、企業が自前でやる場合の負担の違い
- 生活面（住居・通院・銀行口座・ゴミ出しなど）の地味だが重要なサポート
- 行政手続きの期限管理を怠ると受け入れ停止リスクがあること`;

function fmt(usd) {
  return "$" + usd.toFixed(5);
}

async function runSonnet() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const t = Date.now();
  const r = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    system: WRITER_SYSTEM,
    messages: [{ role: "user", content: BRIEF }],
  });
  const text = r.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const inTok = r.usage.input_tokens, outTok = r.usage.output_tokens;
  const cost = (inTok * 3 + outTok * 15) / 1e6;
  return { label: "Claude Sonnet 4.6", text, inTok, outTok, cost, ms: Date.now() - t };
}

async function runOpenRouter() {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not set in .env");
  const t = Date.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "X-Title": "WP_AI writer A/B",
    },
    body: JSON.stringify({
      model: challenger.id,
      max_tokens: 8000,
      messages: [
        { role: "system", content: WRITER_SYSTEM },
        { role: "user", content: BRIEF },
      ],
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
  const text = j.choices?.[0]?.message?.content ?? "";
  const inTok = j.usage?.prompt_tokens ?? 0, outTok = j.usage?.completion_tokens ?? 0;
  const cost = (inTok * challenger.in + outTok * challenger.out) / 1e6;
  return { label: challenger.label, text, inTok, outTok, cost, ms: Date.now() - t };
}

const [a, b] = await Promise.all([runSonnet(), runOpenRouter()]);
for (const r of [a, b]) {
  console.log("\n" + "=".repeat(70));
  console.log(`${r.label}   in=${r.inTok} out=${r.outTok}  cost=${fmt(r.cost)}  ${(r.ms / 1000).toFixed(1)}s`);
  console.log("=".repeat(70));
  console.log(r.text.trim());
}
console.log("\n" + "-".repeat(70));
console.log(`COST: ${a.label} ${fmt(a.cost)}  vs  ${b.label} ${fmt(b.cost)}  (challenger is ${(a.cost / b.cost).toFixed(1)}x cheaper)`);
console.log("Judge: native Japanese quality, concreteness, title craft, viral hook, structure.");
