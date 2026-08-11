/**
 * الغرض: وحدة السمعة — تحليل النجوم، عتبة الثقة، التقييم الفعّال، ومسار حوار التقييم
 *   بمنافذ مزدوجة. الأثر على النقاط مُثبَت في dispatch-matching.test.ts وعلى القاعدة في التكامل.
 * الحالة: اختبار وحدة فعلي — المرحلة 2.5.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: أي سبب رفض جديد يُضاف هنا قبل أن يُضاف في الحوار.
 */

import { describe, expect, it } from "bun:test";
import { createMemorySessionStore } from "../../apps/gateway/src/bots/shared/session.ts";
import {
  handleCompleteRide,
  handleRatingCallback,
  handleStartRide,
  type RatingDialogDependencies,
  starsKeyboard,
} from "../../packages/application/bots/rating-dialog.ts";
import type { DialogState, Sender, SessionStore } from "../../packages/application/bots/types.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type {
  CompletionSummary,
  RatingPort,
  RideLifecyclePort,
  StartSummary,
} from "../../packages/application/reputation/index.ts";
import {
  averageOf,
  EMPTY_REPUTATION,
  effectiveRating,
  isRatingWindowOpen,
  isStars,
  isTrustworthy,
  MAX_STARS,
  MIN_STARS,
  normalizeRating,
  oppositeDirection,
  parseComment,
  parseStars,
  starsBar,
} from "../../packages/domain/reputation/index.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import type { OrderId } from "../../packages/shared/kernel/index.ts";
import { err, isOk } from "../../packages/shared/result/index.ts";
import { fixedClock } from "../support/in-memory-ports.ts";

const ORDER = "11111111-1111-4111-8111-111111111111" as OrderId;
const ar = (key: string, params: Record<string, string | number> = {}) =>
  translate("ar", key, params);

const sender: Sender = { chatId: "500", telegramUserId: "500", languageHint: "ar" };

describe("تحليل النجوم", () => {
  it("يقبل الأعداد الصحيحة من واحد إلى خمسة فقط", () => {
    for (let value = MIN_STARS; value <= MAX_STARS; value += 1) {
      expect(isStars(value)).toBe(true);
    }
    expect(isStars(0)).toBe(false);
    expect(isStars(6)).toBe(false);
    expect(isStars(4.5)).toBe(false);
  });

  it("يفرّق بين أسباب الرفض ولا يجمعها في «غير صحيح»", () => {
    const notNumber = parseStars("خمس");
    const notInteger = parseStars("4.5");
    const outOfRange = parseStars("9");
    expect(notNumber.ok === false && notNumber.error.reason).toBe("not_a_number");
    expect(notInteger.ok === false && notInteger.error.reason).toBe("not_an_integer");
    expect(outOfRange.ok === false && outOfRange.error.reason).toBe("out_of_range");
  });

  it("يقبل النصّ الرقمي بمسافات حوله", () => {
    const parsed = parseStars("  5 ");
    expect(parsed.ok && parsed.value).toBe(5);
  });

  it("شريط النجوم يعكس العدد بصرياً", () => {
    expect(starsBar(1)).toBe("★☆☆☆☆");
    expect(starsBar(5)).toBe("★★★★★");
  });

  it("التعليق يُقصّ من الأطراف ويُرفض إن تجاوز الحدّ", () => {
    const empty = parseComment("   ");
    expect(empty.ok && empty.value).toBeNull();
    const long = parseComment("ط".repeat(1001));
    expect(long.ok).toBe(false);
  });

  it("الاتجاه المقابل ينقلب مرّتين فيعود", () => {
    expect(oppositeDirection("rider_to_driver")).toBe("driver_to_rider");
    expect(oppositeDirection(oppositeDirection("rider_to_driver"))).toBe("rider_to_driver");
  });
});

