/**
 * الغرض: قياسُ نطاقِ الإنهاءِ والتقييمِ — قراءةُ الوسومِ، وتصنيفُ الأهليّةِ،
 *   وحكمُ المدّةِ، وحكمُ وترِ الخطِّ المستقيمِ (البند `F2-07`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-07`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci`.
 *
 * ولماذا يُقاسُ النطاقُ وحدَه بلا قاعدةٍ ولا شبكةٍ: هذه دوالُّ خالصةٌ، وحكمُها
 * يجبُ أن يكونَ واحداً في الخادمِ والسطحِ. فإن اختلفَ الحكمانِ رُسِمَ زرٌّ
 * ثمَّ رُفِضَ نداؤُه — وهذا المِلفُّ يُثبِّتُ الحكمَ الواحدَ.
 *
 * وما لا يفعلُه عن قصدٍ: لا يزعمُ أنَّ القاعدةَ تُوافقُ هذا الحكمَ — موافقتُها
 * تُقاسُ في `tests/integration/ride-summary.test.ts` على قاعدةٍ حقيقيّةٍ
 * بساعتِها، لأنَّ النافذةَ والتكرارَ يُحكَمانِ هناكَ لا ههنا.
 */

import { describe, expect, it } from "bun:test";
import {
  isRatingStars,
  isRatingTag,
  MAX_RATING_COMMENT_LENGTH,
  MAX_RATING_TAGS,
  RATING_TAGS,
  ratingEligibilityOf,
  readRatingTags,
  rideDurationVerdict,
  straightLineVerdict,
} from "../../packages/domain/transport/ride-summary.ts";

describe("مُعجَمُ الوسومِ", () => {
  it("خمسةُ وسومٍ معدودةٍ لا تُخترَعُ في السطحِ", () => {
    expect(RATING_TAGS).toEqual([
      "cleanliness",
      "politeness",
      "route_adherence",
      "punctuality",
      "driving_safety",
    ]);
  });

  it("ما ليسَ من المُعجَمِ ليسَ وسماً — ولو كانَ نصّاً معقولاً", () => {
    expect(isRatingTag("cleanliness")).toBe(true);
    expect(isRatingTag("friendly")).toBe(false);
    expect(isRatingTag(3)).toBe(false);
    expect(isRatingTag(null)).toBe(false);
  });
});

describe("النجومُ", () => {
  it("من واحدٍ إلى خمسةٍ صحيحةً — وما عداها مرفوضٌ", () => {
    expect([1, 2, 3, 4, 5].every((value) => isRatingStars(value))).toBe(true);
    expect(isRatingStars(0)).toBe(false);
    expect(isRatingStars(6)).toBe(false);
    expect(isRatingStars(4.5)).toBe(false);
    expect(isRatingStars("5")).toBe(false);
    expect(isRatingStars(Number.NaN)).toBe(false);
  });
});

describe("قراءةُ الوسومِ من مُدخلٍ غيرِ موثوقٍ", () => {
  it("الغيابُ مقبولٌ: تقييمٌ بلا وسومٍ تقييمٌ تامٌّ", () => {
    expect(readRatingTags(undefined)).toEqual({ accepted: true, tags: [] });
    expect(readRatingTags(null)).toEqual({ accepted: true, tags: [] });
    expect(readRatingTags([])).toEqual({ accepted: true, tags: [] });
  });

  it("ثلاثةٌ مقبولةٌ وأربعةٌ مرفوضةٌ بسببِها المُصنَّفِ", () => {
    expect(readRatingTags(["cleanliness", "politeness", "punctuality"])).toEqual({
      accepted: true,
      tags: ["cleanliness", "politeness", "punctuality"],
    });
    expect(readRatingTags([...RATING_TAGS].slice(0, MAX_RATING_TAGS + 1))).toEqual({
      accepted: false,
      refusal: "TOO_MANY_RATING_TAGS",
    });
  });

  it("الوسمُ المجهولُ **يُرفَضُ ولا يُسقَطُ صامتاً**", () => {
    expect(readRatingTags(["cleanliness", "friendly"])).toEqual({
      accepted: false,
      refusal: "UNKNOWN_RATING_TAG",
    });
  });

  it("التكرارُ رفضٌ مستقلٌّ لا «تنظيفٌ» صامتٌ", () => {
    expect(readRatingTags(["cleanliness", "cleanliness"])).toEqual({
      accepted: false,
      refusal: "DUPLICATE_RATING_TAG",
    });
  });

  it("ما ليسَ مصفوفةً يُرفَضُ ولا يُلَفُّ في مصفوفةٍ", () => {
    expect(readRatingTags("cleanliness")).toEqual({
      accepted: false,
      refusal: "UNKNOWN_RATING_TAG",
    });
    expect(readRatingTags({ 0: "cleanliness" })).toEqual({
      accepted: false,
      refusal: "UNKNOWN_RATING_TAG",
    });
  });

  it("حدُّ الطولِ مُعلَنٌ رقماً لا مُضمَراً", () => {
    expect(MAX_RATING_COMMENT_LENGTH).toBe(1000);
    expect(MAX_RATING_TAGS).toBe(3);
  });
});

