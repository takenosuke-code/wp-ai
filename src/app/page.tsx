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
type ChatMsg = {
  role: "user" | "assistant";
  text: string;
  options?: string[];
  draft?: DraftPreview;
  seo?: SeoReport;
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

function displayBody(s: string): string {
  const idx = s.indexOf(OPT_OPEN);
  if (idx !== -1) return s.slice(0, idx).trimEnd();
  for (let n = Math.min(OPT_OPEN.length - 1, s.length); n > 0; n--) {
    if (s.endsWith(OPT_OPEN.slice(0, n))) return s.slice(0, s.length - n).trimEnd();
  }
  return s;
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

// ── 8-step progress bar (matches the design proposal's 投稿フロー) ──────────
const STEPS = ["内容", "方向性", "構成", "下書き", "画像", "SEO", "確認", "公開"];

function StepBar({ current }: { current: number }) {
  return (
    <div className="steps" role="list" aria-label="投稿の進行状況">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < current ? "done" : n === current ? "active" : "todo";
        return (
          <div key={n} className={`step ${state}`} role="listitem">
            <span className="step-n">{n < current ? "✓" : String(n).padStart(2, "0")}</span>
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

function DraftCard({
  draft,
  onStep,
  onPublished,
}: {
  draft: DraftPreview;
  onStep: (n: number) => void;
  onPublished: () => void;
}) {
  const sections = useMemo(() => splitSections(draft.content), [draft.content]);
  const [slots, setSlots] = useState<SlotImage[][]>(() => sections.map(() => []));
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

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
      onStep(5);
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

  return (
    <div className="draft">
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
      <div className="draft-tag">{published ? "公開済み ✓" : "下書きプレビュー（未公開）"}</div>
      <div className="draft-meta">
        {draft.category} · /{draft.slug}
      </div>
      <h1 className="draft-title">{draft.title}</h1>
      <div className="draft-eyecatch">アイキャッチ案: {draft.featuredImagePrompt}</div>
      {draft.tags?.length > 0 && (
        <div className="chips" style={{ margin: "10px 0" }}>
          {draft.tags.map((t) => (
            <span key={t} className="chip">
              {t}
            </span>
          ))}
        </div>
      )}

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
                  onStep(7);
                }}
              >
                公開する →
              </button>
            </>
          ) : (
            <div className="pub-confirm">
              <span>公開すると右の一覧と公開サイトに表示されます。よろしいですか？</span>
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
  const [step, setStep] = useState(1);
  // Mobile-only off-canvas drawers (the two side columns). Never toggled on
  // desktop — the toggle buttons are display:none above the mobile breakpoint.
  const [sideOpen, setSideOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  // The progress bar only moves forward within a conversation (revisions don't
  // regress it); it resets when a new/other conversation is opened.
  const bumpStep = (n: number) => setStep((s) => Math.max(s, n));

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
    setSideOpen(false);
    const res = await fetch(`/api/conversations/${id}`);
    if (res.ok) {
      const data = await res.json();
      const msgs: ChatMsg[] = (data.messages as { role: string; text: string }[]).map((m) => {
        if (m.role === "assistant") {
          const { body, options } = parseOptions(m.text);
          return { role: "assistant", text: body, options };
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
        const { body, options } = parseOptions(targetRef.current);
        setStreaming("");
        setStatus(null);
        setBusy(false);
        if (body || options.length) {
          setMessages((m) => [...m, { role: "assistant", text: body, options }]);
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
    bumpStep(1);
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
            bumpStep(2); // 方向性: the assistant is replying
          } else if (evt.type === "tool") {
            setStatus(toolLabel(evt.name));
          } else if (evt.type === "step") {
            bumpStep(evt.step);
          } else if (evt.type === "draft") {
            // The proposed (not-yet-published) post: show an interactive preview
            // (image "+" slots + 公開する) so the user reviews/publishes it directly.
            setMessages((m) => [...m, { role: "assistant", text: "", draft: evt.draft }]);
            setStatus(null);
            bumpStep(5); // 画像: a draft now exists; images can be added
          } else if (evt.type === "seo") {
            setMessages((m) => [...m, { role: "assistant", text: "", seo: evt.report }]);
            setStatus(null);
            bumpStep(6);
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

      <div className="col">
        <div className="brand">
          <button
            className="mobile-only icon-btn brand-menu"
            onClick={() => setSideOpen(true)}
            aria-label="チャット履歴を開く"
          >
            ☰
          </button>
          <span className="mark" />
          <span className="name">ブログアシスタント</span>
          <button
            className="mobile-only icon-btn brand-panel"
            onClick={() => setPanelOpen(true)}
            aria-label="公開済みを開く"
          >
            公開済み<span className="brand-panel-count">{blogs.length}</span>
          </button>
        </div>

        <StepBar current={step} />

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
                {m.role === "assistant" && (m.text || (!m.draft && !m.seo)) && (
                  <div className="who">アシスタント</div>
                )}
                {m.text && <div className={`bubble ${m.role}`}>{m.text}</div>}
                {m.draft && (
                  <DraftCard draft={m.draft} onStep={bumpStep} onPublished={loadBlogs} />
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

      <div className={`col panel ${panelOpen ? "open" : ""}`}>
        <div className="panel-head">
          <h2>公開済み</h2>
          <span className="count">{blogs.length}</span>
          <button
            className="mobile-only icon-btn panel-close"
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