describe("عتبة الثقة والتقييم الفعّال", () => {
  it("لا يُوثَق بمتوسط تحت العتبة", () => {
    expect(isTrustworthy({ average: 5, count: 2 }, 3)).toBe(false);
    expect(isTrustworthy({ average: 5, count: 3 }, 3)).toBe(true);
  });

  it("التقييم الفعّال يعود إلى الافتراضي تحت العتبة", () => {
    expect(effectiveRating({ average: 5, count: 1 }, 3, 4.5)).toBe(4.5);
    expect(effectiveRating({ average: 5, count: 3 }, 3, 4.5)).toBe(5);
  });

  /** الصفر تقييم سيّئ، والغياب ليس تقييماً — فلا يُخلَط أحدهما بالآخر. */
  it("غياب التقييم ليس صفراً", () => {
    expect(EMPTY_REPUTATION.average).toBeNull();
    expect(effectiveRating(EMPTY_REPUTATION, 3, 4.5)).toBe(4.5);
    expect(effectiveRating({ average: 0, count: 9 }, 3, 4.5)).toBe(0);
  });

  it("التطبيع يحصر القيمة بين صفر وواحد", () => {
    expect(normalizeRating(0)).toBe(0);
    expect(normalizeRating(MAX_STARS)).toBe(1);
    expect(normalizeRating(99)).toBe(1);
    expect(normalizeRating(-3)).toBe(0);
  });

  it("المتوسط يُحسب من السجلّ ويعيد غياباً عند خلوّه", () => {
    expect(averageOf([])).toEqual(EMPTY_REPUTATION);
    const at = new Date("2026-08-01T00:00:00Z");
    const record = (stars: number, isFlagged = false) => ({
      stars: stars as never,
      direction: "rider_to_driver" as const,
      isFlagged,
      createdAt: at,
    });
    // المُعلَّم مُسيئاً موجود في السجلّ ومستثنى من الحساب — لا محوّ ولا احتساب
    const snapshot = averageOf([record(5), record(4), record(3), record(1, true)]);
    expect(snapshot.count).toBe(3);
    expect(snapshot.average).toBeCloseTo(4, 10);
  });

  it("نافذة التقييم تُغلق بعد المهلة", () => {
    const completedAt = new Date("2026-08-01T00:00:00Z");
    const within = new Date("2026-08-02T00:00:00Z");
    const after = new Date("2026-08-04T00:00:00Z");
    expect(isRatingWindowOpen(completedAt, 48, within)).toBe(true);
    expect(isRatingWindowOpen(completedAt, 48, after)).toBe(false);
  });
});

/** منافذ مزدوجة: نتحكّم بالعائد لنُثبت أن الحوار يترجم كل سبب رفض إلى رسالته. */
function deps(overrides: {
  lifecycle?: Partial<RideLifecyclePort>;
  ratings?: Partial<RatingPort>;
  counterpartSink?: { telegramId: string; text: string }[];
  sessions?: SessionStore;
}): RatingDialogDependencies {
  const startSummary: StartSummary = {
    orderId: ORDER,
    service: "transport",
    pickupLabel: null,
    dropoffLabel: null,
    driver: { telegramId: "500", languageCode: "ar", fullName: "خالد" },
    rider: { telegramId: "600", languageCode: "en", fullName: "Mona" },
  };
  const summary: CompletionSummary = {
    orderId: ORDER,
    durationSeconds: 900,
    service: "transport",
    pickupLabel: null,
    dropoffLabel: null,
    driver: { telegramId: "500", languageCode: "ar", fullName: "خالد" },
    rider: { telegramId: "600", languageCode: "en", fullName: "Mona" },
  };
  return {
    sessions:
      overrides.sessions ?? createMemorySessionStore(fixedClock(new Date("2026-08-07T12:00:00Z"))),
    lifecycle: {
      start: async () => ({ ok: true, value: { ok: true, reason: null, summary: startSummary } }),
      complete: async () => ({ ok: true, value: { ok: true, reason: null, summary } }),
      ...overrides.lifecycle,
    } as RideLifecyclePort,
    ratings: {
      submit: async () => ({
        ok: true,
        value: { ok: true, ratingId: "r1", direction: "rider_to_driver", reason: null },
      }),
      ...overrides.ratings,
    } as RatingPort,
    ...(overrides.counterpartSink === undefined
      ? {}
      : {
          counterpart: {
            notify: async (telegramId: string, text: string) => {
              overrides.counterpartSink?.push({ telegramId, text });
            },
          },
        }),
  };
}

