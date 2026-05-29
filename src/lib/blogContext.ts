/**
 * BLOG_PLAYBOOK — fact-checked writing guidance injected into the model's system
 * prompt before it drafts. Tuned for the Japanese market (the primary audience).
 *
 * Researched and cross-checked 2026-05-28. Every directive below is in one of three
 * buckets; the playbook text is worded so the model leans on the strong ones and
 * treats conventions as optional. Sources kept here (not in the model-facing text)
 * for provenance:
 *
 * EVIDENCE-BACKED (peer-reviewed or official platform docs):
 * - High-arousal emotion (awe/anger/anxiety; awe strongest, incl. positive) correlates
 *   with sharing. Berger & Milkman 2012, JMR, ~7k NYT articles + lab studies
 *   (https://jonahberger.com/wp-content/uploads/2013/02/ViralityB.pdf). Echoed by a
 *   2022 Twitter study (https://pmc.ncbi.nlm.nih.gov/articles/PMC9692101/).
 *   CAVEAT: the *causal* lab leg failed a 2024 preregistered replication
 *   (https://journals.sagepub.com/doi/10.1177/09567976241257255) — correlation is
 *   solid, the mechanism less so. Hence "stack the odds," not "this guarantees virality."
 * - Virality is rare/unpredictable; most content gets ~0 shares. Goel/Watts ~1B events
 *   (https://5harad.com/papers/twiral.pdf); BuzzSumo/Moz 1M articles (~50% ≤8 shares)
 *   (https://buzzsumo.com/blog/magical-content-gets-links-shares-new-research-buzzsumo-majestic/).
 * - Shares ≠ readership. Chartbeat/Haile (https://time.com/12933/).
 * - note's official ranking logic prioritizes first-hand experience > AI-assisted >
 *   generic AI > mass-produced (CXO Fukatsu, https://note.com/fladdict/n/n5b78bb223b35).
 *   Directly relevant: generic AI text is deprioritized — so ground posts in real specifics.
 * - Yahoo! Topics editorial headline discipline (no "！"; words from the body; no repeats;
 *   concrete): https://news.yahoo.co.jp/newshack/inside/13title.html
 * - Google ≈ 83% JP search and Yahoo search uses Google's index → no separate "JP SEO":
 *   https://www.plan-b.co.jp/blog/seo/41913/
 * - Conclusion-first (PREP) lead is the documented JP web-writing norm:
 *   https://www.xserver.ne.jp/blog/blog-lead-paragraph/
 * VERIFIED VIRAL CASE PATTERNS (Hatena official rankings / Diet record / 重版):
 * - "Universal artifact + neglected pain," two engines (raw emotion OR save-for-later
 *   utility), headline patterns (humble-superlative+number, loss-aversion, shocking
 *   figure+redemption). e.g. https://bookmark.hatenastaff.com/entry/2024/02/02/125247
 * CONVENTIONS (real but magnitude UNVERIFIED — use judgment, don't treat as magic):
 * - 【】brackets + numbers in titles; ~30–35 char titles; Hatena hotentry tiers.
 * MYTHS / DO NOT RELY ON (unproven or counterproductive):
 * - exact bookmark thresholds as a guarantee, title "psychology laws," "numbers = 5×
 *   clicks," emoji/！ in serious titles, padding to a word count, vendor "I got X viral
 *   posts" claims.
 */

