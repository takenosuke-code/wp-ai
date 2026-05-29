"use client";

import { useEffect, useRef, useState } from "react";

type ChatMsg = { role: "user" | "assistant"; text: string; options?: string[] };
type Blog = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  category: string;
  tags: string[];
  featuredImagePrompt: string;
  createdAt: string;
};

const OPT_OPEN = "[[OPTIONS]]";
const OPT_CLOSE = "[[/OPTIONS]]";

function toolLabel(name: string): string {
  if (name === "list_existing_posts") return "既存の記事を確認しています";
  if (name === "save_blog_post") return "記事を公開しています";
  return "作業しています";
}

// Split a finished assistant message into visible body + clickable options.
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

// While streaming, hide the options block (and any partial marker) from the text.
function displayBody(s: string): string {
  const idx = s.indexOf(OPT_OPEN);
  if (idx !== -1) return s.slice(0, idx).trimEnd();
  for (let n = Math.min(OPT_OPEN.length - 1, s.length); n > 0; n--) {
    if (s.endsWith(OPT_OPEN.slice(0, n))) return s.slice(0, s.length - n).trimEnd();
  }
  return s;
}

// Minimal, safe Markdown → HTML for the post detail view (content is escaped first).
function renderMarkdown(md: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s)
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

export default function Page() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(""); // revealed body of the in-flight reply
  const [status, setStatus] = useState<string | null>(null); // "what the AI is doing"
  const [blogs, setBlogs] = useState<Blog[]>([]);
  const [selected, setSelected] = useState<Blog | null>(null);

  const sessionId = useRef<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const targetRef = useRef(""); // full text received so far
  const shownRef = useRef(0); // chars currently revealed
  const doneRef = useRef(false); // network stream finished
  const rafRef = useRef<number | null>(null);

  if (!sessionId.current && typeof crypto !== "undefined") {
    sessionId.current = crypto.randomUUID();
  }

  async function loadBlogs() {
    const res = await fetch("/api/blogs");
    if (res.ok) setBlogs(await res.json());
  }

  useEffect(() => {
    loadBlogs();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming, status]);

  function startReveal() {
    shownRef.current = 0;
    const tick = () => {
      const target = targetRef.current;
      if (shownRef.current < target.length) {
        const backlog = target.length - shownRef.current;
        const step = Math.max(2, Math.ceil(backlog / 9)); // steady, with catch-up
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
    if (textArg === undefined) setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
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
        body: JSON.stringify({ sessionId: sessionId.current, message: text }),
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
          } else if (evt.type === "tool") {
            setStatus(toolLabel(evt.name));
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

  return (
    <div className="app">
      <div className="col">
        <div className="brand">
          <span className="mark" />
          <span className="name">ブログアシスタント</span>
          <span className="tag">CHAT → DRAFT → PUBLISH</span>
        </div>

        <div className="messages" ref={scrollRef}>
          <div className="thread">
            {messages.length === 0 && !busy && (
              <div className="empty">
                <em>「リモート社員のオンボーディングについて記事を書きたい」</em>
                のように話しかけてください。
                <br />
                既存の記事を確認し、切り口と構成を提案し、下書きを書き、承認後に右の一覧へ公開します。
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`turn ${m.role}`}>
                {m.role === "assistant" && <div className="who">アシスタント</div>}
                {m.text && <div className={`bubble ${m.role}`}>{m.text}</div>}
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

      <div className="col panel">
        <div className="panel-head">
          <h2>公開済み</h2>
          <span className="count">{blogs.length}</span>
        </div>
        <div className="list">
          {blogs.length === 0 && (
            <div className="empty center">まだ記事はありません。チャットから公開できます。</div>
          )}
          {blogs.map((b) => (
            <button key={b.id} className="card" onClick={() => setSelected(b)}>
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
