// Does a free-typed chat message read as "just finish / publish it"? Used only
// once a draft exists, to route such a message into the (cancelable, final-
// confirm) publish flow instead of the model — which has no way to publish. Kept
// deliberately conservative: any negation or edit intent opts out, so a false
// positive at worst opens a modal the user can cancel (never auto-publishes).
// Dependency-free so it can be unit-tested in isolation.
export function wantsToFinish(text: string): boolean {
  const t = text.trim();
  if (/(ない|たくない|やめ|まだ|キャンセル|戻|修正|直し|変え)/.test(t)) return false;
  return (
    /(公開|投稿して|投稿する|タイトル設定|最後まで|おまかせで(公開|進め|最後|やって))/.test(t) &&
    !/(SEO|プレビュー|見た目|済み)/.test(t)
  );
}