describe("أهليّةُ التقييمِ", () => {
  const facts = (over: Record<string, unknown> = {}) => ({
    status: "completed",
    alreadyRated: false,
    windowClosed: false,
    ...over,
  });

  it("رحلةٌ منتهيةٌ ونافذةٌ مفتوحةٌ ⇒ يُقيِّمُ", () => {
    expect(ratingEligibilityOf(facts())).toBe("CAN_RATE");
  });

  it("رحلةٌ لم تنتهِ ⇒ خطأُ مسارٍ لا خبرُ تقييمٍ", () => {
    expect(ratingEligibilityOf(facts({ status: "in_progress" }))).toBe("RIDE_NOT_COMPLETED");
    expect(ratingEligibilityOf(facts({ status: "cancelled" }))).toBe("RIDE_NOT_COMPLETED");
  });

  it("من قيَّمَ سلفاً **لا يُقالُ له «فاتَ الوقتُ»** ولو انقضَت النافذةُ", () => {
    expect(ratingEligibilityOf(facts({ alreadyRated: true, windowClosed: true }))).toBe(
      "ALREADY_RATED",
    );
  });

  it("نافذةٌ منقضيةٌ بلا تقييمٍ ⇒ انقضاءٌ مُصرَّحٌ به", () => {
    expect(ratingEligibilityOf(facts({ windowClosed: true }))).toBe("WINDOW_CLOSED");
  });
});

describe("حكمُ المدّةِ", () => {
  it("غيابُ ختمٍ **ليسَ صفراً** بل مدّةٌ غيرُ معلومةٍ بسببِها", () => {
    expect(rideDurationVerdict(null)).toEqual({ known: false, reason: "MISSING_STAMP" });
  });

  it("الثواني تُقسَمُ دقائقَ وثوانيَ", () => {
    expect(rideDurationVerdict(754)).toEqual({
      known: true,
      totalSeconds: 754,
      minutes: 12,
      seconds: 34,
    });
  });

  it("صفرُ ثانيةٍ **معلومٌ** — الفرقُ بينَه وبينَ الغيابِ محفوظٌ", () => {
    expect(rideDurationVerdict(0)).toEqual({
      known: true,
      totalSeconds: 0,
      minutes: 0,
      seconds: 0,
    });
  });

  it("السالبُ وغيرُ المنتهي عطبٌ يُعلَنُ لا رقمٌ يُعرَضُ", () => {
    expect(rideDurationVerdict(-5).known).toBe(false);
    expect(rideDurationVerdict(Number.NaN).known).toBe(false);
    expect(rideDurationVerdict(Number.POSITIVE_INFINITY).known).toBe(false);
  });
});

describe("حكمُ وترِ الخطِّ المستقيمِ", () => {
  it("لا وجهةَ ⇒ `NO_DROPOFF` **لا صفرَ أمتارٍ**", () => {
    expect(straightLineVerdict(null)).toEqual({ known: false, reason: "NO_DROPOFF" });
  });

  it("رقمٌ منتهٍ يُقرأُ متراً وكيلومتراً", () => {
    expect(straightLineVerdict(4210.5)).toEqual({
      known: true,
      meters: 4210.5,
      kilometers: 4.2105,
    });
  });

  it("صفرُ أمتارٍ **معلومٌ** ويُفرَّقُ عن غيابِ الوجهةِ", () => {
    expect(straightLineVerdict(0)).toEqual({ known: true, meters: 0, kilometers: 0 });
  });

  it("السالبُ وغيرُ المنتهي `NOT_MEASURED` — عطبُ عقدٍ يُقالُ", () => {
    expect(straightLineVerdict(-1)).toEqual({ known: false, reason: "NOT_MEASURED" });
    expect(straightLineVerdict(Number.NaN)).toEqual({ known: false, reason: "NOT_MEASURED" });
  });
});
