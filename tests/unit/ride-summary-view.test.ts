/**
 * الغرض: قياسُ نموذجِ عرضِ ملخَّصِ الرحلةِ — مفاتيحُ السطورِ، وتصريحُ الوترِ،
 *   وشرطُ رسمِ نموذجِ التقييمِ، وشرطُ قبولِ الإرسالِ (البند `F2-07`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-07`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci`.
 *
 * ولماذا يُقاسُ نموذجُ العرضِ لا الشاشةُ: الشاشةُ تُقاسُ بعينٍ، ونموذجُ العرضِ
 * يُقاسُ بحكمٍ. وما يهمُّ ههنا **أيُّ مفتاحٍ يُنادى لأيِّ حالةٍ** — فمفتاحٌ
 * خاطئٌ يعني نصّاً يكذبُ على الراكبِ ولو كانَ الرسمُ سليماً.
 *
 * وما لا يفعلُه عن قصدٍ: لا يقيسُ النصوصَ نفسَها (ذاكَ حاجزُ العقدِ ومطابقةُ
 * القواميسِ الثلاثةِ)، ولا يقيسُ أنَّ الخادمَ يوافقُ (ذاكَ مسارٌ وتكاملٌ).
 */

import { describe, expect, it } from "bun:test";
import {
  canSubmitRating,
  durationLine,
  eligibilityKey,
  MAX_RATING_COMMENT_LENGTH,
  MAX_RATING_TAGS,
  RATING_TAGS,
  ratingRefusalKey,
  showsRatingForm,
  straightLineLine,
  summaryErrorKey,
  summaryRefusalKey,
  tagKey,
} from "../../apps/miniapp/src/surfaces/rider/summary/ride-summary-view.ts";

describe("سطرُ المدّةِ", () => {
  it("فوقَ الدقيقةِ يُنادى مفتاحُ الدقائقِ", () => {
    expect(durationLine({ known: true, minutes: 12, seconds: 34 })).toEqual({
      known: true,
      key: "rider.summary.duration.minutes",
      minutes: 12,
      seconds: 34,
    });
  });

  it("دونَ الدقيقةِ يُنادى مفتاحُ الثواني — «٠ د» تُقرأُ «لا مدّةَ»", () => {
    expect(durationLine({ known: true, minutes: 0, seconds: 40 }).key).toBe(
      "rider.summary.duration.seconds",
    );
  });

  it("غيابُ الختمِ يُنادى مفتاحَ سببِه لا مفتاحَ رقمٍ", () => {
    expect(durationLine({ known: false, reason: "MISSING_STAMP" })).toEqual({
      known: false,
      key: "rider.summary.duration.missingStamp",
    });
  });

  it("سببٌ لا يُعرَفُ يُقالُ عامّاً ولا يُنشَرُ خاماً", () => {
    expect(durationLine({ known: false, reason: "SOMETHING_NEW" }).key).toBe(
      "rider.summary.duration.unknown",
    );
  });
});

describe("سطرُ وترِ الخطِّ المستقيمِ", () => {
  it("كلُّ مفاتيحِ المسافةِ تحتَ `straightLine` — التصريحُ في المفتاحِ نفسِه", () => {
    const keys = [
      straightLineLine({ known: true, meters: 320 }).key,
      straightLineLine({ known: true, meters: 4210 }).key,
      straightLineLine({ known: false, reason: "NO_DROPOFF" }).key,
      straightLineLine({ known: false, reason: "NOT_MEASURED" }).key,
      straightLineLine({ known: false, reason: "MYSTERY" }).key,
    ];
    expect(keys.every((key) => key.startsWith("rider.summary.straightLine."))).toBe(true);
  });

  it("دونَ الكيلومترِ يُعرَضُ بالأمتارِ مُدوَّرةً", () => {
    expect(straightLineLine({ known: true, meters: 319.6 })).toEqual({
      known: true,
      key: "rider.summary.straightLine.meters",
      meters: 320,
      kilometers: "0.3",
    });
  });

  it("فوقَ الكيلومترِ يُعرَضُ بخانةٍ عشريّةٍ واحدةٍ", () => {
    expect(straightLineLine({ known: true, meters: 4210.5 })).toEqual({
      known: true,
      key: "rider.summary.straightLine.kilometers",
      meters: 4211,
      kilometers: "4.2",
    });
  });

  it("لا وجهةَ ⇒ مفتاحُ غيابٍ لا «٠ م»", () => {
    expect(straightLineLine({ known: false, reason: "NO_DROPOFF" }).key).toBe(
      "rider.summary.straightLine.noDropoff",
    );
  });
});

