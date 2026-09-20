/**
 * الغرض: قياسُ أحكامِ نطاقِ طلبِ الرحلةِ (`F2-05`) حيثُ تُتَّخَذُ — لا حيثُ
 *   تُستعمَلُ: قراءةُ مفتاحِ التكرارِ برفضٍ **مُصنَّفٍ** لا صحيحٍ/خاطئٍ، وقراءةُ
 *   ملاحظةِ السائقِ (`SR-04`) بحدٍّ واحدٍ مكتوبٍ في القاعدةِ أيضاً، وطورُ البحثِ
 *   الذي **يفصلُ الصمتَ عن الإخطارِ** (`ADR 0023`)، وشرطُ الإلغاءِ بلا عقوبةٍ
 *   (`SR-05`)، والمدّةُ المقيسةُ من ختمِ الإنشاءِ لا من فتحِ الشاشةِ.
 * الحالة: اختبار فعلي — دالّاتٌ خالصةٌ بلا قاعدةٍ ولا شبكةٍ.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI
 * يُتوقع أن يستخدمه لاحقاً: `F2-06` يقرأُ الحالةَ نفسَها لحوارِ الرحلةِ.
 * ملاحظات مستقبلية: كلُّ حالةٍ تُضافُ إلى `order_status` تُضافُ ههنا حالتُها في
 *   `searchPhaseOf` — حالةٌ بلا طورٍ تهبطُ إلى `closed` صامتةً.
 *
 * ═══ ما لا يُقاسُ ههنا ═══
 * ــ **لا تُقاسُ ذرّيّةُ الإنشاءِ**: حكمُها في القاعدةِ ويُقاسُ بسباقٍ فعليٍّ في
 *    `tests/integration/ride-request.test.ts`.
 * ــ **لا تُقاسُ أجرةٌ**: محجوبةٌ (`ADR 0039` §٤ · `م13-7`)، وغيابُها مفروضٌ في
 *    `scripts/check-ride-request-contract.ts`.
 */

import { describe, expect, it } from "bun:test";
import {
  cancellableWithoutPenalty,
  elapsedSecondsSince,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  isRideStatus,
  RIDE_NOTES_MAX_LENGTH,
  RIDE_STATUSES,
  readIdempotencyKey,
  readRideNotes,
  searchPhaseOf,
} from "../../packages/domain/transport/ride-request.ts";

const KEY = "ride:6f2a1c48-8b0e-4e65-9d8a-2b1c3d4e5f60";

describe("مفتاحُ التكرارِ — رفضٌ مُصنَّفٌ لا صحيحٌ وخاطئٌ", () => {
  it("مفتاحٌ سليمٌ يُقبَلُ كما وصلَ حرفاً", () => {
    expect(readIdempotencyKey(KEY)).toEqual({ key: KEY });
  });

  it("الغيابُ والفراغُ وغيرُ النصِّ كلُّها «MISSING»", () => {
    expect(readIdempotencyKey(undefined)).toEqual({ refusal: "MISSING" });
    expect(readIdempotencyKey("")).toEqual({ refusal: "MISSING" });
    expect(readIdempotencyKey(12_345_678)).toEqual({ refusal: "MISSING" });
  });

  it("مفتاحٌ أقصرُ من الحدِّ يُرفَضُ: القصيرُ يُصادِمُ نفسَه فلا تُنشأُ الرحلةُ ألبتّةَ", () => {
    expect(readIdempotencyKey("a".repeat(IDEMPOTENCY_KEY_MIN_LENGTH - 1))).toEqual({
      refusal: "TOO_SHORT",
    });
    expect(readIdempotencyKey("a".repeat(IDEMPOTENCY_KEY_MIN_LENGTH))).toEqual({
      key: "a".repeat(IDEMPOTENCY_KEY_MIN_LENGTH),
    });
  });

  it("الحدُّ الأعلى يُقبَلُ وما فوقَه يُرفَضُ — والحدُّ نفسُه مكتوبٌ في الهجرةِ", () => {
    expect(readIdempotencyKey("b".repeat(IDEMPOTENCY_KEY_MAX_LENGTH))).toEqual({
      key: "b".repeat(IDEMPOTENCY_KEY_MAX_LENGTH),
    });
    expect(readIdempotencyKey("b".repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1))).toEqual({
      refusal: "TOO_LONG",
    });
  });

  it("المسافةُ رفضٌ مُعلَنٌ لا تصحيحٌ صامتٌ: شذبُها يجعلُ أمرَينِ أمراً واحداً", () => {
    expect(readIdempotencyKey(` ${KEY} `)).toEqual({ refusal: "MALFORMED" });
    expect(readIdempotencyKey("ride:\n6f2a1c48")).toEqual({ refusal: "MALFORMED" });
    expect(readIdempotencyKey("ride:مفتاح-عربي")).toEqual({ refusal: "MALFORMED" });
  });
});

