"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type DraftPreview = {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  category: string;
  tags: string[];
  featuredImagePrompt: string;
  postType?: string;
};
type SeoCheck = { label: string; status: string; note?: string };
type SeoKeyword = { term: string; volume?: string; competition?: string };
type SeoCompetitor = {
  title: string;
  domain?: string;
  words?: string | number;
  score?: number;
  url?: string;
};
type SeoReport = {
  score: number;
  keyword: string;
  monthlySearches: string;
  competition: string;
  checks: SeoCheck[];
  keywords: SeoKeyword[];
  competitors: SeoCompetitor[];
  recommendation: string;
};
type ConfirmItem = { label: string; value: string };
type ConfirmData = { items: ConfirmItem[] };
type ChatMsg = {
  role: "user" | "assistant";
  text: string;
  options?: string[];
  // A draft no longer renders in the chat stream (it lives in the right preview
  // pane); we drop a lightweight marker bubble in the chat instead.
  draftMarker?: boolean;
  seo?: SeoReport;
  // §02: the "これでいいですか？" checklist card shown before drafting (OK/直したい)
  confirm?: ConfirmData;
};
type ConvSummary = { id: string; title: string; updatedAt: string };
type Blog = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  category: string;
  tags: string[];
  featuredImagePrompt: string;
  featuredImageUrl?: string;
  createdAt: string;
};

const OPT_OPEN = "[[OPTIONS]]";
const OPT_CLOSE = "[[/OPTIONS]]";
const CONF_OPEN = "[[CONFIRM]]";
const CONF_CLOSE = "[[/CONFIRM]]";
const CONV_KEY = "wpai.conv";

function toolLabel(name: string): string {
  if (name === "list_existing_posts") return "既存の記事を確認しています";
  if (name === "search_existing_posts") return "関連記事を検索しています";
  if (name === "propose_blog_post") return "下書きを作成しています";
  if (name === "seo_analyze") return "競合をWeb検索してSEO分析しています";
  return "作業しています";
}

function parseOptions(full: string): { body: string; options: string[] } {
  const open = full.indexOf(OPT_OPEN);
  if (open === -1) return { body: full.trim(), options: [] };
  const body = full.slice(0, open).trim();
  const rest = full.slice(open + OPT_OPEN.length);
  const close = rest.indexOf(OPT_CLOSE);
  const inner = close === -1 ? rest : rest.slice(0, close);
  const options = inner
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s\-*・]+/, "").trim())
    .filter(Boolean);
  return { body, options };
}

// Where in `s` to cut a (possibly still-streaming) marker block: the token's
// position if present, else the length of any partial token suffix at the end.
function cutAt(s: string, tok: string): number {
  const idx = s.indexOf(tok);
  if (idx !== -1) return idx;
  for (let n = Math.min(tok.length - 1, s.length); n > 0; n--) {
    if (s.endsWith(tok.slice(0, n))) return s.length - n;
  }
  return s.length;
}

function displayBody(s: string): string {
  const cut = Math.min(cutAt(s, OPT_OPEN), cutAt(s, CONF_OPEN));
  return s.slice(0, cut).trimEnd();
}

// §02: extract a [[CONFIRM]] checklist block (lines of "ラベル: 値") from the text.
function parseConfirm(full: string): { rest: string; confirm?: ConfirmData } {
  const open = full.indexOf(CONF_OPEN);
  if (open === -1) return { rest: full };
  const before = full.slice(0, open);
  const afterOpen = full.slice(open + CONF_OPEN.length);
  const close = afterOpen.indexOf(CONF_CLOSE);
  const inner = close === -1 ? afterOpen : afterOpen.slice(0, close);
  const after = close === -1 ? "" : afterOpen.slice(close + CONF_CLOSE.length);
  const items: ConfirmItem[] = inner
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s\-*・]+/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(.+?)\s*[:：]\s*(.+)$/);
      return m ? { label: m[1].trim(), value: m[2].trim() } : { label: "", value: line };
    });
  return {
    rest: `${before} ${after}`.trim(),
    confirm: items.length ? { items } : undefined,
  };
}

// Combined parse for a finished assistant message: confirm card + options + body.
function parseAssistant(full: string): {
  body: string;
  options: string[];
  confirm?: ConfirmData;
} {
  const { rest, confirm } = parseConfirm(full);
  const { body, options } = parseOptions(rest);
  return { body, options, confirm };
}