describe("مفاتيحُ التصنيفاتِ", () => {
  it("كلُّ تصنيفِ أهليّةٍ له مفتاحٌ خاصٌّ", () => {
    expect(eligibilityKey("CAN_RATE")).toBe("rider.summary.rating.canRate");
    expect(eligibilityKey("ALREADY_RATED")).toBe("rider.summary.rating.alreadyRated");
    expect(eligibilityKey("WINDOW_CLOSED")).toBe("rider.summary.rating.windowClosed");
    expect(eligibilityKey("RIDE_NOT_COMPLETED")).toBe("rider.summary.rating.notCompleted");
    expect(eligibilityKey("NEW_CODE")).toBe("rider.summary.rating.unknown");
  });

  it("كلُّ وسمٍ له مفتاحُ نصٍّ مُشتَقٌّ من اسمِه", () => {
    expect(RATING_TAGS.map((tag) => tagKey(tag))).toEqual([
      "rider.summary.tag.cleanliness",
      "rider.summary.tag.politeness",
      "rider.summary.tag.route_adherence",
      "rider.summary.tag.punctuality",
      "rider.summary.tag.driving_safety",
    ]);
  });

  it("رفضُ التقييمِ ورفضُ الملخَّصِ والعطبُ: **لا رمزَ خامٌ يُعرَضُ**", () => {
    const keys = [
      ratingRefusalKey("ALREADY_RATED"),
      ratingRefusalKey("RATING_WINDOW_CLOSED"),
      ratingRefusalKey("UNKNOWN_RATING_TAG"),
      ratingRefusalKey("A_CODE_FROM_THE_FUTURE"),
      summaryRefusalKey("ORDER_NOT_FOUND"),
      summaryRefusalKey("INVALID_ORDER_ID"),
      summaryRefusalKey("A_CODE_FROM_THE_FUTURE"),
      summaryErrorKey("SESSION_EXPIRED"),
      summaryErrorKey("A_CODE_FROM_THE_FUTURE"),
    ];
    expect(keys.every((key) => key.startsWith("rider.summary."))).toBe(true);
    expect(new Set(keys).size).toBeGreaterThan(1);
  });
});

describe("رسمُ نموذجِ التقييمِ", () => {
  it("النموذجُ يُرسَمُ بحكمِ القاعدةِ وحدَها لا بحسابِ الشاشةِ", () => {
    expect(showsRatingForm({ canRate: true })).toBe(true);
    expect(showsRatingForm({ canRate: false })).toBe(false);
  });
});

describe("شرطُ قبولِ الإرسالِ في الشاشةِ", () => {
  const base = { stars: 5, tags: [] as readonly string[], comment: "" };

  it("نجومٌ مختارةٌ وحدَها تكفي", () => {
    expect(canSubmitRating(base)).toBe(true);
  });

  it("بلا نجومٍ لا إرسالَ", () => {
    expect(canSubmitRating({ ...base, stars: null })).toBe(false);
  });

  it("نجومٌ خارجَ المدى أو كسريّةٌ لا تُرسَلُ", () => {
    expect(canSubmitRating({ ...base, stars: 0 })).toBe(false);
    expect(canSubmitRating({ ...base, stars: 6 })).toBe(false);
    expect(canSubmitRating({ ...base, stars: 4.5 })).toBe(false);
  });

  it("أكثرُ من ثلاثةِ وسومٍ أو وسمٌ مكرَّرٌ أو مجهولٌ لا يُرسَلُ", () => {
    expect(canSubmitRating({ ...base, tags: RATING_TAGS.slice(0, MAX_RATING_TAGS + 1) })).toBe(
      false,
    );
    expect(canSubmitRating({ ...base, tags: ["cleanliness", "cleanliness"] })).toBe(false);
    expect(canSubmitRating({ ...base, tags: ["friendly"] })).toBe(false);
    expect(canSubmitRating({ ...base, tags: RATING_TAGS.slice(0, MAX_RATING_TAGS) })).toBe(true);
  });

  it("ملاحظةٌ فوقَ الحدِّ لا تُرسَلُ، وعندَه تُرسَلُ", () => {
    expect(canSubmitRating({ ...base, comment: "م".repeat(MAX_RATING_COMMENT_LENGTH) })).toBe(true);
    expect(canSubmitRating({ ...base, comment: "م".repeat(MAX_RATING_COMMENT_LENGTH + 1) })).toBe(
      false,
    );
  });
});
