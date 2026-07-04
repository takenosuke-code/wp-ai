"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { wantsToFinish } from "@/lib/chatIntent";

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
  // §04: SEO results open a dedicated full-screen view; the chat keeps a marker
  // bubble with a button to re-open it.
  seoMarker?: boolean;
  // §03: a one-time card shown in the chat flow when an image is uploaded (the
  // image itself is placed into the draft/preview, not kept as a floating strip).
  upload?: ChatImage;
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
  publishAt?: string;
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
  if (name === "extract_source_facts") return "教えていただいたページを確認しています";
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
// Defensive: small models sometimes forget the [[/CONFIRM]] close tag or stuff an
// [[OPTIONS]] block / prose inside. We bound the block, strip any marker tokens
// and bare button labels, and prefer clean "ラベル: 値" lines. If nothing usable
// remains we return no card and let the message fall back to text + option chips.
function parseConfirm(full: string): { rest: string; confirm?: ConfirmData } {
  const open = full.indexOf(CONF_OPEN);
  if (open === -1) return { rest: full };
  const before = full.slice(0, open);
  const afterOpen = full.slice(open + CONF_OPEN.length);

  // End at [[/CONFIRM]] if present, else at the next [[OPTIONS]], else end of text.
  let inner: string;
  let after: string;
  const closeIdx = afterOpen.indexOf(CONF_CLOSE);
  if (closeIdx !== -1) {
    inner = afterOpen.slice(0, closeIdx);
    after = afterOpen.slice(closeIdx + CONF_CLOSE.length);
  } else {
    const optIdx = afterOpen.indexOf(OPT_OPEN);
    inner = optIdx !== -1 ? afterOpen.slice(0, optIdx) : afterOpen;
    after = optIdx !== -1 ? afterOpen.slice(optIdx) : "";
  }

  const BUTTONS = /^(ok|はい|いいえ|直したい|キャンセル|ok、これで進める)$/i;
  const lines = inner
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s\-*・]+/, "").trim())
    .filter(Boolean)
    .filter((l) => !l.includes("[[") && !l.includes("]]")) // drop stray markers
    .filter((l) => !BUTTONS.test(l)); // drop bare button labels
  // Only clean "ラベル: 値" lines become card items. If the model produced none
  // (sloppy block), we render NO card — the message falls back to plain text +
  // the OK/直したい option chips, which still works. Never show prose/markers.
  const items: ConfirmItem[] = lines
    .map((line) => line.match(/^(.+?)\s*[:：]\s*(.+)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ label: m[1].trim(), value: m[2].trim() }));

  return {
    rest: `${before} ${after}`.trim(),
    confirm: items.length ? { items } : undefined,
  };
}

