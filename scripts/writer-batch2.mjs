// Writer batch v2: 5 briefs × Sonnet vs Kimi, length-capped prompt + automatic
// defect detection (truncation, over-length). Objective metrics: cost, time,
// output tokens, body chars, defects. Writes writer-comparison-2.md.
import { readFileSync, writeFileSync } from "fs";
import Anthropic from "@anthropic-ai/sdk";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2];
}

const KIMI = { id: "moonshotai/kimi-k2.6", label: "Kimi K2.6", in: 0.6, out: 2.8 };
const SONNET = { in: 3, out: 15 };
const MAX_TOKENS = 8000; // generous, so truncation only happens if the cap is ignored

const WRITER_SYSTEM = `あなたは日本市場に精通したSEOのスペシャリストであり、月間100万PV級の人気ブログを書くプロのライターです。編集者から渡される「ブリーフ」をもとに、そのまま公開できる完成度の記事を一本書き上げます。

# 文章の方針（人気ブログ・SEOの実務に基づく）
- 検索意図ファースト。冒頭で結論・要点を述べる（PREP）。読者は欲しい情報がなければすぐ離脱する。
- 信頼性（E-E-A-T）: 具体的な数字・固有名詞・手順・第三者評価を入れて説得力を出す。ただし統計や数値を**捏造しない**。確実に検証できる事実だけを断定し、曖昧なものは「一般的に」「目安として」と留保する。
- 読みやすさ: H2/H3で走査しやすく構成する。**比較はMarkdownの表**で示す。**1段落は2〜3文**に抑える。箇条書き・太字を活用し、視覚的に軽くする。
- ボリューム: 本文は**3,500〜4,500字程度**にまとめる（**必ず4,800字以内**）。網羅性は保ちつつ、冗長な水増しや繰り返しは禁止。**必ず最後まで書き切り、<BODY>を</BODY>で閉じて完結させること。**
- トーン: 丁寧だが硬すぎない、自然で親しみのある人気ブログの語り口。スラングや「！」の多用は避ける。読者に語りかけるように。
- タイトル: 主要キーワードを前方に、約30〜35字、検索意図に一致。本文の最初の100字にも主要キーワードを自然に含める。マーケティング記事のCTAはソフトに。

# 出力形式（このタグ形式だけ。前置き・説明・コードフェンス不要）
<TITLE>記事タイトル</TITLE>
<EXCERPT>1〜2文・120字以内の要約（メタディスクリプション）</EXCERPT>
<BODY>
（Markdown本文）
</BODY>`;