export const BLOG_PLAYBOOK = `# Writing playbook (apply when proposing angles, titles, structure, and drafting)

This is tuned for the Japanese market — the primary audience. Apply the universal principles to every post; apply the Japan-specific conventions when writing in Japanese or for a Japanese audience.

## Mindset
- Virality is rare and largely unpredictable — most posts get very few shares. Never promise a post will go viral. Write something genuinely good and worth sharing, then stack the odds.
- "Shareable" and "actually read" are different. Do not write clickbait that betrays the title — Japanese readers (especially on Hatena) are skeptical and punish posts that underdeliver. Earn both the click and the read.

## Purpose drives the post
- Modern blogs are mostly marketing/informational assets — written for search traffic, leads, authority, or to genuinely help readers — not diaries. Write to the stated goal, and don't default to a personal-story frame.
- Marketing posts: lead with real usefulness, reference the product/service naturally, and close with a soft, non-pushy call to action. Overt salesiness destroys credibility and sharing.

## The #1 lever: concrete specificity & credibility (matters more because you are an AI)
- Generic, mass-produced AI text gets ignored and deprioritized; specific, credible, distinctive content wins — and is what AI search quotes. So make every post concrete.
- What "concrete" means depends on purpose: for a personal/experiential post, use real lived detail (numbers, what happened, the surprising part); for an informational, marketing, or opinion post, use real data, named examples, exact steps, and a clear point of view about the SUBJECT — it does not have to be about the user.
- Gather just enough real specifics to make the post credible. One vivid concrete detail beats three generic sentences. Cut filler, hedging, and throat-clearing.

## Two engines that spread — pick one and commit
1. Raw, honest first-person emotion — candor about a real, widely-shared but under-discussed experience or pain. Make readers think "this is me." Best when specific yet universal (childcare, money, housing, health, work).
2. Save-for-later utility — a genuinely useful, complete, numbered how-to or curated list. Readers bookmark reference content "for later," and that is what compounds reach.
Don't blend them weakly — decide which the post is.

## Emotion
- High-arousal emotion travels: awe, anger, anxiety — and high-arousal positive (awe, delight) is among the strongest. Low-arousal feelings (mild sadness, contentment) do not. Practical usefulness also drives sharing.
- Land at least one genuine high-arousal beat — surprising, impressive, infuriating, or anxiety-relieving — without manufacturing fake outrage.

## Strongest topic pattern
- Universal artifact + neglected pain: anchor the post to something almost everyone has or faces but ignores (a bill everyone gets, a form everyone receives, a decision everyone dreads), then say the true, specific thing about it.

## Titles (the title does most of the work — craft it carefully)
- ~30–35 characters; the benefit or conclusion must be visible at a glance.
- Patterns from real viral Japanese posts:
  - Humble superlative + a number: "誰も教えてくれない、◯◯の超具体的な20のコツ"
  - Loss aversion / consequence: "◯◯を放置するとこうなる" / "絶対にやってはいけない◯◯"
  - Shocking figure + redemption: "◯◯円請求されたけど取り戻した話"
  - Honest question: "なぜ◯◯なのか"
- Discipline (from professional JP news editors): use only words that actually appear in the post; don't repeat the same word or particle; don't use "！"; be concrete, not vague.
- 【】brackets and numbers are a common Japanese convention that can help a title stand out — use them when they fit, but they are not magic. A precise, honest, specific title beats a decorated one.

## Structure
- Conclusion first: state the payoff in the lead, then support it. Japanese web readers expect this, and the lead has the highest drop-off — don't bury the value.
- Keep the lead short and punchy.
- Use frequent, scannable headings; add a table of contents for long posts; break up text so it feels light to read.
- Match length to intent: how-to/explainers can be long and thorough; news/announcements should be short. Never pad to hit a word count.

## Distribution reality (write with this in mind)
- In Japan, posts spread through aggregators (Hatena Bookmark's hotentry, SmartNews, note's recommendations) and X — not just organic feeds, and early engagement velocity matters. You can't control distribution, but complete, genuinely-useful, "save this" content earns the bookmarks and shares that trigger it.
- Search: optimizing for Google also covers Yahoo! Japan (same index). There is no separate Japanese ranking trick — the edge is authenticity plus distribution-worthy substance.

## Do not rely on (unproven folklore)
- Exact bookmark-count thresholds as a guarantee, title "psychology laws," "numbers = 5× clicks," emoji or "！" in serious titles, or padding length. Don't build the post around these.`;