// Combined parse for a finished assistant message: confirm card + options + body.
// When a confirm card is shown it owns the OK/直したい decision, so we suppress
// any [[OPTIONS]] block on that same message (avoids duplicate choices).
function parseAssistant(full: string): {
  body: string;
  options: string[];
  confirm?: ConfirmData;
} {
  const { rest, confirm } = parseConfirm(full);
  const { body, options } = parseOptions(rest);
  return { body, options: confirm ? [] : options, confirm };
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

// §04 dedicated full-screen SEO view (the proposal's "Step-by-Step" SEO screen):
// a large left step sidebar + a 4-card layout (score / checks / keywords / comp).
const SEO_STEP_ICONS = [
  "M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z", // 内容
  "M3 3h18v18H3z M3 16l5-5 4 4 3-3 6 6", // 画像
  "M12 3v18 M3 12h18 M5.5 5.5l13 13 M18.5 5.5l-13 13", // AI要約
  "M3 21h18 M7 21v-8 M12 21V7 M17 21v-5", // SEO
  "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z", // プレビュー
  "M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z", // タイトル
  "M3 5h18v16H3z M3 9h18 M8 3v4 M16 3v4", // スケジュール
  "M13 2L3 14h7l-1 8 10-12h-7l1-8z", // 公開
];
function Ic({ d, sw = 1.8 }: { d: string; sw?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {d.split(" M").map((p, i) => (
        <path key={i} d={i ? "M" + p : p} />
      ))}
    </svg>
  );
}
const MAGNIFY = "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M21 21l-4.3-4.3";

function SeoScreen({
  report,
  draftTitle,
  stepsDone,
  selectedKw,
  delta,
  onToggleKw,
  onOptimize,
  onBack,
  onProceed,
}: {
  report: SeoReport;
  draftTitle: string;
  stepsDone: number[];
  selectedKw: string[];
  delta: number | null;
  onToggleKw: (term: string) => void;
  onOptimize: () => void;
  onBack: () => void;
  onProceed: () => void;
}) {
  return (
    <div className="seo-screen">
      <aside className="seo-side">
        <div className="seo-side-brand">
          <span className="mark" />
          <span className="seo-side-name">
            Loop <span>AI 投稿アシスタント</span>
          </span>
        </div>
        <div className="seo-side-draft">
          <div className="seo-side-draft-tag">下書き</div>
          <div className="seo-side-draft-title">{draftTitle}</div>
          <div className="seo-side-draft-save">
            <span className="autosave-dot" />
            自動保存済み
          </div>
        </div>
        <div className="seo-side-flow">投稿までの流れ</div>
        <ol className="seo-steps">
          {STEPS.map((label, i) => {
            const n = i + 1;
            const state = n === 4 ? "active" : stepsDone.includes(n) ? "done" : "todo";
            return (
              <li key={n} className={`seo-step ${state}`}>
                <span className="seo-step-ic">
                  {state === "done" ? <Ic d="M5 12l4.5 4.5L19 6" sw={2.4} /> : <Ic d={SEO_STEP_ICONS[i]} />}
                </span>
                <span className="seo-step-txt">
                  <span className="seo-step-n">STEP {String(n).padStart(2, "0")}</span>
                  <span className="seo-step-label">{label}</span>
                </span>
                {state === "active" && <span className="seo-step-chev">›</span>}
              </li>
            );
          })}
        </ol>
      </aside>

      <div className="seo-main">
        <div className="seo-main-head">
          <div className="seo-main-headl">
            <div className="seo-main-step">STEP 04 / 08</div>
            <h1 className="seo-main-title">
              SEOチェック・キーワード提案
              <span className="seo-main-sub">
                {" "}
                — 検索で見つけてもらいやすい記事になっているか確認しましょう
              </span>
            </h1>
          </div>
          <div className="seo-main-actions">
            <button className="ghost-btn" onClick={onBack}>
              ‹ 戻る
            </button>
            <button className="primary-btn" onClick={onProceed}>
              プレビューへ進む →
            </button>
          </div>
        </div>

        <div className="seo-cards">
          <div className="seo-col">
          {/* CARD 01 — score */}
          <div className="seo-card">
            <div className="seo-card-h">
              <span className="seo-card-ic">
                <Ic d="M3 21h18 M7 21v-8 M12 21V7 M17 21v-5" />
              </span>
              <div className="seo-card-ht">
                <div className="seo-card-t">SEOスコア</div>
                <div className="seo-card-sub">検索エンジンからの見つけやすさ</div>
              </div>
              {delta != null && delta > 0 ? (
                <span className="seo-okbadge">✓ +{delta} 改善されました</span>
              ) : delta != null && delta < 0 ? (
                <span className="seo-okbadge down">{delta} 低下</span>
              ) : (
                <span className="seo-okbadge neutral">✓ AIチェック済み</span>
              )}
            </div>
            <div className="seo-score">
              <ScoreRing score={report.score} />
              <div className="seo-score-meta">
                <div className="muted">主キーワード</div>
                <div className="kw">「{report.keyword}」</div>
                <div className="seo-score-stats">
                  <div>
                    <div className="muted">月間検索数</div>
                    <div className="seo-stat">{report.monthlySearches}</div>
                  </div>
                  <div>
                    <div className="muted">競合の強さ</div>
                    <div className="seo-stat">
                      <span className={compClass(report.competition)}>{report.competition}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* CARD 03 — checks */}
          <div className="seo-card">
            <div className="seo-card-h">
              <span className="seo-card-ic">
                <Ic d="M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </span>
              <div className="seo-card-ht">
                <div className="seo-card-t">チェック項目</div>
                <div className="seo-card-sub">AIが自動で確認しました</div>
              </div>
            </div>
            <ul className="seo-checks">
              {report.checks.map((c, i) => (
                <li key={i} className={`chk ${c.status}`}>
                  <span className="chk-i">
                    {c.status === "ok" ? "✓" : c.status === "warn" ? "△" : "＋"}
                  </span>
                  <span className="chk-t">
                    {c.label}
                    {c.note && <span className="chk-note">{c.note}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          </div>

          <div className="seo-col">
          {/* CARD 02 — keyword candidates (selectable) */}
          <div className="seo-card">
            <div className="seo-card-h">
              <span className="seo-card-ic">
                <Ic d={MAGNIFY} />
              </span>
              <div className="seo-card-ht">
                <div className="seo-card-t">キーワード候補</div>
                <div className="seo-card-sub">{selectedKw.length}つ選択中・タップで切り替え</div>
              </div>
            </div>
            <ul className="seo-kwlist">
              {report.keywords.map((k, i) => {
                const on = selectedKw.includes(k.term);
                return (
                  <li key={i}>
                    <button
                      className={`kw-row ${on ? "on" : ""}`}
                      onClick={() => onToggleKw(k.term)}
                      aria-pressed={on}
                    >
                      <span className={`kw-check ${on ? "on" : ""}`} aria-hidden="true">
                        {on && <Ic d="M5 12l4.5 4.5L19 6" sw={3} />}
                      </span>
                      <span className="kw-term">{k.term}</span>
                      {k.volume && <span className="kw-vol muted">{k.volume}</span>}
                      {k.competition && (
                        <span className={compClass(k.competition)}>競合 {k.competition}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            <button
              className="kw-optimize"
              onClick={onOptimize}
              disabled={selectedKw.length === 0}
            >
              選択したキーワードで記事を最適化 →
            </button>
          </div>

          {/* CARD 04 — competitors */}
          <div className="seo-card">
            <div className="seo-card-h">
              <span className="seo-card-ic">
                <Ic d={MAGNIFY} />
              </span>
              <div className="seo-card-ht">
                <div className="seo-card-t">競合ブログを分析</div>
                <div className="seo-card-sub">同じキーワードで上位の記事</div>
              </div>
            </div>
            <ul className="seo-complist">
              {report.competitors.map((c, i) => {
                const href =
                  typeof c.url === "string" && /^https?:\/\//i.test(c.url.trim())
                    ? c.url.trim()
                    : undefined;
                return (
                  <li key={i}>
                    <span className="cmp-rank">{i + 1}</span>
                    <span className="cmp-body">
                      <span className="cmp-title">
                        {href ? (
                          <a href={href} target="_blank" rel="noreferrer noopener">
                            {c.title}
                          </a>
                        ) : (
                          c.title
                        )}
                      </span>
                      <span className="cmp-meta muted">
                        {c.domain}
                        {c.words != null &&
                          ` · ${typeof c.words === "number" ? `${c.words}語` : c.words}`}
                      </span>
                    </span>
                    <span className="cmp-badge">SEO</span>
                  </li>
                );
              })}
            </ul>
          </div>
          </div>
        </div>

        {report.recommendation && (
          <div className="seo-rec">
            <span className="seo-rec-mark">AIの提案</span>
            {report.recommendation}
          </div>
        )}
        <div className="seo-foot muted">
          ※検索数・難易度は推定値です。競合記事は実際の検索結果に基づきます。
        </div>
      </div>
    </div>
  );
}

// ── Interactive draft preview: per-section image "+" slots + client publish ──
type SlotImage = { url: string; alt: string };
// Images uploaded in the chat composer. They carry display metadata for the chat
// cards; `section` is the draft section Claude's vision call chose for placement
// (undefined until placed → positional fallback).
type ChatImage = { url: string; alt: string; name: string; size: number; section?: number };

// Place images into the draft's sections. If a vision-assigned `section` exists we
// use it (§03 SEO-aware placement); otherwise fall back to one-per-section order.
function distributeImages(
  imgs: { url: string; alt: string; section?: number }[],
  sectionCount: number
): SlotImage[][] {
  const slots: SlotImage[][] = Array.from({ length: Math.max(sectionCount, 1) }, () => []);
  imgs.forEach((im, i) => {
    const sec = typeof im.section === "number" ? im.section : i;
    slots[Math.min(Math.max(sec, 0), slots.length - 1)].push({ url: im.url, alt: im.alt });
  });
  return slots;
}

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
  chatImages,
  aiUpdating,
  confirming,
  setConfirming,
  publishAt,
  onStep,
  onPublished,
}: {
  draft: DraftPreview;
  chatImages: ChatImage[];
  aiUpdating: boolean;
  confirming: boolean;
  setConfirming: (v: boolean) => void;
  publishAt: string | null;
  onStep: (n: number) => void;
  onPublished: () => void;
}) {
  const sections = useMemo(() => splitSections(draft.content), [draft.content]);
  // Slots start auto-filled with the chat-uploaded images (§03 自動配置); the
  // user can still adjust them per section below.
  const [slots, setSlots] = useState<SlotImage[][]>(() =>
    distributeImages(chatImages, sections.length)
  );
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  // When set, the next picked file REPLACES this image instead of appending.
  const [replaceTarget, setReplaceTarget] = useState<{ slot: number; img: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<PreviewMode>("pc");
  const fileRef = useRef<HTMLInputElement>(null);

  // Re-distribute when a revision arrives or new chat images are added.
  useEffect(() => {
    setSlots(distributeImages(chatImages, sections.length));
    setPublished(false);
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.content, chatImages]);

  function pick(slotIdx: number) {
    if (uploading || published) return;
    setReplaceTarget(null);
    setActiveSlot(slotIdx);
    fileRef.current?.click();
  }

  function replace(slotIdx: number, imgIdx: number) {
    if (uploading || published) return;
    setReplaceTarget({ slot: slotIdx, img: imgIdx });
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
      const next = { url: data.url, alt };
      if (replaceTarget) {
        const { slot, img } = replaceTarget;
        setSlots((s) =>
          s.map((arr, i) => (i === slot ? arr.map((im, j) => (j === img ? next : im)) : arr))
        );
      } else {
        setSlots((s) => s.map((arr, i) => (i === slotIdx ? [...arr, next] : arr)));
      }
      onStep(2); // 画像をアップ: an image was placed
    } catch (err: any) {
      setError(err?.message ?? "アップロードに失敗しました");
    } finally {
      setUploading(false);
      setActiveSlot(null);
      setReplaceTarget(null);
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
      for (const im of slots[i] ?? []) {
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
          publishAt: publishAt ?? undefined,
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

          {/* Eyecatch hint only while there are no images at all; once images
              exist they render full-size inside their own sections below. */}
          {imageCount === 0 && (
            <div className="preview-hero-empty">
              アイキャッチ案: {draft.featuredImagePrompt}
            </div>
          )}

          {/* body: each section + its full-size images + an "add more" affordance */}
          {sections.map((sec, i) => (
            <div key={i}>
              <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(sec) }} />
              {(slots[i] ?? []).length > 0 && (
                <div className="sec-images">
                  {(slots[i] ?? []).map((im, j) => (
                    <figure key={j} className="sec-img">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={im.url} alt={im.alt} />
                      {!published && (
                        <div className="sec-img-tools">
                          <button onClick={() => replace(i, j)} disabled={uploading}>
                            差し替え
                          </button>
                          <button onClick={() => removeImg(i, j)} disabled={uploading}>
                            削除
                          </button>
                        </div>
                      )}
                    </figure>
                  ))}
                </div>
              )}
              {!published && (
                <button
                  className="add-more"
                  onClick={() => pick(i)}
                  disabled={uploading}
                  title="このセクションに画像を追加"
                >
                  {uploading && activeSlot === i && !replaceTarget ? (
                    <span className="add-spin" />
                  ) : (
                    <>
                      <span className="add-plus">＋</span>
                      {(slots[i] ?? []).length > 0 ? "画像をもう一枚追加" : "画像を追加"}
                    </>
                  )}
                </button>
              )}
            </div>
          ))}

          {error && <div className="draft-error">{error}</div>}
        </div>
      </div>

      {/* Publish is triggered by the HEADER 公開する button (no bottom button).
          The confirm dialog and the done message still anchor at the bottom. */}
      {published ? (
        <div className="pubbar">
          <span className="pub-done">
            {publishAt
              ? `✓ 予約しました（${fmtJst(publishAt)} に公開）。`
              : "✓ 公開しました。右の「公開済み」一覧に表示されています。"}
          </span>
        </div>
      ) : confirming ? (
        <div className="pubbar">
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
                <dd>{publishAt ? `${fmtJst(publishAt)}（予約）` : "今すぐ公開（即時）"}</dd>
              </div>
              {imageCount > 0 && (
                <div>
                  <dt>画像</dt>
                  <dd>{imageCount} 枚</dd>
                </div>
              )}
            </dl>
            <p className="pub-confirm-note">
              公開すると右の一覧と公開サイトにすぐ表示されます。まだ直したいところがあれば「キャンセル」で戻り、チャットで修正をお願いできます（公開はまだされません）。
            </p>
            <div className="pub-confirm-btns">
              <button className="pub-btn" onClick={doPublish} disabled={publishing}>
                {publishing ? "公開中…" : "公開する"}
              </button>
              <button className="pub-cancel" onClick={() => setConfirming(false)} disabled={publishing}>
                キャンセルして修正
              </button>
            </div>
          </div>
        </div>
      ) : null}
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

// Shown in the preview pane while the writer is composing the first draft, so the
// user sees clear "AI is working" feedback (blinking badge + shimmer skeleton).
function PreviewLoading() {
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
        <div className="preview-loading">
          <div className="pl-badge">
            <span className="pl-spark">✦</span> AIが記事を作成しています…
          </div>
          <div className="pl-line w35 sk" />
          <div className="pl-title sk" />
          <div className="pl-block sk" />
          <div className="pl-line w90 sk" />
          <div className="pl-line w80 sk" />
          <div className="pl-line w60 sk" />
          <div className="pl-line w85 sk" />
          <div className="pl-line w50 sk" />
          <p className="pl-hint muted">
            構成にそって本文を書いています。30秒ほどかかる場合があります。
          </p>
        </div>
      </div>
    </div>
  );
}

// §06 タイトル設定: edit the post's metadata (title/slug/category/tags/excerpt)
// before publishing, with a search-result preview. No model calls — publishing
// reuses the draft body + images with these edited values.
function TitleSettings({
  draft,
  onCancel,
  onProceed,
}: {
  draft: DraftPreview;
  onCancel: () => void;
  onProceed: (f: {
    title: string;
    slug: string;
    category: string;
    tags: string[];
    excerpt: string;
  }) => void;
}) {
  const [title, setTitle] = useState(draft.title);
  const [slug, setSlug] = useState(draft.slug);
  const [category, setCategory] = useState(draft.category);
  const [tags, setTags] = useState((draft.tags ?? []).join(", "));
  const [excerpt, setExcerpt] = useState(draft.excerpt);
  const tagList = tags
    .split(/[,、]/)
    .map((t) => t.trim())
    .filter(Boolean);
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="ts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ts-head">
          <div>
            <div className="ts-step">STEP 06 / 08</div>
            <h2 className="ts-title">タイトル設定</h2>
            <div className="ts-sub">検索結果や一覧での見え方を整えます。</div>
          </div>
          <button className="ts-x" onClick={onCancel} aria-label="閉じる">
            ✕
          </button>
        </div>
        <div className="ts-body">
          <label className="ts-field">
            <span className="ts-flabel">タイトル</span>
            <input className="ts-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="ts-field">
            <span className="ts-flabel">URLスラッグ</span>
            <input
              className="ts-input mono"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="例: cs61c-guide"
            />
          </label>
          <div className="ts-row">
            <label className="ts-field">
              <span className="ts-flabel">カテゴリ</span>
              <input
                className="ts-input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </label>
            <label className="ts-field">
              <span className="ts-flabel">タグ（カンマ区切り）</span>
              <input
                className="ts-input"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="例: 学習, 大学, CS"
              />
            </label>
          </div>
          <label className="ts-field">
            <span className="ts-flabel">
              抜粋（メタディスクリプション）
              <span className={`ts-count ${excerpt.length > 160 ? "over" : ""}`}>
                {excerpt.length}字
              </span>
            </span>
            <textarea
              className="ts-textarea"
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              rows={3}
              placeholder="検索結果や一覧に表示される120〜160字の説明文"
            />
          </label>

          <div className="ts-preview">
            <div className="ts-preview-tag">検索結果プレビュー</div>
            <div className="ts-snippet">
              <div className="ts-snip-url">loopasia.com › blog › {slug || "…"}</div>
              <div className="ts-snip-title">{title || "（タイトル未設定）"}</div>
              <div className="ts-snip-desc">{excerpt || "（抜粋がここに表示されます）"}</div>
            </div>
            {(category || tagList.length > 0) && (
              <div className="preview-chips" style={{ marginTop: 10 }}>
                {category && <span className="cat-chip">{category}</span>}
                {tagList.map((t) => (
                  <span key={t} className="tag-chip"># {t}</span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="ts-foot">
          <button className="pub-cancel" onClick={onCancel}>
            キャンセル
          </button>
          <button
            className="pub-btn"
            disabled={!title.trim() || !slug.trim()}
            onClick={() =>
              onProceed({
                title: title.trim(),
                slug: slug.trim(),
                category: category.trim(),
                tags: tagList,
                excerpt: excerpt.trim(),
              })
            }
          >
            スケジュールへ進む →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── §07 schedule helpers (the product is Japan-facing; Supabase stores UTC) ──
// Current JST wall-clock as a datetime-local value "YYYY-MM-DDTHH:mm".
function jstNowLocal(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .replace(" ", "T");
}
// A naive JST datetime-local string → absolute UTC ISO (force +09:00).
function jstLocalToUtc(local: string): string {
  return new Date(`${local}:00+09:00`).toISOString();
}
// A UTC ISO instant → friendly JST string for display.
function fmtJst(utcIso: string): string {
  return new Date(utcIso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// §07 スケジュール: choose 今すぐ公開 or a future date/time (interpreted as JST).
function ScheduleStep({
  onBack,
  onCancel,
  onProceed,
}: {
  onBack: () => void;
  onCancel: () => void;
  onProceed: (publishAt: string | null) => void;
}) {
  const [mode, setMode] = useState<"now" | "later">("now");
  const [dt, setDt] = useState("");
  const minDt = jstNowLocal();
  const utc = mode === "later" && dt ? jstLocalToUtc(dt) : null;
  const isFuture = utc != null && new Date(utc).getTime() > Date.now();
  const canProceed = mode === "now" || isFuture;
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="ts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ts-head">
          <div>
            <div className="ts-step">STEP 07 / 08</div>
            <h2 className="ts-title">スケジュール</h2>
            <div className="ts-sub">今すぐ公開するか、日時を指定して予約します。</div>
          </div>
          <button className="ts-x" onClick={onCancel} aria-label="閉じる">
            ✕
          </button>
        </div>
        <div className="ts-body">
          <button
            className={`sch-opt ${mode === "now" ? "on" : ""}`}
            onClick={() => setMode("now")}
          >
            <span className={`sch-radio ${mode === "now" ? "on" : ""}`} />
            <span className="sch-opt-t">
              <span className="sch-opt-h">今すぐ公開</span>
              <span className="sch-opt-d">確定するとすぐに公開サイトへ表示されます。</span>
            </span>
          </button>
          <button
            className={`sch-opt ${mode === "later" ? "on" : ""}`}
            onClick={() => setMode("later")}
          >
            <span className={`sch-radio ${mode === "later" ? "on" : ""}`} />
            <span className="sch-opt-t">
              <span className="sch-opt-h">日時を指定して予約</span>
              <span className="sch-opt-d">
                指定した時刻になるまで公開サイトには表示されません。
              </span>
            </span>
          </button>
          {mode === "later" && (
            <div className="sch-when">
              <label className="ts-field">
                <span className="ts-flabel">公開日時（日本時間 JST）</span>
                <input
                  className="ts-input"
                  type="datetime-local"
                  value={dt}
                  min={minDt}
                  onChange={(e) => setDt(e.target.value)}
                />
              </label>
              {dt && !isFuture && (
                <div className="sch-warn">未来の日時を指定してください。</div>
              )}
              {utc && isFuture && (
                <div className="sch-confirm-when">予約: {fmtJst(utc)} に公開</div>
              )}
            </div>
          )}
        </div>
        <div className="ts-foot">
          <button className="pub-cancel" onClick={onBack}>
            ‹ 戻る
          </button>
          <button
            className="pub-btn"
            disabled={!canProceed}
            onClick={() => onProceed(mode === "now" ? null : utc)}
          >
            確認へ進む →
          </button>
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
  // True while the writer (propose_blog_post) is composing — drives the preview
  // "作成中" loader so the user isn't staring at an empty pane.
  const [drafting, setDrafting] = useState(false);
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
  // §06 タイトル設定: edit title/slug/category/tags/excerpt before publishing.
  const [titleOpen, setTitleOpen] = useState(false);
  // §07 スケジュール: the chosen publish time (UTC ISO; null = 今すぐ).
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [publishAt, setPublishAt] = useState<string | null>(null);
  // §03: images uploaded in the chat composer (before/while drafting). They show
  // as cards in the chat and are auto-placed into the draft (see PreviewPane).
  const [chatImages, setChatImages] = useState<ChatImage[]>([]);
  const [chatUploading, setChatUploading] = useState(false);
  // §03 image step: after gathering, BEFORE the recap, we ask 「画像を追加しますか？」.
  // `imageAsked` = the step has been resolved (added or skipped). `heldConfirm`
  // is the model's recap card, held back until images are resolved — so the user
  // sees: gather → image ask → recap. Skipping is pure client-side (no API call).
  const [imageAsked, setImageAsked] = useState(false);
  const [heldConfirm, setHeldConfirm] = useState<{ text: string; confirm: ConfirmData } | null>(
    null
  );
  // §04 dedicated SEO screen: the latest report, whether the full-screen view is
  // open, and which keyword candidates the user has selected to target.
  const [seoReport, setSeoReport] = useState<SeoReport | null>(null);
  const [seoOpen, setSeoOpen] = useState(false);
  const [seoKw, setSeoKw] = useState<string[]>([]);
  // Score delta vs the previous SEO check (drives "+N 改善されました"); the ref
  // survives re-renders so we can compare across checks in a conversation.
  const [seoDelta, setSeoDelta] = useState<number | null>(null);
  const seoScoreRef = useRef<number | null>(null);
  const chatFileRef = useRef<HTMLInputElement>(null);
  // The step we were on before entering the publish flow (タイトル設定 → スケジュール
  // → 公開確認). Backing out restores it so the step bar never stays stuck on 6/7/8.
  const stepBeforePublishRef = useRef(1);
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
  const placingRef = useRef(false);

  async function loadBlogs() {
    const res = await fetch("/api/blogs").catch(() => null);
    if (res?.ok) {
      const data = await res.json().catch(() => null);
      if (Array.isArray(data)) setBlogs(data);
    }
  }

  async function loadConversations() {
    const res = await fetch("/api/conversations").catch(() => null);
    if (res?.ok) {
      const data = await res.json().catch(() => null);
      if (Array.isArray(data)) setConversations(data);
    }
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
    setTitleOpen(false);
    setScheduleOpen(false);
    setPublishAt(null);
    setChatImages([]);
    setImageAsked(false);
    setHeldConfirm(null);
    setSeoReport(null);
    setSeoOpen(false);
    setSeoKw([]);
    setSeoDelta(null);
    seoScoreRef.current = null;
    setMobileView("chat");
    setSideOpen(false);
    const res = await fetch(`/api/conversations/${id}`).catch(() => null);
    if (res?.ok) {
      const data = await res.json().catch(() => null);
      if (!data) {
        setMessages([]);
        return;
      }
      const msgs: ChatMsg[] = (data.messages as { role: string; text: string }[]).map((m) => {
        if (m.role === "assistant") {
          const { body, options, confirm } = parseAssistant(m.text);
          return { role: "assistant", text: body, options, confirm };
        }
        return { role: "user", text: m.text };
      });
      setMessages(msgs);
      // Restore the live preview: the draft is stored in the conversation, so it
      // survives a reload/crash instead of leaving the preview blank.
      if (data.draft) {
        setDraft(data.draft);
        setStepsDone((d) => Array.from(new Set([...d, 1, 2, 3])));
        setStep((s) => Math.max(s, 4)); // a draft exists → at least SEOチェック
      }
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
    setTitleOpen(false);
    setScheduleOpen(false);
    setPublishAt(null);
    setChatImages([]);
    setImageAsked(false);
    setHeldConfirm(null);
    setSeoReport(null);
    setSeoOpen(false);
    setSeoKw([]);
    setSeoDelta(null);
    seoScoreRef.current = null;
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

  // §03 vision placement: once a draft exists, ask Claude (vision) which section
  // each newly-added image fits best + an SEO alt. Runs ONLY for unplaced images,
  // so skipping/adding-none costs nothing. Falls back to positional on failure.
  useEffect(() => {
    if (!draft || placingRef.current) return;
    const pending = chatImages.filter((im) => im.section === undefined);
    if (pending.length === 0) return;
    placingRef.current = true;
    (async () => {
      const secs = splitSections(draft.content).map((s) =>
        s.replace(/[#>*`_-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)
      );
      for (const im of pending) {
        let section = 0;
        let alt = im.alt;
        try {
          const res = await fetch("/api/place-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageUrl: im.url, sections: secs, title: draft.title }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok) {
            if (Number.isInteger(data.section)) section = data.section;
            if (data.alt) alt = data.alt;
          }
        } catch {
          /* keep defaults (positional section 0) */
        }
        setChatImages((cur) =>
          cur.map((c) => (c.url === im.url ? { ...c, section, alt } : c))
        );
      }
      placingRef.current = false;
    })();
  }, [draft, chatImages]);

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
        setDrafting(false); // safety: clear if the writer errored before a draft
        if (confirm && !imageAsked) {
          // Content is gathered. Insert the image step BEFORE the recap: hold the
          // recap and show 「画像を追加しますか？」 first (gather → 画像 → recap).
          markDone(1); // 内容を伝える done
          reachStep(2); // 画像をアップ now in progress
          setHeldConfirm({ text: body, confirm });
        } else {
          if (body || options.length || confirm) {
            setMessages((m) => [...m, { role: "assistant", text: body, options, confirm }]);
          }
          if (confirm) {
            markDone(1);
            reachStep(3); // recap shown directly (image step already resolved)
          }
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

    // Guardrail (RC2): if the user types in chat while the image-step card is up
    // (instead of clicking この画像で進む), resolve that step first so it never
    // stays stuck floating over the rest of the conversation.
    if (heldConfirm && !imageAsked) resolveImageStep();

    // Guardrail: once a draft exists, a free-typed "just publish it / finish it"
    // is routed to the cancelable publish flow (with its final confirm) rather
    // than the model, which has no publish tool. Only for text typed in the
    // composer (textArg === undefined), and never for negations/edits.
    if (textArg === undefined && draft && wantsToFinish(text)) {
      setInput("");
      setMessages((m) => [...m, { role: "user", text }]);
      startPublish();
      return;
    }

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
    setDrafting(false);
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

      // Guardrail: a non-OK status (e.g. 409 "already processing", 401 session
      // expired, 500) is NOT the NDJSON stream — surface it instead of silently
      // swallowing every line as an unparseable JSON chunk.
      if (!res.ok || !res.body) {
        const d = res.ok ? ({} as any) : await res.json().catch(() => ({} as any));
        targetRef.current += `\n\n[エラー: ${d.error || `通信に失敗しました (${res.status})`}]`;
        return; // finally sets doneRef → the message renders with the error
      }

      const reader = res.body.getReader();
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
            if (evt.name === "propose_blog_post") setDrafting(true);
          } else if (evt.type === "step") {
            // Backend tool→step hints are ignored: the step bar is driven by the
            // real client-side milestones below (confirm card, draft, seo, publish).
          } else if (evt.type === "draft") {
            // The proposed (not-yet-published) post. It now lives in the RIGHT
            // live-preview pane (region C), not the chat stream. We also drop a
            // small marker in the chat so the conversation reads naturally, and
            // auto-switch the mobile view to the preview so the user sees it.
            setDraft(evt.draft);
            setDrafting(false);
            setPublishConfirming(false);
            setMobileView("preview");
            setMessages((m) => [
              ...m,
              { role: "assistant", text: "", draftMarker: true },
            ]);
            setStatus(null);
            // Draft written → 内容(1)・画像(2)・AI要約(3) done; SEOチェック(4) is next
            // (the canned options offer it). Don't jump to プレビュー(5) yet.
            markDone(1, 2, 3);
            reachStep(4);
          } else if (evt.type === "seo") {
            // Open the dedicated SEO screen; pre-select the top 2 keyword
            // candidates (matches the mockup's "2つ選択中"). Drop a chat marker.
            // Delta vs the previous check → "+N 改善されました".
            const prev = seoScoreRef.current;
            setSeoDelta(prev != null ? evt.report.score - prev : null);
            seoScoreRef.current = evt.report.score;
            setSeoReport(evt.report);
            setSeoKw((evt.report.keywords ?? []).slice(0, 2).map((k: SeoKeyword) => k.term));
            setSeoOpen(true);
            setMessages((m) => [...m, { role: "assistant", text: "", seoMarker: true }]);
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
    // §03: ⌘+↵ (or Ctrl+Enter) sends; plain Enter inserts a newline so
    // non-technical users can write freely without accidental sends.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  }

  // §03: upload an image from the chat composer (before/while drafting). It joins
  // the chat as a card and is auto-placed into the draft.
  async function onChatImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setChatUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "アップロードに失敗しました");
      const alt = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "image";
      const img = { url: data.url, alt, name: file.name, size: file.size };
      setChatImages((imgs) => [...imgs, img]);
      // One-time card in the conversation flow; the image itself is placed into
      // the draft/preview (vision), not kept as a floating strip above the input.
      setMessages((m) => [...m, { role: "user", text: "", upload: img }]);
      markDone(2); // 画像をアップ
    } catch {
      // surfaced inline elsewhere; keep the composer quiet on failure
    } finally {
      setChatUploading(false);
    }
  }


  const toggleSeoKw = (term: string) =>
    setSeoKw((k) => (k.includes(term) ? k.filter((t) => t !== term) : [...k, term]));

  // Resolve the image step (skip or after adding) → reveal the held recap card.
  function resolveImageStep() {
    setImageAsked(true);
    markDone(2);
    reachStep(3);
    if (heldConfirm) {
      const hc = heldConfirm;
      setMessages((m) => [...m, { role: "assistant", text: hc.text, confirm: hc.confirm }]);
      setHeldConfirm(null);
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
  // §06: "公開する →" first opens タイトル設定 (edit metadata), then the confirm.
  function startPublish() {
    if (!draft) return;
    setMobileView("preview");
    if (!titleOpen && !scheduleOpen) stepBeforePublishRef.current = step;
    setTitleOpen(true);
    reachStep(6); // タイトル設定
  }
  // Back out of the publish flow (cancel タイトル設定 / スケジュール / 公開確認):
  // restore the step we were on AND drop any done-marks above it, so the bar
  // never stays stuck — or falsely checked — on a step the user abandoned.
  function exitPublishFlow() {
    const back = stepBeforePublishRef.current;
    setStep(back);
    setStepsDone((d) => d.filter((n) => n <= back));
  }
  // After タイトル設定: merge the edited metadata into the draft, then open the
  // publish confirm (no model cost — publishing reuses the draft body + images).
  function proceedFromTitle(fields: {
    title: string;
    slug: string;
    category: string;
    tags: string[];
    excerpt: string;
  }) {
    setDraft((d) => (d ? { ...d, ...fields } : d));
    setTitleOpen(false);
    markDone(6);
    reachStep(7); // → スケジュール
    setScheduleOpen(true);
  }
  // After スケジュール: record the publish time (null = 今すぐ) and open the confirm.
  function proceedFromSchedule(when: string | null) {
    setPublishAt(when);
    setScheduleOpen(false);
    markDone(7);
    reachStep(8);
    setPublishConfirming(true);
  }

  // A chat option chip. A "publish" intent (e.g. そのまま公開する) opens the publish
  // flow (タイトル設定) instead of being sent to the AI, which can't publish.
  function onOption(opt: string) {
    if (draft && /公開/.test(opt) && !/(SEO|プレビュー|見た目|済み|確認)/.test(opt)) {
      startPublish();
      return;
    }
    send(opt);
  }

  // "おまかせで進める": one affordance on every step that just moves forward with
  // sensible defaults grounded in what the user has already said — so a user who
  // doesn't want to answer more questions is never stuck. Behavior by phase:
  //   • draft exists → open the (final-confirm) publish flow with the writer's
  //     own title/tags/etc as defaults — no model call.
  //   • image step  → proceed past it (reveal the recap), same as この画像で進む.
  //   • gathering    → tell the model to stop asking and fill remaining brief
  //     details with reasonable defaults, up to the これでいいですか confirm.
  function onContinue() {
    if (busy) return;
    if (draft) {
      startPublish();
      return;
    }
    if (heldConfirm && !imageAsked) {
      resolveImageStep();
      return;
    }
    send(
      "ここまでの内容でお任せします。これ以上は質問せず、一般的な情報と常識的な前提で不足を補って、「これでいいですか？」の確認まで進めてください。"
    );
  }

  return (
    <div className="app">
      {titleOpen && draft && (
        <TitleSettings
          draft={draft}
          onCancel={() => {
            setTitleOpen(false);
            exitPublishFlow(); // un-stick the step bar
          }}
          onProceed={proceedFromTitle}
        />
      )}
      {scheduleOpen && draft && (
        <ScheduleStep
          onCancel={() => {
            setScheduleOpen(false);
            exitPublishFlow(); // un-stick the step bar
          }}
          onBack={() => {
            setScheduleOpen(false);
            setTitleOpen(true);
            setStep(6); // back to タイトル設定
          }}
          onProceed={proceedFromSchedule}
        />
      )}
      {seoOpen && seoReport && (
        <SeoScreen
          report={seoReport}
          draftTitle={draft?.title ?? "下書き"}
          stepsDone={stepsDone}
          selectedKw={seoKw}
          delta={seoDelta}
          onToggleKw={toggleSeoKw}
          onOptimize={() => {
            if (seoKw.length === 0) return;
            setSeoOpen(false);
            send(
              `選択したキーワード「${seoKw.join(
                "」「"
              )}」を意識して、タイトル・見出し・本文に自然に反映する形で記事を最適化してください。`
            );
          }}
          onBack={() => setSeoOpen(false)}
          onProceed={() => {
            setSeoOpen(false);
            markDone(4);
            reachStep(5);
            setMobileView("preview");
          }}
        />
      )}
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
          <span className="topbar-name">
            Loop AI<span className="topbar-name-full"> 投稿アシスタント</span>
          </span>
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
            <span aria-hidden="true">👁</span> <span className="btn-label">公開後の見た目</span>
          </button>
          <button
            className="primary-btn"
            onClick={startPublish}
            disabled={!draft}
            title={draft ? "タイトル設定へ進む" : "下書きができると進めます"}
          >
            タイトル設定へ →
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
                  {m.role === "assistant" &&
                    (m.text || (!m.draftMarker && !m.seo && !m.seoMarker)) && (
                      <div className="who">アシスタント</div>
                    )}
                  {m.text && <div className={`bubble ${m.role}`}>{m.text}</div>}
                  {m.upload && (
                    <div className="upload-card inflow">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.upload.url} alt={m.upload.alt} />
                      <div className="upload-meta">
                        <div className="upload-name">{m.upload.name}</div>
                        <div className="upload-size">
                          画像を追加しました{draft ? "・プレビューに配置" : ""}
                        </div>
                      </div>
                    </div>
                  )}
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
                  {m.seoMarker && (
                    <button
                      className="draft-chip"
                      onClick={() => seoReport && setSeoOpen(true)}
                    >
                      ✦ SEOチェックが完了しました。結果を見る
                    </button>
                  )}
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

              {heldConfirm && !imageAsked && (
                <div className="img-ask">
                  <div className="img-ask-h">記事に画像を追加しますか？</div>
                  <div className="img-ask-sub">
                    追加すると、記事の作成時にAIが内容を見て最適な位置に配置します。スキップしても大丈夫です。
                  </div>
                  <div className="img-ask-btns">
                    <button
                      className="img-ask-yes"
                      onClick={() => chatFileRef.current?.click()}
                      disabled={chatUploading}
                    >
                      {chatUploading
                        ? "アップロード中…"
                        : chatImages.length > 0
                        ? "さらに追加"
                        : "画像を追加する"}
                    </button>
                    <button className="img-ask-no" onClick={resolveImageStep}>
                      {chatImages.length > 0 ? "この画像で進む" : "画像なしで進む"}
                    </button>
                  </div>
                </div>
              )}

              {(choices || (draft && !busy && !streaming)) && (
                <div className="options">
                  {choices?.map((opt, i) => (
                    <button
                      key={i}
                      className={`opt ${/SEO/i.test(opt) ? "opt-seo" : ""}`}
                      onClick={() => onOption(opt)}
                    >
                      {opt}
                    </button>
                  ))}
                  {/* once a draft exists, always offer the publish path in chat too */}
                  {draft && (
                    <button className="opt opt-go" onClick={startPublish}>
                      タイトル設定へ進む →
                    </button>
                  )}
                  {/* every AI-driven step gets a one-click "just proceed with
                      sensible defaults" so the user is never forced to keep
                      answering questions (grounded in what they've already said) */}
                  {choices && !draft && (
                    <button className="opt opt-omakase" onClick={onContinue}>
                      おまかせで進めて
                    </button>
                  )}
                  {choices && (
                    <button className="opt other" onClick={() => textareaRef.current?.focus()}>
                      その他（自由入力）
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="composer">
            <input ref={chatFileRef} type="file" accept="image/*" hidden onChange={onChatImage} />
            <div className="field">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="作りたいブログ記事を入力…"
                rows={1}
              />
              {/* §03 スマート入力欄: 画像（実装）・ファイル/音声（表示のみ）・送信 */}
              <div className="composer-bar">
                <div className="composer-tools">
                  <button
                    className="tool-btn"
                    onClick={() => chatFileRef.current?.click()}
                    disabled={chatUploading}
                    title="画像を追加"
                    aria-label="画像を追加"
                  >
                    {chatUploading ? (
                      <span className="add-spin" />
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <path d="M21 15l-5-5L5 21" />
                      </svg>
                    )}
                  </button>
                  <button className="tool-btn" disabled title="ファイル添付（近日対応）" aria-label="ファイル添付（近日対応）">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.44 11.05l-9.19 9.19a5 5 0 0 1-7.07-7.07l9.19-9.19a3 3 0 0 1 4.24 4.24l-9.2 9.19a1 1 0 0 1-1.41-1.41l8.49-8.49" />
                    </svg>
                  </button>
                  <button className="tool-btn" disabled title="音声入力（近日対応）" aria-label="音声入力（近日対応）">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="2" width="6" height="12" rx="3" />
                      <path d="M5 10a7 7 0 0 0 14 0 M12 17v4" />
                    </svg>
                  </button>
                </div>
                <span className="composer-hint">⌘ + ↵ で送信</span>
                <button className="send" onClick={() => send()} disabled={busy || !input.trim()} aria-label="送信">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                </button>
              </div>
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
              chatImages={chatImages}
              aiUpdating={busy}
              confirming={publishConfirming}
              setConfirming={(v) => {
                setPublishConfirming(v);
                // closing the confirm (キャンセル or a failed publish) must not
                // leave the step bar stuck on 08; a successful publish re-advances
                // via onStep(8) right after, so that path stays correct.
                if (!v) exitPublishFlow();
              }}
              publishAt={publishAt}
              onStep={onPreviewStep}
              onPublished={loadBlogs}
            />
          ) : drafting ? (
            <PreviewLoading />
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
              <h3>
                {b.title}
                {b.publishAt && new Date(b.publishAt).getTime() > Date.now() && (
                  <span className="sched-badge">予約</span>
                )}
              </h3>
              <div className="meta">
                {b.category} ·{" "}
                {b.publishAt && new Date(b.publishAt).getTime() > Date.now()
                  ? `${fmtJst(b.publishAt)} 公開予定`
                  : new Date(b.createdAt).toLocaleString("ja-JP")}
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
