import { test } from "node:test";
import assert from "node:assert/strict";
import { wantsToFinish } from "../src/lib/chatIntent.ts";

test("recognizes clear finish/publish intent", () => {
  for (const t of [
    "公開して",
    "もう公開して",
    "これで公開",
    "投稿して",
    "最後までやって",
    "おまかせで公開まで進めて",
    "タイトル設定に進んで",
  ]) {
    assert.equal(wantsToFinish(t), true, `should be true: ${t}`);
  }
});

test("negations and edit requests never trigger publish", () => {
  for (const t of [
    "公開したくない",
    "まだ公開しないで",
    "公開はやめて",
    "タイトルを修正して",
    "本文を直したい",
    "角度を変えてほしい",
    "やっぱりキャンセル",
  ]) {
    assert.equal(wantsToFinish(t), false, `should be false: ${t}`);
  }
});

test("earlier-step intents are not treated as finish", () => {
  for (const t of [
    "SEOチェックして",
    "プレビューを見たい",
    "公開済みの一覧を見せて",
    "在宅勤務について書きたい",
    "こんにちは",
    "",
  ]) {
    assert.equal(wantsToFinish(t), false, `should be false: ${t}`);
  }
});