describe("ملاحظةُ السائقِ — حدٌّ واحدٌ وفراغٌ يُقرأُ غياباً", () => {
  it("الغيابُ والفراغُ والمسافاتُ سواءٌ: `null` لا نصٌّ فارغٌ في العمودِ", () => {
    expect(readRideNotes(undefined)).toEqual({ notes: null });
    expect(readRideNotes(null)).toEqual({ notes: null });
    expect(readRideNotes("   \n ")).toEqual({ notes: null });
  });

  it("النصُّ يُشذَّبُ ويُقبَلُ: الملاحظةُ محتوًى يُقرأُ لا هويّةٌ تُقارَنُ", () => {
    expect(readRideNotes("  البوّابةُ الشماليّةُ  ")).toEqual({ notes: "البوّابةُ الشماليّةُ" });
  });

  it("الحدُّ يُقبَلُ وما فوقَه يُرفَضُ برمزِ الهجرةِ نفسِه", () => {
    const limit = "م".repeat(RIDE_NOTES_MAX_LENGTH);
    expect(readRideNotes(limit)).toEqual({ notes: limit });
    expect(readRideNotes(`${limit}م`)).toEqual({ refusal: "NOTES_TOO_LONG" });
  });

  it("غيرُ النصِّ عطبُ عقدٍ لا ملاحظةٌ فارغةٌ", () => {
    expect(readRideNotes(7)).toEqual({ refusal: "MALFORMED" });
    expect(readRideNotes({ notes: "x" })).toEqual({ refusal: "MALFORMED" });
  });
});

describe("حالاتُ الطلبِ — تُقرأُ من المخطَّطِ ولا تُختلَقُ", () => {
  it("كلُّ حالةٍ مُعلَنةٍ تُقبَلُ وما عداها يُرفَضُ", () => {
    for (const status of RIDE_STATUSES) expect(isRideStatus(status)).toBe(true);
    expect(isRideStatus("assigned")).toBe(false);
    expect(isRideStatus(undefined)).toBe(false);
  });
});

describe("طورُ البحثِ — الصمتُ ليسَ رفضاً ولا إخطاراً", () => {
  it("بحثٌ بلا مُخطَرٍ «silent» وبمُخطَرٍ واحدٍ «announced»", () => {
    expect(
      searchPhaseOf({
        status: "searching",
        notifiedDriverCount: 0,
        createdAtMs: 0,
        widerCircleOpened: false,
        escalated: false,
      }),
    ).toBe("silent");
    expect(
      searchPhaseOf({
        status: "searching",
        notifiedDriverCount: 1,
        createdAtMs: 0,
        widerCircleOpened: false,
        escalated: false,
      }),
    ).toBe("announced");
  });

  it("الإسنادُ والتنفيذُ «assigned» وما بعدَهما «closed»", () => {
    expect(
      searchPhaseOf({
        status: "matched",
        notifiedDriverCount: 3,
        createdAtMs: 0,
        widerCircleOpened: true,
        escalated: true,
      }),
    ).toBe("assigned");
    expect(
      searchPhaseOf({
        status: "in_progress",
        notifiedDriverCount: 3,
        createdAtMs: 0,
        widerCircleOpened: true,
        escalated: true,
      }),
    ).toBe("assigned");
    for (const status of ["completed", "cancelled", "failed"] as const) {
      expect(
        searchPhaseOf({
          status,
          notifiedDriverCount: 3,
          createdAtMs: 0,
          widerCircleOpened: true,
          escalated: true,
        }),
      ).toBe("closed");
    }
  });
});