const BRIEFS = [
  { key: "marketing", label: "マーケティング", brief: `目的: マーケティング（協同組合の技能実習生受け入れ支援サービスの認知・利用促進）
post_type: marketing
トピック: 初めて外国人技能実習生を受け入れる中小企業向けの実務ガイド
角度: 受け入れ後の管理・育成にこそ想像以上の手間がかかる——その現実を先に知ってもらい協同組合のサポート価値につなげる
想定読者: 初めて技能実習生を受け入れる中小企業の経営者（製造・建設・農業など）
見出し構成:
- なぜ「受け入れ後」でつまずく企業が多いのか
- 受け入れ後に発生する5つの実務（在留管理・生活サポート・教育・トラブル対応・行政手続き）
- 自社だけで抱えるリスクと、協同組合に任せられる範囲
- 失敗しないための受け入れ前チェックリスト
盛り込む具体的な要点:
- 監理団体（協同組合）の役割と、企業が自前でやる場合の負担の違い
- 生活面（住居・通院・銀行口座・ゴミ出し）の地味だが重要なサポート
- 行政手続きの期限管理を怠ると受け入れ停止リスクがあること` },
  { key: "howto", label: "ハウツー", brief: `目的: 情報提供・集客（一人暮らし関連サービスへの導線）
post_type: how-to
トピック: 初めての一人暮らしで失敗しない部屋探しの手順
角度: 「家賃の安さ」だけで選んで後悔する人が多い——内見から契約までの抜けがちな確認ポイントを時系列で
想定読者: 初めて一人暮らしをする社会人1年目・大学生
見出し構成:
- 部屋探しを始める前に決めておくこと（予算の内訳・優先順位）
- 物件サイトでの絞り込みと「おとり物件」の見分け方
- 内見で必ずチェックする10のポイント
- 申し込みから契約で見落としがちな初期費用と注意点
盛り込む具体的な要点:
- 家賃の目安は手取りの3分の1、初期費用は家賃の4〜5ヶ月分が一般的（目安として）
- 内見時の持ち物（メジャー・方位磁石アプリ）と確認項目（電波・コンセント位置・収納・騒音）
- 契約前に確認すべき退去時の原状回復・更新料` },
  { key: "opinion", label: "オピニオン", brief: `目的: 集客・SEO（家計・節約ジャンルでの認知）
post_type: opinion
トピック: お金が貯まらない人に共通する習慣と、その抜け出し方
角度: 「収入が低いから貯まらない」は誤解——年収より「習慣」で差がつく。やりがちな3つの習慣を指摘し行動を促す
想定読者: 20〜30代で「気づいたらお金がない」と感じている人
見出し構成:
- なぜ収入が増えても貯金は増えないのか
- お金が貯まらない人の3つの習慣（なんとなく支出・サブスク放置・先取り貯金なし）
- 今日からできる、貯まる人への第一歩
盛り込む具体的な要点:
- 「先取り貯金」（給料日に自動で別口座へ）の効果
- サブスクの棚卸し（具体額は断定せず一般論として）
- 固定費（通信・保険）の見直しが変動費の節約より効果が大きい理由` },
  { key: "informational", label: "解説（informational）", brief: `目的: 情報提供・集客（投資初心者向け）
post_type: informational
トピック: 新NISA（つみたて投資枠）の基本と始め方
角度: 「なんとなく難しそう」で踏み出せない初心者に、制度の要点と口座開設〜積立開始までを最短で
想定読者: 投資未経験の20〜40代会社員
見出し構成:
- 新NISAとは？旧制度との違いをざっくり把握
- つみたて投資枠と成長投資枠の違い
- 口座開設から積立開始までの手順
- 初心者がやりがちな失敗と注意点
盛り込む具体的な要点:
- 非課税で投資できる枠の考え方（制度の数値は確実なもののみ。不確かなら断定しない）
- 金融機関選びのポイント（手数料・取扱商品・使いやすさ）
- 「長期・積立・分散」の基本と、短期で一喜一憂しないこと` },
  { key: "listicle", label: "節約まとめ（listicle）", brief: `目的: 集客・SEO（節約・家計ジャンル）
post_type: informational
トピック: 一人暮らしの節約術——今日からできる固定費・食費・光熱費の見直し
角度: 我慢する節約ではなく「仕組みで減らす」節約。効果の大きい固定費から順に、すぐ実践できるコツをまとめる
想定読者: 一人暮らしを始めたばかりで支出を抑えたい20代
見出し構成:
- 節約は「固定費→変動費」の順が鉄則
- 固定費の節約術（通信・サブスク・電気のプラン）
- 食費の節約術（自炊・まとめ買い・作り置き）
- 光熱費の節約術（季節別のポイント）
盛り込む具体的な要点:
- 固定費の見直しは一度で継続効果（具体的な金額は一般論・目安として）
- 自炊と外食のコスト差は大きいが続けられる範囲で
- 光熱費は契約アンペア・電力プランの見直しも有効` },
];