// §02: "AIが「これでいいですか？」と必ず止まる" — a colored checklist card the
// assistant shows before drafting. The user confirms with OK or 直したい (2択).
function ConfirmCard({
  data,
  disabled,
  onChoice,
}: {
  data: ConfirmData;
  disabled: boolean;
  onChoice: (value: string) => void;
}) {
  return (
    <div className="confirm">
      <div className="confirm-h">この内容で進めてよろしいですか？</div>
      <ul className="confirm-list">
        {data.items.map((it, i) => (
          <li key={i} className="confirm-item">
            <span className="confirm-check" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12l4.5 4.5L19 6" />
              </svg>
            </span>
            <span className="confirm-t">
              {it.label && <span className="confirm-label">{it.label}</span>}
              <span className="confirm-val">{it.value}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="confirm-btns">
        <button
          className="confirm-ok"
          disabled={disabled}
          onClick={() => onChoice("OK、この内容で進めてください。")}
        >
          OK、これで進める
        </button>
        <button
          className="confirm-edit"
          disabled={disabled}
          onClick={() => onChoice("直したいところがあります。")}
        >
          直したい
        </button>
      </div>
    </div>
  );
}

function renderMarkdown(md: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s)
      // images first so the ![]() syntax isn't mangled by emphasis rules.
      // esc() escapes <>& but NOT quotes, so we must guard against attribute
      // breakout: only allow http(s)/relative URLs and encode quotes in both src
      // and alt (alt can derive from a user-controlled filename).
      .replace(/!\[(.*?)\]\((.*?)\)/g, (_m, alt: string, url: string) => {
        if (!/^(https?:|\/)/i.test(url.trim())) return "";
        const safeUrl = url.trim().replace(/"/g, "%22");
        const safeAlt = alt.replace(/"/g, "&quot;");
        return `<img src="${safeUrl}" alt="${safeAlt}" loading="lazy" />`;
      })
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>");

  let html = "";
  let ul = false;
  let ol = false;
  const closeLists = () => {
    if (ul) {
      html += "</ul>";
      ul = false;
    }
    if (ol) {
      html += "</ol>";
      ol = false;
    }
  };

  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    let m: RegExpMatchArray | null;
    if (!line.trim()) {
      closeLists();
    } else if ((m = line.match(/^###\s+(.*)/))) {
      closeLists();
      html += `<h3>${inline(m[1])}</h3>`;
    } else if ((m = line.match(/^##\s+(.*)/))) {
      closeLists();
      html += `<h2>${inline(m[1])}</h2>`;
    } else if ((m = line.match(/^#\s+(.*)/))) {
      closeLists();
      html += `<h1>${inline(m[1])}</h1>`;
    } else if ((m = line.match(/^[-*]\s+(.*)/))) {
      if (ol) {
        html += "</ol>";
        ol = false;
      }
      if (!ul) {
        html += "<ul>";
        ul = true;
      }
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^\d+\.\s+(.*)/))) {
      if (ul) {
        html += "</ul>";
        ul = false;
      }
      if (!ol) {
        html += "<ol>";
        ol = true;
      }
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^>\s+(.*)/))) {
      closeLists();
      html += `<blockquote>${inline(m[1])}</blockquote>`;
    } else {
      closeLists();
      html += `<p>${inline(line)}</p>`;
    }
  }
  closeLists();
  return html;
}

function PoweredBy({ className = "" }: { className?: string }) {
  return (
    <div className={`powered ${className}`}>
      <svg className="powered-mark" width="20" height="20" viewBox="0 0 32 32" aria-hidden="true">
        <defs>
          <linearGradient id="nq-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#D9B978" />
            <stop offset="100%" stopColor="#8A6D2F" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#nq-grad)" />
        <path
          d="M10 22 V10 L22 22 V10"
          stroke="#fff"
          strokeWidth="2.6"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="powered-text">
        Powered by{" "}
        <b>
          Nortiq<span className="powered-accent">Labs</span>
        </b>
      </span>
    </div>
  );
}

// ── 8-step progress pill row (top of the workspace) ─────────────────────────
// Pattern A from the proposal (上部ピル列): a single compact row. Completed steps
// show a check, the current step is a filled dark pill, upcoming steps a faint
// number. See .steps / .step in globals.css.
const STEPS = [
  "内容を伝える",
  "画像をアップ",
  "AI要約・確認",
  "SEOチェック",
  "プレビュー",
  "タイトル設定",
  "スケジュール",
  "公開",
];

// `current` = the step in progress now; `done` = steps actually completed (a set,
// not "everything below current") so a step is never shown done before it happens.
function StepBar({ current, done }: { current: number; done: number[] }) {
  return (
    <div className="steps" role="list" aria-label="投稿の進行状況">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n === current ? "active" : done.includes(n) ? "done" : "todo";
        return (
          <div
            key={n}
            className={`step ${state}`}
            role="listitem"
            aria-current={n === current ? "step" : undefined}
          >
            <span className="step-n" aria-hidden="true">
              {state === "done" ? (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12l4.5 4.5L19 6" />
                </svg>
              ) : (
                String(n).padStart(2, "0")
              )}
            </span>
            <span className="step-label">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── SEO + competitor report card (rendered from the seo_analyze tool) ────────
function ScoreRing({ score }: { score: number }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  const off = circ * (1 - pct / 100);
  return (
    <svg width="76" height="76" viewBox="0 0 76 76" className="ring" aria-label={`SEOスコア ${pct}`}>
      <circle cx="38" cy="38" r={r} className="ring-bg" />
      <circle
        cx="38"
        cy="38"
        r={r}
        className="ring-fg"
        strokeDasharray={circ}
        strokeDashoffset={off}
        transform="rotate(-90 38 38)"
      />
      <text x="38" y="43" textAnchor="middle" className="ring-num">
        {pct}
      </text>
    </svg>
  );
}

function compClass(c?: string): string {
  if (c === "高") return "comp hi";
  if (c === "中") return "comp mid";
  if (c === "低") return "comp lo";
  return "comp";
}

function SeoCard({ report }: { report: SeoReport }) {
  return (
    <div className="seo">
      <div className="seo-tag">SEO最適化 ＋ 競合調査</div>
      <div className="seo-grid">
        {/* CARD 01 — score */}
        <div className="seo-c">
          <div className="seo-c-h">SEOスコア</div>
          <div className="seo-score">
            <ScoreRing score={report.score} />
            <div className="seo-score-meta">
              <div className="kw">「{report.keyword}」</div>
              {report.monthlySearches && <div className="muted">月間検索数：{report.monthlySearches}</div>}
              {report.competition && (
                <div className="muted">
                  競合の強さ：<span className={compClass(report.competition)}>{report.competition}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* CARD 02 — checklist */}
        <div className="seo-c">
          <div className="seo-c-h">チェック項目</div>
          <ul className="seo-checks">
            {report.checks.map((c, i) => (
              <li key={i} className={`chk ${c.status}`}>
                <span className="chk-i">{c.status === "ok" ? "✓" : c.status === "warn" ? "△" : "＋"}</span>
                <span className="chk-t">
                  {c.label}
                  {c.note && <span className="chk-note">{c.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* CARD 03 — keyword suggestions */}
        <div className="seo-c">
          <div className="seo-c-h">キーワード候補</div>
          <ul className="seo-kw">
            {report.keywords.map((k, i) => (
              <li key={i}>
                <span className="kw-term">{k.term}</span>
                <span className="kw-meta">
                  {k.volume && <span className="muted">{k.volume}</span>}
                  {k.competition && <span className={compClass(k.competition)}>競合 {k.competition}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* CARD 04 — competitors */}
        <div className="seo-c">
          <div className="seo-c-h">競合ブログ分析（上位記事）</div>
          <ul className="seo-comp">
            {report.competitors.map((c, i) => {
              // c.url is LLM-supplied — only allow http(s) into the href sink.
              const href =
                typeof c.url === "string" && /^https?:\/\//i.test(c.url.trim()) ? c.url.trim() : undefined;
              return (
              <li key={i}>
                <div className="cmp-title">
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer noopener">
                      {c.title}
                    </a>
                  ) : (
                    c.title
                  )}
                </div>
                <div className="cmp-meta muted">
                  {c.domain && <span>{c.domain}</span>}
                  {c.words != null && <span>{typeof c.words === "number" ? `${c.words}語` : c.words}</span>}
                  {c.score != null && <span>SEO {c.score}</span>}
                </div>
              </li>
              );
            })}
          </ul>
        </div>
      </div>

      {report.recommendation && (
        <div className="seo-rec">
          <span className="seo-rec-mark">AIの提案</span>
          {report.recommendation}
        </div>
      )}
      <div className="seo-foot muted">※検索数・難易度は推定値です。競合記事は実際の検索結果に基づきます。</div>
    </div>
  );
}

// ── Interactive draft preview: per-section image "+" slots + client publish ──
type SlotImage = { url: string; alt: string };

// Split the draft body at each heading so we can offer a "+" image slot after
// every section. Concatenating the pieces with "\n" reproduces the original body
// exactly — so publishing is just (draft text + the images placed), no re-write.
function splitSections(md: string): string[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const segs: string[] = [];
  let cur: string[] = [];
  for (const line of lines) {
    if (/^#{1,3}\s/.test(line) && cur.length) {
      segs.push(cur.join("\n"));
      cur = [line];
    } else {
      cur.push(line);
    }
  }
  if (cur.length) segs.push(cur.join("\n"));
  return segs.length ? segs : [md];
}

// ── Live preview pane (region C, right column) ───────────────────────────────
// Renders the CURRENT draft as the "公開後の見た目": category + tags + serif
// title + byline + body, with per-section image "+" slots. Holds the image
// upload + publish/confirm logic (unchanged from the old in-chat DraftCard); the
// confirm flow is lifted to page state so the top-header "公開する →" button can
// trigger the SAME flow. A PC / スマホ toggle narrows the surface to phone width.
type PreviewMode = "pc" | "mobile";

function PreviewPane({
  draft,
  aiUpdating,
  confirming,
  setConfirming,
  onStep,
  onPublished,
}: {
  draft: DraftPreview;
  aiUpdating: boolean;
  confirming: boolean;
  setConfirming: (v: boolean) => void;
  onStep: (n: number) => void;
  onPublished: () => void;
}) {
  const sections = useMemo(() => splitSections(draft.content), [draft.content]);
  const [slots, setSlots] = useState<SlotImage[][]>(() => sections.map(() => []));
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<PreviewMode>("pc");
  const fileRef = useRef<HTMLInputElement>(null);

  // Re-init slots when the draft body changes (a revision arrives).
  useEffect(() => {
    setSlots(sections.map(() => []));
    setPublished(false);
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.content]);

  function pick(slotIdx: number) {
    if (uploading || published) return;
    setActiveSlot(slotIdx);
    fileRef.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || activeSlot === null) return;
    const slotIdx = activeSlot;
    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "アップロードに失敗しました");
      const alt = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || draft.title;
      setSlots((s) => s.map((arr, i) => (i === slotIdx ? [...arr, { url: data.url, alt }] : arr)));
      onStep(2); // 画像をアップ: an image was placed
    } catch (err: any) {
      setError(err?.message ?? "アップロードに失敗しました");
    } finally {
      setUploading(false);
      setActiveSlot(null);
    }
  }

  function removeImg(slotIdx: number, imgIdx: number) {
    setSlots((s) => s.map((arr, i) => (i === slotIdx ? arr.filter((_, j) => j !== imgIdx) : arr)));
  }

  // Reassemble final Markdown: each section followed by the images placed under it.
  function assemble(): { content: string; featuredImageUrl?: string } {
    let featured: string | undefined;
    const parts = sections.map((sec, i) => {
      let md = sec;
      for (const im of slots[i]) {
        if (!featured) featured = im.url;
        md += `\n\n![${im.alt}](${im.url})`;
      }
      return md;
    });
    return { content: parts.join("\n"), featuredImageUrl: featured };
  }

  async function doPublish() {
    setPublishing(true);
    setError("");
    try {
      const { content, featuredImageUrl } = assemble();
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          slug: draft.slug,
          excerpt: draft.excerpt,
          content,
          category: draft.category,
          tags: draft.tags,
          featuredImagePrompt: draft.featuredImagePrompt,
          featuredImageUrl,
          postType: draft.postType,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "公開に失敗しました");
      setPublished(true);
      setConfirming(false);
      onStep(8);
      onPublished();
    } catch (err: any) {
      setError(err?.message ?? "公開に失敗しました");
      setConfirming(false);
    } finally {
      setPublishing(false);
    }
  }

  const imageCount = slots.reduce((n, arr) => n + arr.length, 0);
  // First placed image (if any) acts as the hero/featured image area.
  const heroUrl = slots.find((arr) => arr.length)?.[0]?.url;
  const readMins = Math.max(1, Math.round(draft.content.replace(/\s/g, "").length / 500));

  return (
    <div className="preview">
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />

      {/* pane header: title + realtime note + PC/スマホ toggle */}
      <div className="preview-head">
        <div className="preview-head-l">
          <span className="preview-h-title">👁 ライブプレビュー</span>
          <span className="preview-h-sub">AIの編集がリアルタイムで反映されます</span>
        </div>
        <div className="seg" role="tablist" aria-label="表示幅">
          <button
            role="tab"
            aria-selected={mode === "pc"}
            className={`seg-btn ${mode === "pc" ? "on" : ""}`}
            onClick={() => setMode("pc")}
          >
            PC
          </button>
          <button
            role="tab"
            aria-selected={mode === "mobile"}
            className={`seg-btn ${mode === "mobile" ? "on" : ""}`}
            onClick={() => setMode("mobile")}
          >
            スマホ
          </button>
        </div>
      </div>

      <div className="preview-scroll">
        <div className={`preview-surface ${mode === "mobile" ? "is-mobile" : ""}`}>
          {aiUpdating && (
            <div className="ai-updating">✦ AIが下書きを更新中…</div>
          )}

          {/* category + tag chips */}
          <div className="preview-chips">
            {draft.category && <span className="cat-chip">{draft.category}</span>}
            {draft.tags?.map((t) => (
              <span key={t} className="tag-chip">
                # {t}
              </span>
            ))}
          </div>

          <h1 className="preview-title">{draft.title}</h1>

          <div className="preview-byline">
            Loop編集部 / 山田 真理子 ・ 約{readMins}分 ・ 公開予定
          </div>

          {/* featured image area */}
          {heroUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="preview-hero" src={heroUrl} alt={draft.title} />
          ) : (
            <div className="preview-hero-empty">
              アイキャッチ案: {draft.featuredImagePrompt}
            </div>
          )}

          {/* body with per-section "+" image slots */}
          {sections.map((sec, i) => (
            <div key={i}>
              <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(sec) }} />
              <div className="imgslot">
                {slots[i].map((im, j) => (
                  <div key={j} className="thumb">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={im.url} alt={im.alt} />
                    {!published && (
                      <button className="thumb-x" onClick={() => removeImg(i, j)} aria-label="画像を削除">
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                {!published && (
                  <button
                    className="add-img"
                    onClick={() => pick(i)}
                    disabled={uploading}
                    title="このセクションに画像を追加"
                  >
                    {uploading && activeSlot === i ? (
                      <span className="add-spin" />
                    ) : (
                      <>
                        <span className="add-plus">＋</span>
                        画像を追加
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}

          {error && <div className="draft-error">{error}</div>}
        </div>
      </div>

      {/* publish bar pinned at the bottom of the pane */}
      {!published ? (
        <div className="pubbar">
          {!confirming ? (
            <>
              <span className="pub-note muted">
                {imageCount > 0 ? `画像 ${imageCount} 枚を配置済み` : "画像はそのまま公開（任意）"}
              </span>
              <button
                className="pub-btn"
                onClick={() => {
                  setConfirming(true);
                  onStep(7); // entering 公開 (confirm dialog open)
                }}
              >
                公開する →
              </button>
            </>
          ) : (
            <div className="pub-confirm">
              <div className="pub-confirm-q">本当に公開しますか？</div>
              <dl className="pub-summary">
                <div>
                  <dt>タイトル</dt>
                  <dd>{draft.title}</dd>
                </div>
                <div>
                  <dt>カテゴリ</dt>
                  <dd>{draft.category}</dd>
                </div>
                <div>
                  <dt>公開日時</dt>
                  <dd>今すぐ公開（即時）</dd>
                </div>
                {imageCount > 0 && (
                  <div>
                    <dt>画像</dt>
                    <dd>{imageCount} 枚</dd>
                  </div>
                )}
              </dl>
              <p className="pub-confirm-note">
                公開すると右の一覧と公開サイトにすぐ表示されます。
              </p>
              <div className="pub-confirm-btns">
                <button className="pub-btn" onClick={doPublish} disabled={publishing}>
                  {publishing ? "公開中…" : "公開する"}
                </button>
                <button className="pub-cancel" onClick={() => setConfirming(false)} disabled={publishing}>
                  キャンセル
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="pubbar">
          <span className="pub-done">✓ 公開しました。右の「公開済み」一覧に表示されています。</span>
        </div>
      )}
    </div>
  );
}

// Empty state shown in the right pane before any draft exists.
function PreviewEmpty() {
  return (
    <div className="preview">
      <div className="preview-head">
        <div className="preview-head-l">
          <span className="preview-h-title">👁 ライブプレビュー</span>
          <span className="preview-h-sub">AIの編集がリアルタイムで反映されます</span>
        </div>
        <div className="seg" aria-hidden="true">
          <span className="seg-btn on">PC</span>
          <span className="seg-btn">スマホ</span>
        </div>
      </div>
      <div className="preview-scroll">
        <div className="preview-blank">
          <div className="preview-blank-glyph">👁</div>
          <p>ここに記事の「公開後の見た目」が表示されます。</p>
          <p className="muted">
            左のチャットでAIと内容を相談すると、下書きがここにリアルタイムで反映されます。
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConvSummary[]>([]);
  const [convId, setConvId] = useState("");
  const [blogs, setBlogs] = useState<Blog[]>([]);
  const [selected, setSelected] = useState<Blog | null>(null);
  // Progress: `step` = the step in progress; `stepsDone` = steps actually
  // completed (a set). We track completion explicitly so a step is never marked
  // done before it happens (e.g. 画像をアップ stays open until images are added).
  const [step, setStep] = useState(1);
  const [stepsDone, setStepsDone] = useState<number[]>([]);
  // The CURRENT draft, lifted to page state so it renders in the RIGHT live
  // preview pane (region C) instead of inside the chat stream. The latest draft
  // event wins (revisions replace it). `publishConfirming` is also lifted so the
  // top-header "公開する →" button triggers the SAME confirm flow the pane owns.
  const [draft, setDraft] = useState<DraftPreview | null>(null);
  const [publishConfirming, setPublishConfirming] = useState(false);
  // Mobile-only off-canvas drawers (the two side columns). Never toggled on
  // desktop — the toggle buttons are display:none above the mobile breakpoint.
  const [sideOpen, setSideOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  // Mobile: which body column is shown (the two columns stack/swap on phones).
  const [mobileView, setMobileView] = useState<"chat" | "preview">("chat");

  // The progress bar only moves forward within a conversation (revisions don't
  // regress it); it resets when a new/other conversation is opened.
  // reachStep: set the step in progress. markDone: record completed step(s).
  const reachStep = (n: number) => setStep((s) => Math.max(s, n));
  const markDone = (...ns: number[]) =>
    setStepsDone((d) => Array.from(new Set([...d, ...ns])));
  // Map the writer/preview pane's events to the new flow (see STEPS):
  //   2 画像をアップ (image added) · 8 公開 (published).
  const onPreviewStep = (n: number) => {
    if (n === 2) markDone(2); // an image was placed in the draft
    if (n === 7) reachStep(8); // publish confirm opened → 公開 in progress
    if (n >= 8) {
      reachStep(8);
      markDone(1, 2, 3, 4, 5, 6, 7, 8); // published → whole flow complete
    }
  };

  const [authed, setAuthed] = useState<boolean | null>(null); // null = checking
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const targetRef = useRef("");
  const shownRef = useRef(0);
  const doneRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  async function loadBlogs() {
    const res = await fetch("/api/blogs");
    if (res.ok) setBlogs(await res.json());
  }

  async function loadConversations() {
    const res = await fetch("/api/conversations");
    if (res.ok) setConversations(await res.json());
  }

  async function doLogin(e: React.FormEvent) {
    e.preventDefault();
    if (loginBusy) return;
    setLoginBusy(true);
    setLoginError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      if (res.ok) {
        setLoginPassword("");
        setAuthed(true);
      } else {
        const d = await res.json().catch(() => ({}));
        setLoginError(d.error || "ログインに失敗しました");
      }
    } catch {
      setLoginError("通信エラーが発生しました");
    } finally {
      setLoginBusy(false);
    }
  }

  async function doLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setMessages([]);
    setConversations([]);
    setBlogs([]);
    setAuthed(false);
  }

  async function openConversation(id: string) {
    setConvId(id);
    localStorage.setItem(CONV_KEY, id);
    setSelected(null);
    setStep(1);
    setStepsDone([]);
    setDraft(null);
    setPublishConfirming(false);
    setMobileView("chat");
    setSideOpen(false);
    const res = await fetch(`/api/conversations/${id}`);
    if (res.ok) {
      const data = await res.json();
      const msgs: ChatMsg[] = (data.messages as { role: string; text: string }[]).map((m) => {
        if (m.role === "assistant") {
          const { body, options, confirm } = parseAssistant(m.text);
          return { role: "assistant", text: body, options, confirm };
        }
        return { role: "user", text: m.text };
      });
      setMessages(msgs);
    } else {
      setMessages([]);
    }
  }

  function newChat() {
    const id = crypto.randomUUID();
    setConvId(id);
    localStorage.setItem(CONV_KEY, id);
    setMessages([]);
    setInput("");
    setStep(1);
    setStepsDone([]);
    setDraft(null);
    setPublishConfirming(false);
    setMobileView("chat");
    setSideOpen(false);
    textareaRef.current?.focus();
  }

  async function deleteConv(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (id === convId) newChat();
    loadConversations();
  }

  // Check the session on mount.
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => setAuthed(r.ok))
      .catch(() => setAuthed(false));
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Load app data only once authenticated.
  useEffect(() => {
    if (authed !== true) return;
    loadBlogs();
    loadConversations();
    const saved = localStorage.getItem(CONV_KEY);
    if (saved) {
      openConversation(saved);
    } else {
      const id = crypto.randomUUID();
      setConvId(id);
      localStorage.setItem(CONV_KEY, id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming, status]);

  function startReveal() {
    shownRef.current = 0;
    const tick = () => {
      const target = targetRef.current;
      if (shownRef.current < target.length) {
        const backlog = target.length - shownRef.current;
        const step = Math.max(2, Math.ceil(backlog / 9));
        shownRef.current = Math.min(target.length, shownRef.current + step);
        setStreaming(displayBody(target.slice(0, shownRef.current)));
      }
      if (doneRef.current && shownRef.current >= target.length) {
        const { body, options, confirm } = parseAssistant(targetRef.current);
        setStreaming("");
        setStatus(null);
        setBusy(false);
        if (body || options.length || confirm) {
          setMessages((m) => [...m, { role: "assistant", text: body, options, confirm }]);
        }
        // §02/step bar: the confirm card means content is gathered (1 done) and
        // the AI is at the 要約・確認 step (3). Until then we stay on 内容を伝える.
        if (confirm) {
          markDone(1);
          reachStep(3);
        }
        loadConversations(); // refresh sidebar (title / order)
        rafRef.current = null;
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim();
    if (!text || busy) return;
    let id = convId;
    if (!id) {
      id = crypto.randomUUID();
      setConvId(id);
      localStorage.setItem(CONV_KEY, id);
    }
    if (textArg === undefined) setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    reachStep(1); // 内容を伝える — stays here through the whole Q&A gathering
    setBusy(true);
    setStatus("考えています");
    setStreaming("");
    targetRef.current = "";
    doneRef.current = false;
    startReveal();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: id, message: text }),
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: any;
          try {
            evt = JSON.parse(line);
          } catch {
            continue;
          }
          if (evt.type === "text") {
            targetRef.current += evt.text;
            setStatus(null);
            // No step change: the assistant replying is still 内容を伝える (1).
          } else if (evt.type === "tool") {
            setStatus(toolLabel(evt.name));
          } else if (evt.type === "step") {
            // Backend tool→step hints are ignored: the step bar is driven by the
            // real client-side milestones below (confirm card, draft, seo, publish).
          } else if (evt.type === "draft") {
            // The proposed (not-yet-published) post. It now lives in the RIGHT
            // live-preview pane (region C), not the chat stream. We also drop a
            // small marker in the chat so the conversation reads naturally, and
            // auto-switch the mobile view to the preview so the user sees it.
            setDraft(evt.draft);
            setPublishConfirming(false);
            setMobileView("preview");
            setMessages((m) => [
              ...m,
              { role: "assistant", text: "", draftMarker: true },
            ]);
            setStatus(null);
            // Draft written → content (1) + AI要約・確認 (3) done; now プレビュー (5).
            markDone(1, 3);
            reachStep(5);
          } else if (evt.type === "seo") {
            setMessages((m) => [...m, { role: "assistant", text: "", seo: evt.report }]);
            setStatus(null);
            markDone(4); // SEOチェック done (it runs against the existing draft)
          } else if (evt.type === "blog") {
            loadBlogs();
          } else if (evt.type === "error") {
            targetRef.current += `\n\n[エラー: ${evt.message}]`;
            setStatus(null);
          }
        }
      }
    } catch (err: any) {
      targetRef.current += `\n\n[通信エラー: ${err?.message ?? err}]`;
    } finally {
      doneRef.current = true;
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const last = messages[messages.length - 1];
  const choices =
    !busy && !streaming && last && last.role === "assistant" && last.options?.length
      ? last.options
      : null;

  if (authed === null) {
    return (
      <div className="auth-screen">
        <div className="auth-loading">読み込み中…</div>
      </div>
    );
  }
  if (!authed) {
    return (
      <div className="auth-screen">
        <form className="auth-card" onSubmit={doLogin}>
          <div className="auth-brand">
            <span className="mark" />
            <span>ブログアシスタント</span>
          </div>
          <h1 className="auth-title">ログイン</h1>
          <p className="auth-sub">承認されたユーザーのみご利用いただけます。</p>
          <input
            className="auth-input"
            type="email"
            placeholder="メールアドレス"
            value={loginEmail}
            onChange={(e) => setLoginEmail(e.target.value)}
            autoFocus
          />
          <input
            className="auth-input"
            type="password"
            placeholder="パスワード"
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
          />
          {loginError && <div className="auth-error">{loginError}</div>}
          <button
            className="auth-btn"
            type="submit"
            disabled={loginBusy || !loginEmail || !loginPassword}
          >
            {loginBusy ? "確認中…" : "ログイン"}
          </button>
          <PoweredBy className="auth-powered" />
        </form>
      </div>
    );
  }

  // Truncated current-article title for the header breadcrumb.
  const breadcrumbTitle = draft?.title || (busy ? "下書きを準備中…" : "新しい記事");
  const autosaveTime = new Date().toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
  // The header "公開する →" + the pane share one confirm flow: this opens it and
  // (on mobile) brings the preview into view so the confirm is visible.
  function startPublish() {
    if (!draft) return;
    setPublishConfirming(true);
    setMobileView("preview");
    reachStep(8); // entering 公開
  }

  return (
    <div className="app">
      {(sideOpen || panelOpen) && (
        <div
          className="drawer-backdrop"
          onClick={() => {
            setSideOpen(false);
            setPanelOpen(false);
          }}
        />
      )}

      {/* ── Region A: top header bar (full width) ─────────────────────────── */}
      <header className="topbar">
        <div className="topbar-l">
          <button
            className="icon-btn brand-menu"
            onClick={() => setSideOpen(true)}
            aria-label="チャット履歴を開く"
          >
            ☰
          </button>
          <span className="mark" />
          <span className="topbar-name">Loop AI 投稿アシスタント</span>
          <span className="topbar-div" aria-hidden="true">
            │
          </span>
          <nav className="crumb" aria-label="パンくず">
            <span className="crumb-folder" aria-hidden="true">
              {/* folder glyph */}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
            </span>
            <span className="crumb-seg">下書き</span>
            <span className="crumb-chev" aria-hidden="true">
              ›
            </span>
            <span className="crumb-title">{breadcrumbTitle}</span>
          </nav>
        </div>

        <div className="topbar-r">
          <span className="autosave">
            <span className="autosave-dot" aria-hidden="true" />
            自動保存済み・{autosaveTime}
          </span>
          <button
            className="ghost-btn topbar-published"
            onClick={() => setPanelOpen(true)}
            title="公開済みの記事一覧"
          >
            公開済み<span className="brand-panel-count">{blogs.length}</span>
          </button>
          <button
            className="ghost-btn"
            onClick={() => setMobileView("preview")}
            title="公開後の見た目を確認"
          >
            <span aria-hidden="true">👁</span> 公開後の見た目
          </button>
          <button
            className="primary-btn"
            onClick={startPublish}
            disabled={!draft}
            title={draft ? "この記事を公開" : "下書きができると公開できます"}
          >
            公開する →
          </button>
        </div>
      </header>

      {/* ── Region B: full-width 8-step pill row ──────────────────────────── */}
      <StepBar current={step} done={stepsDone} />

      {/* ── Region C: two-column body (chat | live preview) ───────────────── */}
      <div className={`body view-${mobileView}`}>
        <div className={`side ${sideOpen ? "open" : ""}`}>
          <div className="side-head">
            <span className="side-title">チャット履歴</span>
            <button className="new-btn" onClick={newChat}>
              ＋ 新規
            </button>
          </div>
          <div className="conv-list">
            {conversations.length === 0 && (
              <div className="empty center" style={{ fontSize: 13 }}>
                履歴はまだありません
              </div>
            )}
            {conversations.map((c) => (
              <button
                key={c.id}
                className={`conv ${c.id === convId ? "active" : ""}`}
                onClick={() => openConversation(c.id)}
              >
                <span className="conv-title">{c.title}</span>
                <span className="conv-date">
                  {new Date(c.updatedAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}
                </span>
                <span className="del" onClick={(e) => deleteConv(c.id, e)} title="削除">
                  ✕
                </span>
              </button>
            ))}
          </div>
          <button className="logout-btn" onClick={doLogout}>
            ログアウト
          </button>
          <PoweredBy className="side-powered" />
        </div>

        {/* LEFT column: chat */}
        <div className="chat-col">
          <div className="chat-col-head">
            <div className="chat-col-head-l">
              <span className="chat-col-title">✦ AIアシスタント</span>
              <span className="chat-col-sub">と一緒に書きましょう</span>
            </div>
            <span className="chat-col-day">本日</span>
          </div>

          <div className="messages" ref={scrollRef}>
            <div className="thread">
              {messages.length === 0 && !busy && (
                <div className="empty">
                  <em>「リモート社員のオンボーディングについて記事を書きたい」</em>
                  のように話しかけてください。
                  <br />
                  まず記事の目的（集客・SEO・情報提供など）を確認し、構成を提案し、下書きを書き、承認後に右の一覧へ公開します。
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} className={`turn ${m.role}`}>
                  {m.role === "assistant" && (m.text || (!m.draftMarker && !m.seo)) && (
                    <div className="who">アシスタント</div>
                  )}
                  {m.text && <div className={`bubble ${m.role}`}>{m.text}</div>}
                  {m.draftMarker && (
                    <button className="draft-chip" onClick={() => setMobileView("preview")}>
                      ✦ 下書きを作成しました。右の「ライブプレビュー」でご確認ください。
                    </button>
                  )}
                  {m.confirm && (
                    <ConfirmCard
                      data={m.confirm}
                      disabled={busy || i !== messages.length - 1}
                      onChoice={(v) => send(v)}
                    />
                  )}
                  {m.seo && <SeoCard report={m.seo} />}
                </div>
              ))}

              {busy && (streaming || status) && (
                <div className="turn assistant">
                  <div className="who">アシスタント</div>
                  {streaming ? (
                    <div className="bubble assistant">
                      {streaming}
                      <span className="caret" />
                    </div>
                  ) : (
                    status && (
                      <div className="status">
                        <span className="pulse" />
                        <span>
                          {status}
                          <span className="dots" />
                        </span>
                      </div>
                    )
                  )}
                </div>
              )}

              {choices && (
                <div className="options">
                  {choices.map((opt, i) => (
                    <button key={i} className="opt" onClick={() => send(opt)}>
                      {opt}
                    </button>
                  ))}
                  <button className="opt other" onClick={() => textareaRef.current?.focus()}>
                    その他（自由入力）
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="composer">
            <div className="field">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="作りたいブログ記事を入力…"
                rows={1}
              />
              <button className="send" onClick={() => send()} disabled={busy || !input.trim()} aria-label="送信">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT column: live preview */}
        <div className="preview-col">
          {/* mobile back-to-chat affordance */}
          <button className="mobile-only preview-back" onClick={() => setMobileView("chat")}>
            ← チャットに戻る
          </button>
          {draft ? (
            <PreviewPane
              draft={draft}
              aiUpdating={busy}
              confirming={publishConfirming}
              setConfirming={setPublishConfirming}
              onStep={onPreviewStep}
              onPublished={loadBlogs}
            />
          ) : (
            <PreviewEmpty />
          )}
        </div>
      </div>

      <div className={`col panel ${panelOpen ? "open" : ""}`}>
        <div className="panel-head">
          <h2>公開済み</h2>
          <span className="count">{blogs.length}</span>
          <button
            className="icon-btn panel-close"
            onClick={() => setPanelOpen(false)}
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>
        <div className="list">
          {blogs.length === 0 && (
            <div className="empty center">まだ記事はありません。チャットから公開できます。</div>
          )}
          {blogs.map((b) => (
            <button
              key={b.id}
              className="card"
              onClick={() => {
                setSelected(b);
                setPanelOpen(false);
              }}
            >
              <h3>{b.title}</h3>
              <div className="meta">
                {b.category} · {new Date(b.createdAt).toLocaleString("ja-JP")}
              </div>
              <div className="ex">{b.excerpt}</div>
              {b.tags?.length > 0 && (
                <div className="chips">
                  {b.tags.map((t) => (
                    <span key={t} className="chip">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {selected && (
        <div className="sheet" onClick={() => setSelected(null)}>
          <div className="inner" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setSelected(null)} aria-label="閉じる">
              ✕
            </button>
            <div className="doc-meta">
              {selected.category} · /{selected.slug} · {new Date(selected.createdAt).toLocaleString("ja-JP")}
            </div>
            <h1>{selected.title}</h1>
            {selected.featuredImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="doc-hero" src={selected.featuredImageUrl} alt={selected.title} />
            )}
            <div className="eyecatch">アイキャッチ案: {selected.featuredImagePrompt}</div>
            {selected.tags?.length > 0 && (
              <div className="chips" style={{ marginTop: 12 }}>
                {selected.tags.map((t) => (
                  <span key={t} className="chip">
                    {t}
                  </span>
                ))}
              </div>
            )}
            <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(selected.content) }} />
          </div>
        </div>
      )}
    </div>
  );
}