describe("حوار الرحلة والتقييم", () => {
  it("البدء الناجح يُخرج زرّ الإنهاء لا رسالة مجرّدة", async () => {
    const replies = await handleStartRide(ORDER, sender, "ar", deps({}));
    expect(replies[0]?.text).toBe(ar("rating.ride_started"));
    const keyboard = replies[0]?.keyboard;
    expect(keyboard?.kind === "inline" && keyboard.rows[0]?.[0]?.data).toBe(
      `ride:complete:${ORDER}`,
    );
  });

  it("رفض البدء يُترجَم رسالةً مفهومة لا خطأً تقنياً", async () => {
    const replies = await handleStartRide(
      ORDER,
      sender,
      "ar",
      deps({
        lifecycle: {
          start: async () => ({
            ok: true,
            value: { ok: false, reason: "ORDER_NOT_STARTABLE", summary: null },
          }),
        },
      }),
    );
    expect(replies[0]?.text).toBe(ar("rating.ride_not_startable"));
  });

  /**
   * البند ب.2: العميل يُبلَّغ عند البدء لا عند الإنهاء وحده. الاختبار يُثبت
   * استدعاء `counterpart.notify` نفسه، لا مجرّد أن السائق رأى رسالته.
   */
  it("بدء الرحلة يُبلّغ العميل على بوته هو وبلغته هو", async () => {
    const sink: { telegramId: string; text: string }[] = [];
    const replies = await handleStartRide(ORDER, sender, "ar", deps({ counterpartSink: sink }));

    // السائق يرى رسالته وزرّ الإنهاء كما كان — الإضافة لا تسرق شيئاً منه
    expect(replies).toHaveLength(1);
    expect(replies[0]?.text).toBe(ar("rating.ride_started"));

    // والعميل يُبلَّغ مرّة واحدة بالإنجليزية لأن لغته en لا بلغة من بدأ
    expect(sink).toHaveLength(1);
    expect(sink[0]?.telegramId).toBe("600");
    expect(sink[0]?.text).toBe(
      translate("en", "rating.started_rider", {
        driver: "خالد",
        order: String(ORDER).slice(0, 8),
      }),
    );
  });

  /** رفض البدء لا يُبلّغ أحداً: من لم تبدأ رحلته لا يُقال له «انطلق سائقك». */
  it("رفض البدء لا يُرسل إشعاراً للعميل", async () => {
    const sink: { telegramId: string; text: string }[] = [];
    await handleStartRide(
      ORDER,
      sender,
      "ar",
      deps({
        counterpartSink: sink,
        lifecycle: {
          start: async () => ({
            ok: true,
            value: { ok: false, reason: "ORDER_NOT_STARTABLE", summary: null },
          }),
        },
      }),
    );
    expect(sink).toHaveLength(0);
  });

  it("الإنهاء يخاطب كل طرف بلغته هو لا بلغة من أنهى", async () => {
    const sink: { telegramId: string; text: string }[] = [];
    const replies = await handleCompleteRide(ORDER, sender, "ar", deps({ counterpartSink: sink }));
    // السائق بالعربية
    expect(replies[0]?.text).toContain("اكتملت الرحلة");
    expect(replies[1]?.text).toBe(ar("rating.ask_rating_rider", { rider: "Mona" }));
    // والعميل بالإنجليزية لأن لغته en، وعلى بوته هو
    expect(sink).toHaveLength(2);
    expect(sink[0]?.telegramId).toBe("600");
    expect(sink[0]?.text).toContain("completed");
    expect(sink[1]?.text).toBe(translate("en", "rating.ask_rating_driver", { driver: "خالد" }));
  });

  it("مدّة الرحلة تُصاغ دقائق أو ساعات بحسب طولها", async () => {
    const short = await handleCompleteRide(ORDER, sender, "ar", deps({}));
    expect(short[0]?.text).toContain(ar("rating.duration_minutes", { minutes: 15 }));

    const long = await handleCompleteRide(
      ORDER,
      sender,
      "ar",
      deps({
        lifecycle: {
          complete: async () => ({
            ok: true,
            value: {
              ok: true,
              reason: null,
              summary: {
                orderId: ORDER,
                durationSeconds: 5400,
                service: "transport",
                pickupLabel: null,
                dropoffLabel: null,
                driver: { telegramId: "500", languageCode: "ar", fullName: "خالد" },
                rider: { telegramId: "600", languageCode: "ar", fullName: "منى" },
              },
            },
          }),
        },
      }),
    );
    expect(long[0]?.text).toContain(ar("rating.duration_hours", { hours: 1, minutes: 30 }));
  });

  it("لوحة النجوم خمسة أزرار في صفّ واحد تحمل معرّف الطلب", () => {
    const keyboard = starsKeyboard(String(ORDER), "ar");
    expect(keyboard.rows).toHaveLength(1);
    expect(keyboard.rows[0]).toHaveLength(5);
    expect(keyboard.rows[0]?.[4]?.data).toBe(`rate:5:${ORDER}`);
  });

  it("ضغطة النجمة تُشكر عند النجاح وتُشرح عند الرفض", async () => {
    const done = await handleRatingCallback(`rate:5:${ORDER}`, sender, "ar", deps({}));
    expect(done[0]?.text).toBe(ar("rating.thanks", { bar: starsBar(5) }));

    const cases: readonly [string, string][] = [
      ["ALREADY_RATED", "rating.already_rated"],
      ["RATING_WINDOW_CLOSED", "rating.window_closed"],
      ["ORDER_NOT_COMPLETED", "rating.ride_not_completed"],
      ["RATER_NOT_PARTY_TO_ORDER", "rating.not_a_party"],
    ];
    for (const [reason, key] of cases) {
      const replies = await handleRatingCallback(
        `rate:5:${ORDER}`,
        sender,
        "ar",
        deps({
          ratings: {
            submit: async () => ({
              ok: true,
              value: {
                ok: false,
                ratingId: null,
                direction: null,
                reason: reason as never,
              },
            }),
          },
        }),
      );
      expect(replies[0]?.text).toBe(ar(key));
    }
  });

  it("بيانات زرّ مشوّهة تُرفض قبل أي مسّ بالقاعدة", async () => {
    let touched = false;
    const spy = deps({
      ratings: {
        submit: async () => {
          touched = true;
          return {
            ok: true,
            value: { ok: true, ratingId: "r", direction: "rider_to_driver", reason: null },
          };
        },
      },
    });
    expect((await handleRatingCallback("rate:5", sender, "ar", spy))[0]?.text).toBe(
      ar("common.unknown_command"),
    );
    expect((await handleRatingCallback("rate:9:x", sender, "ar", spy))[0]?.text).toBe(
      ar("rating.invalid_stars"),
    );
    expect(touched).toBe(false);
  });

  it("فشل المنفذ لا يُظهر تفاصيل تقنية للمستخدم", async () => {
    const replies = await handleRatingCallback(
      `rate:3:${ORDER}`,
      sender,
      "ar",
      deps({
        ratings: {
          submit: async () => err(new PortFailureError("rpc.submit_rating", "connection reset")),
        },
      }),
    );
    expect(replies[0]?.text).toBe(ar("common.error_try_again"));
    expect(replies[0]?.text).not.toContain("connection");
  });

  /**
   * البند 5 — نهاية الرحلة نهايةُ جلسة.
   *
   * العطب المُثبَت بالكود قبل الإصلاح: `RatingDialogDependencies.sessions` كان
   * مُعلَناً ومربوطاً في الحاوية و**بلا مستدعٍ واحد** في `rating-dialog.ts`، فكان
   * التقييم يُكتب في القاعدة وتبقى خطوة الحوار كما كانت.
   *
   * ويُختبر بحالةٍ واقعية لا بجلسة فارغة: راكبٌ كان يكتب شكوى حين انتهت رحلته.
   * بلا المحو تبقى `awaiting_support_message` فتخطف أوّل رسالة يكتبها بعدها.
   */
  it("التقييم الناجح يُنهي الجلسة فلا تبقى خطوة عالقة تخطف الرسالة التالية", async () => {
    const store = createMemorySessionStore(fixedClock(new Date("2026-08-07T12:00:00Z")));
    const stuck: DialogState = {
      step: "awaiting_support_message",
      language: "ar",
      draftName: null,
      draftPhone: null,
      draftCityId: null,
      draftService: null,
      draftPickup: null,
      draftDropoff: null,
      draftSupportType: null,
      draftVehicleType: null,
      draftPlateNumber: null,
      draftNationalId: null,
      draftVehiclePhotoFileId: null,
    };
    await store.save(sender.telegramUserId, stuck);
    const before = await store.load(sender.telegramUserId);
    expect(isOk(before) && before.value?.step).toBe("awaiting_support_message");

    const replies = await handleRatingCallback(
      `rate:5:${ORDER}`,
      sender,
      "ar",
      deps({ sessions: store }),
    );

    // الشكر يبقى كما كان: المحو إضافةٌ لا استبدال
    expect(replies[0]?.text).toBe(ar("rating.thanks", { bar: starsBar(5) }));
    const after = await store.load(sender.telegramUserId);
    expect(isOk(after) && after.value).toBeNull();
  });

  /**
   * فشل المحو لا يُبطل تقييماً كُتب في القاعدة فعلاً: الشكر حقٌّ للمستخدم بعد أن
   * تمّ فعله، ورسالة خطأ مكانه تجعله يظنّ أن نجمته لم تُسجَّل فيعيدها.
   */
  it("فشل محو الجلسة لا يسرق شكر التقييم", async () => {
    const failing: SessionStore = {
      load: async () => ({ ok: true, value: null }),
      save: async () => ({ ok: true, value: undefined }),
      clear: async () => err(new PortFailureError("redis.clear", "connection reset")),
    };
    const replies = await handleRatingCallback(
      `rate:4:${ORDER}`,
      sender,
      "ar",
      deps({ sessions: failing }),
    );
    expect(replies[0]?.text).toBe(ar("rating.thanks", { bar: starsBar(4) }));
  });

  /**
   * التقييم المرفوض لا يُنهي جلسة: من ضغط نجمةً على رحلةٍ ليست له، أو خارج
   * النافذة، لم تنتهِ دورةُ طلبٍ عنده — ومحو خطوته يقطع عليه ما كان فيه بلا سبب.
   */
  it("التقييم المرفوض لا يمسّ الجلسة", async () => {
    const store = createMemorySessionStore(fixedClock(new Date("2026-08-07T12:00:00Z")));
    const state: DialogState = {
      step: "awaiting_pickup",
      language: "ar",
      draftName: null,
      draftPhone: null,
      draftCityId: null,
      draftService: "transport",
      draftPickup: null,
      draftDropoff: null,
      draftSupportType: null,
      draftVehicleType: null,
      draftPlateNumber: null,
      draftNationalId: null,
      draftVehiclePhotoFileId: null,
    };
    await store.save(sender.telegramUserId, state);

    const replies = await handleRatingCallback(
      `rate:5:${ORDER}`,
      sender,
      "ar",
      deps({
        sessions: store,
        ratings: {
          submit: async () => ({
            ok: true,
            value: { ok: false, ratingId: null, direction: null, reason: "RATING_WINDOW_CLOSED" },
          }),
        },
      }),
    );
    expect(replies[0]?.text).toBe(ar("rating.window_closed"));
    const after = await store.load(sender.telegramUserId);
    expect(isOk(after) && after.value?.step).toBe("awaiting_pickup");
  });
});

describe("إعادة حساب المتوسطات", () => {
  it("تعيد ما تغيّر فعلاً، والصفر حالة سليمة لا فشل", async () => {
    const { recomputeAverageRatings } = await import(
      "../../packages/application/reputation/recompute-average-rating.ts"
    );
    const result = await recomputeAverageRatings({
      recompute: {
        recompute: async () => ({ ok: true, value: { driversUpdated: 2, ridersUpdated: 0 } }),
      },
    });
    expect(isOk(result) && result.value).toEqual({ driversUpdated: 2, ridersUpdated: 0 });
  });
});