describe("مآلُ الانتظارِ — سردٌ تدريجيٌّ لا يتراجعُ (`PD-050`)", () => {
  it("فتحُ الدائرةِ الأوسعِ «widened» بلا تصعيدٍ، والتصعيدُ المُسلَّمُ «escalated»", () => {
    expect(
      searchPhaseOf({
        status: "searching",
        notifiedDriverCount: 2,
        createdAtMs: 0,
        widerCircleOpened: true,
        escalated: false,
      }),
    ).toBe("widened");
    expect(
      searchPhaseOf({
        status: "searching",
        notifiedDriverCount: 2,
        createdAtMs: 0,
        widerCircleOpened: true,
        escalated: true,
      }),
    ).toBe("escalated");
  });

  it("التصعيدُ يغلبُ التوسيعَ، والتوسيعُ يغلبُ الإعلانَ — والسردُ لا يتراجعُ", () => {
    // طلبٌ صُعِّدَ ثمّ فُتِحَتْ لهُ دورةٌ أوسعُ جديدةٌ يبقى «مُصعَّدًا»:
    // رايةُ التوسيعِ صارتْ صحيحةً أيضًا لكنّها خبرٌ أقدمُ من التصعيدِ.
    expect(
      searchPhaseOf({
        status: "searching",
        notifiedDriverCount: 5,
        createdAtMs: 0,
        widerCircleOpened: false,
        escalated: true,
      }),
    ).toBe("escalated");
  });

  it("ما ليسَ بحثًا مُغلَقٌ ولو صُعِّدَ قَبلَهُ — الطورُ يتبعُ الحالةَ لا الأثرَ", () => {
    expect(
      searchPhaseOf({
        status: "cancelled",
        notifiedDriverCount: 2,
        createdAtMs: 0,
        widerCircleOpened: true,
        escalated: true,
      }),
    ).toBe("closed");
  });
});

describe("الإلغاءُ بلا عقوبةٍ — من الحالةِ لا من مضيِّ الوقتِ", () => {
  it("«searching» وحدَها تُلغى بلا عقوبةٍ", () => {
    expect(cancellableWithoutPenalty("searching")).toBe(true);
    for (const status of ["matched", "in_progress", "completed", "cancelled", "failed"] as const) {
      expect(cancellableWithoutPenalty(status)).toBe(false);
    }
  });
});

describe("المدّةُ — من ختمِ الإنشاءِ، وصفرٌ لا `null`", () => {
  it("تُحسَبُ بالثواني مُقتَطَعةً لا مُدوَّرةً: 1900مل ثانيةٌ واحدةٌ", () => {
    expect(elapsedSecondsSince(1_000_000, 1_001_900)).toBe(1);
    expect(elapsedSecondsSince(1_000_000, 1_450_000)).toBe(450);
  });

  it("ساعةٌ متقدِّمةٌ تُنتِجُ صفراً لا سالباً: «مضتْ -3 ثوانٍ» شاشةٌ مكسورةٌ", () => {
    expect(elapsedSecondsSince(2_000_000, 1_000_000)).toBe(0);
  });

  it("مُدخَلٌ غيرُ منتهٍ يُقرأُ صفراً — والصفرُ رقمٌ يُعرَضُ، و`null` فراغٌ لا يُعرَضُ", () => {
    expect(elapsedSecondsSince(Number.NaN, 1_000)).toBe(0);
    expect(elapsedSecondsSince(1_000, Number.POSITIVE_INFINITY)).toBe(0);
  });
});
