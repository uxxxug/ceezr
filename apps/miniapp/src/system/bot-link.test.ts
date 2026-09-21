/**
 * الغرض: حراسةُ رابطِ العودةِ إلى البوتِ — الخطوةُ السادسةُ من ترتيبِ المالكِ.
 *
 * والمحروسُ حكمانِ لا واحدٌ: **ما يُقبَلُ** رابطاً، و**ما لا يُعرَضُ زرٌّ عندَه**.
 * والثاني هو الذي يمنعُ «زرّاً لا يعملُ» — وهو مَنهيٌّ عنه صراحةً في حوكمةِ
 * المشروعِ، والمنعُ لا يُترَكُ لانتباهِ مراجعٍ.
 */

import { describe, expect, it } from "bun:test";

import { parseBotLink } from "./bot-link.ts";

describe("رابطُ العودةِ إلى البوتِ — الخطوةُ ٦ · ADR 0165", () => {
  it("رابطُ بوتٍ سليمٌ يُقبَلُ ويُرَدُّ مُطبَّعاً", () => {
    expect(parseBotLink("https://t.me/waslah_bot")).toBe("https://t.me/waslah_bot");
  });

  it("حمولةُ البدءِ تُحفَظُ ولا تُقتَطَعُ", () => {
    expect(parseBotLink("https://t.me/waslah_bot?start=register")).toBe(
      "https://t.me/waslah_bot?start=register",
    );
  });

  it("المسافاتُ الزائدةُ تُجرَّدُ — لوحةُ نشرٍ يكتبُها إنسانٌ", () => {
    expect(parseBotLink("  https://t.me/waslah_bot  ")).toBe("https://t.me/waslah_bot");
  });

  it("غيابُ المتغيّرِ ⇒ لا رابطَ ولا زرَّ", () => {
    expect(parseBotLink(undefined)).toBeNull();
  });

  it("نصٌّ فارغٌ ⇒ لا رابطَ — والفراغُ أشهرُ صورِ الضبطِ الناقصِ", () => {
    expect(parseBotLink("")).toBeNull();
    expect(parseBotLink("   ")).toBeNull();
  });

  it("‏`javascript:` يسقُطُ — الرابطُ مُدخَلٌ غيرُ موثوقٍ ولو كتبَه المالكُ", () => {
    expect(parseBotLink("javascript:alert(1)")).toBeNull();
  });

  it("‏`data:` يسقُطُ", () => {
    expect(parseBotLink("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("‏`http` يسقُطُ — لا تنزُّلَ عن HTTPS", () => {
    expect(parseBotLink("http://t.me/waslah_bot")).toBeNull();
  });

  it("نطاقٌ يُنهي باسمِ `t.me` خِداعاً يسقُطُ — الحكمُ على المضيفِ كاملاً", () => {
    expect(parseBotLink("https://evil-t.me/waslah_bot")).toBeNull();
    expect(parseBotLink("https://t.me.attacker.example/waslah_bot")).toBeNull();
  });

  it("نطاقٌ آخرُ يسقُطُ ولو كانَ تيليجرامَ نفسَها", () => {
    expect(parseBotLink("https://telegram.org/waslah_bot")).toBeNull();
    expect(parseBotLink("https://telegram.me/waslah_bot")).toBeNull();
  });

  it("‏`https://t.me` بلا اسمٍ يسقُطُ — يفتحُ تيليجرامَ لا بوتَنا", () => {
    expect(parseBotLink("https://t.me")).toBeNull();
    expect(parseBotLink("https://t.me/")).toBeNull();
  });

  it("نصٌّ ليسَ عنواناً ألبتّةَ يسقُطُ ولا يُرمي استثناءً", () => {
    expect(parseBotLink("waslah_bot")).toBeNull();
    expect(parseBotLink("@waslah_bot")).toBeNull();
  });
});