async function genSonnet(brief) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const t = Date.now();
  const r = await client.messages.create({ model: "claude-sonnet-4-6", max_tokens: MAX_TOKENS, system: WRITER_SYSTEM, messages: [{ role: "user", content: brief }] });
  const text = r.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return analyze(text, r.usage.input_tokens, r.usage.output_tokens, (r.usage.input_tokens * SONNET.in + r.usage.output_tokens * SONNET.out) / 1e6, Date.now() - t);
}
async function genKimi(brief) {
  const t = Date.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json", "X-Title": "WP_AI batch2" },
    body: JSON.stringify({ model: KIMI.id, max_tokens: MAX_TOKENS, messages: [{ role: "system", content: WRITER_SYSTEM }, { role: "user", content: brief }] }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
  const text = j.choices?.[0]?.message?.content ?? "";
  const inTok = j.usage?.prompt_tokens ?? 0, outTok = j.usage?.completion_tokens ?? 0;
  return analyze(text, inTok, outTok, (inTok * KIMI.in + outTok * KIMI.out) / 1e6, Date.now() - t);
}
function analyze(text, inTok, outTok, cost, ms) {
  const closed = /<\/BODY>/i.test(text);
  const body = text.match(/<BODY>([\s\S]*?)(<\/BODY>|$)/i);
  const bodyChars = body ? body[1].replace(/\s/g, "").length : 0;
  const defects = [];
  if (!closed) defects.push("TRUNCATED (no </BODY>)");
  if (bodyChars > 5200) defects.push(`OVER-LENGTH (${bodyChars} chars)`);
  return { text, inTok, outTok, cost, ms, bodyChars, defects };
}

const fmt = (n) => "$" + n.toFixed(5);
console.log("generating 5 briefs × 2 models…");
const results = await Promise.all(BRIEFS.map(async (b) => {
  const [sonnet, kimi] = await Promise.all([genSonnet(b.brief), genKimi(b.brief)]);
  console.log(`  ${b.key}: sonnet ${fmt(sonnet.cost)} ${(sonnet.ms/1000).toFixed(0)}s [${sonnet.defects.join(",")||"ok"}] / kimi ${fmt(kimi.cost)} ${(kimi.ms/1000).toFixed(0)}s [${kimi.defects.join(",")||"ok"}]`);
  return { ...b, sonnet, kimi };
}));

let sCost=0,kCost=0,sMs=0,kMs=0,sDef=0,kDef=0;
let md = `# Writer A/B v2 — Sonnet 4.6 vs Kimi K2.6 (length-capped prompt, 5 briefs)\n\n`;
md += `## Metrics\n\n| Brief | Model | Cost | Time | Out tok | Body chars | Defects |\n|---|---|---|---|---|---|---|\n`;
for (const r of results) {
  for (const [m, d] of [["Sonnet", r.sonnet], ["Kimi", r.kimi]]) {
    md += `| ${r.label} | ${m} | ${fmt(d.cost)} | ${(d.ms/1000).toFixed(0)}s | ${d.outTok} | ${d.bodyChars} | ${d.defects.join(", ")||"—"} |\n`;
  }
  sCost+=r.sonnet.cost; kCost+=r.kimi.cost; sMs+=r.sonnet.ms; kMs+=r.kimi.ms;
  sDef+=r.sonnet.defects.length?1:0; kDef+=r.kimi.defects.length?1:0;
}
md += `\n**Totals** — Sonnet: ${fmt(sCost)}, avg ${(sMs/5/1000).toFixed(0)}s/draft, **${sDef}/5 defective**. Kimi: ${fmt(kCost)} (${(sCost/kCost).toFixed(1)}× cheaper), avg ${(kMs/5/1000).toFixed(0)}s/draft, **${kDef}/5 defective**.\n\n`;
for (const r of results) {
  md += `\n---\n\n# ${r.label}\n\n<details><summary>Brief</summary>\n\n\`\`\`\n${r.brief}\n\`\`\`\n\n</details>\n\n`;
  md += `## 🟦 Sonnet  (${fmt(r.sonnet.cost)}, ${(r.sonnet.ms/1000).toFixed(0)}s, ${r.sonnet.bodyChars}字${r.sonnet.defects.length?" ⚠️ "+r.sonnet.defects.join(", "):""})\n\n${r.sonnet.text.trim()}\n\n`;
  md += `## 🟧 Kimi  (${fmt(r.kimi.cost)}, ${(r.kimi.ms/1000).toFixed(0)}s, ${r.kimi.bodyChars}字${r.kimi.defects.length?" ⚠️ "+r.kimi.defects.join(", "):""})\n\n${r.kimi.text.trim()}\n\n`;
}
writeFileSync("writer-comparison-2.md", md, "utf8");
console.log(`\n✓ writer-comparison-2.md — Sonnet ${fmt(sCost)} (${sDef}/5 defective) vs Kimi ${fmt(kCost)} ${(sCost/kCost).toFixed(1)}× cheaper (${kDef}/5 defective)`);
