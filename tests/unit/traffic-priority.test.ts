/**
 * الغرض: تثبيتُ سجلِّ أولويّاتِ المرورِ (القسمُ ١٥ / `F6-07`) وحجزِ نصيبِ الحرجِ
 *   في دلوِ الصادرِ ووسمِ المُرسِلِ بالنوعِ. **الاختبارُ يقيسُ سلوكاً لا وجودَ
 *   ملفٍّ**: الدلوُ يُنادى فعلاً فيُمنَعُ المنخفضُ ويُمنَحُ الحرجُ من الحدِّ نفسِه.
 * الحالة: منفّذٌ فعلياً — `F6-07`.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, test } from "bun:test";
import { createMemoryOutboundRateBucket } from "../../packages/infrastructure/notification/outbound-rate-bucket.ts";
import type { TelegramSender } from "../../packages/infrastructure/notification/telegram-api-sender.ts";
import { withTrafficPriority } from "../../packages/infrastructure/notification/traffic-priority-sender.ts";
import { NOTIFICATION_KINDS } from "../../packages/shared/config/notification-kinds.ts";
import { DEFERRABLE_UNDER_BACKPRESSURE_KINDS } from "../../packages/shared/config/queue-backpressure.ts";
import {
  bucketClassOfSendPriority,
  DEFAULT_LOW_PRIORITY_BUCKET_SHARE,
  effectiveBucketLimit,
  isDeferrableClass,
  lowPriorityShareOrDefault,
  NOTIFICATION_KIND_PRIORITY,
  priorityClassOfKind,
  priorityRankOfKind,
  sendPriorityOfClass,
  TRAFFIC_PRIORITY_CLASSES,
  TRAFFIC_PRIORITY_RANK,
} from "../../packages/shared/config/traffic-priority.ts";

describe("F6-07 — سجلُّ أولويّاتِ المرورِ", () => {
  test("كلُّ نوعٍ في `NOTIFICATION_KINDS` مُصنَّفٌ، ولا صنفَ زائدٌ", () => {
    const registered = Object.keys(NOTIFICATION_KIND_PRIORITY).sort();
    expect(registered).toEqual([...NOTIFICATION_KINDS].sort());
    for (const kind of NOTIFICATION_KINDS) {
      expect(TRAFFIC_PRIORITY_CLASSES).toContain(NOTIFICATION_KIND_PRIORITY[kind]);
    }
  });

  test("الرتبةُ رقماً: الأصغرُ أسبقُ، والأصنافُ الأربعةُ مُرتَّبةٌ بلا تساوٍ", () => {
    const ranks = TRAFFIC_PRIORITY_CLASSES.map((entry) => TRAFFIC_PRIORITY_RANK[entry]);
    expect(ranks).toEqual([1, 2, 3, 4]);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  test("المجهولُ يُقرأُ حرجاً — الميلُ نحوَ الحمايةِ لا نحوَ التأخيرِ", () => {
    expect(priorityClassOfKind("kind_that_does_not_exist")).toBe("critical");
    expect(priorityRankOfKind("kind_that_does_not_exist")).toBe(TRAFFIC_PRIORITY_RANK.critical);
    expect(priorityRankOfKind("broadcast_recipient")).toBe(TRAFFIC_PRIORITY_RANK.low);
  });

  test("قابلُ التأجيلِ = المتوسّطُ والمنخفضُ، وقائمةُ `F6-06` مُشتقّةٌ منه لا مكتوبةٌ مرّتَينِ", () => {
    expect(isDeferrableClass("critical")).toBe(false);
    expect(isDeferrableClass("high")).toBe(false);
    expect(isDeferrableClass("medium")).toBe(true);
    expect(isDeferrableClass("low")).toBe(true);
    const derived = NOTIFICATION_KINDS.filter((kind) =>
      isDeferrableClass(priorityClassOfKind(kind)),
    ).sort();
    expect([...DEFERRABLE_UNDER_BACKPRESSURE_KINDS].sort()).toEqual(derived);
  });

  test("الجسرُ إلى الحاكمِ الثنائيِّ في المُرسِلِ ذهاباً وعودةً", () => {
    expect(sendPriorityOfClass("critical")).toBe("critical");
    expect(sendPriorityOfClass("high")).toBe("critical");
    expect(sendPriorityOfClass("medium")).toBe("informational");
    expect(sendPriorityOfClass("low")).toBe("informational");
    expect(bucketClassOfSendPriority("critical")).toBe("critical");
    expect(bucketClassOfSendPriority("informational")).toBe("medium");
    // الغيابُ لا يُخنَقُ: مُنادٍ لم يُصنِّف يرى الحدَّ كلَّه.
    expect(bucketClassOfSendPriority(undefined)).toBe("critical");
  });
});

describe("F6-07 — حِصّةُ الدلوِ", () => {
  test("الحرجُ والمرتفعُ يريانِ الحدَّ كلَّه، والمتوسّطُ والمنخفضُ الحصّةَ", () => {
    expect(effectiveBucketLimit(25, "critical", 0.8)).toBe(25);
    expect(effectiveBucketLimit(25, "high", 0.8)).toBe(25);
    expect(effectiveBucketLimit(25, "medium", 0.8)).toBe(20);
    expect(effectiveBucketLimit(25, "low", 0.8)).toBe(20);
  });

  test("لا يبلغُ الحدُّ الفعليُّ صفراً أبداً — التأجيلُ ليسَ إعداماً", () => {
    expect(effectiveBucketLimit(1, "low", 0.8)).toBe(1);
    expect(effectiveBucketLimit(2, "low", 0.1)).toBe(1);
  });

  test("حصّةٌ معطوبةٌ تُقرأُ الافتراضَ لا «بلا حِصّةٍ»", () => {
    expect(lowPriorityShareOrDefault(undefined)).toBe(DEFAULT_LOW_PRIORITY_BUCKET_SHARE);
    expect(lowPriorityShareOrDefault(Number.NaN)).toBe(DEFAULT_LOW_PRIORITY_BUCKET_SHARE);
    expect(lowPriorityShareOrDefault(0)).toBe(DEFAULT_LOW_PRIORITY_BUCKET_SHARE);
    expect(lowPriorityShareOrDefault(1)).toBe(DEFAULT_LOW_PRIORITY_BUCKET_SHARE);
    expect(lowPriorityShareOrDefault(-3)).toBe(DEFAULT_LOW_PRIORITY_BUCKET_SHARE);
    expect(lowPriorityShareOrDefault(0.5)).toBe(0.5);
  });

  test("قياسٌ فعليٌّ: المنخفضُ يُمنَعُ عندَ حصّتِه والحرجُ يُمنَحُ من الحدِّ نفسِه", async () => {
    let now = 1_000;
    const bucket = createMemoryOutboundRateBucket(
      { global: { limit: 10, windowMs: 1_000 }, chat: { limit: 1, windowMs: 1_000 } },
      () => now,
      0.5, // حصّةُ غيرِ العاجلِ خمسٌ من عشرٍ — أرقامٌ صغيرةٌ ليُقاسَ الحجزُ لا ليُوصَفَ.
    );
    for (let index = 0; index < 5; index += 1) {
      const slot = await bucket.acquire("global", "bot", "low");
      expect(slot.granted).toBe(true);
    }
    // الحصّةُ استُهلِكَت: المنخفضُ يُمنَعُ الآنَ.
    const denied = await bucket.acquire("global", "bot", "low");
    expect(denied.granted).toBe(false);
    expect(denied.waitMs).toBeGreaterThan(0);
    // والحرجُ يمرُّ في اللحظةِ نفسِها — وهذا هوَ المتنفَّسُ المحجوزُ.
    for (let index = 0; index < 5; index += 1) {
      const slot = await bucket.acquire("global", "bot", "critical");
      expect(slot.granted).toBe(true);
    }
    // وبعدَ استنفادِ الحدِّ كلِّه لا يمرُّ الحرجُ أيضاً: الحجزُ لا يخترقُ حدَّ تيليجرام.
    expect((await bucket.acquire("global", "bot", "critical")).granted).toBe(false);
    // وبعدَ انقضاءِ النافذةِ يعودُ الاثنانِ.
    now += 1_001;
    expect((await bucket.acquire("global", "bot", "low")).granted).toBe(true);
  });

  test("دلوُ المحادثةِ لا حِصّةَ فيه: فتحةٌ واحدةٌ لا تُقسَمُ", async () => {
    let now = 5_000;
    const bucket = createMemoryOutboundRateBucket(
      { global: { limit: 10, windowMs: 1_000 }, chat: { limit: 1, windowMs: 1_000 } },
      () => now,
      0.5,
    );
    expect((await bucket.acquire("chat", "42", "low")).granted).toBe(true);
    expect((await bucket.acquire("chat", "42", "low")).granted).toBe(false);
    now += 1_001;
    expect((await bucket.acquire("chat", "42", "low")).granted).toBe(true);
  });
});

describe("F6-07 — وسمُ المُرسِلِ بالنوعِ", () => {
  const captured: { priority: string | undefined }[] = [];
  const spy: TelegramSender = {
    sendMessage: async (_chatId, _text, _markup, options) => {
      captured.push({ priority: options?.priority });
      return "1";
    },
    sendPhoto: async (_chatId, _fileId, _caption, _markup, options) => {
      captured.push({ priority: options?.priority });
      return "2";
    },
    sendLocation: async (_chatId, _latitude, _longitude, options) => {
      captured.push({ priority: options?.priority });
      return "3";
    },
  };

  test("الوسمُ مُشتقٌّ من السجلِّ في العمليّاتِ الثلاثِ", async () => {
    captured.length = 0;
    const critical = withTrafficPriority(spy, "negotiation_turn_opened");
    await critical.sendMessage("1", "نصٌّ", undefined);
    await critical.sendPhoto("1", "file", "تعليقٌ", undefined);
    await critical.sendLocation("1", 24.47, 39.61);
    expect(captured.map((entry) => entry.priority)).toEqual(["critical", "critical", "critical"]);

    captured.length = 0;
    await withTrafficPriority(spy, "broadcast_recipient").sendMessage("1", "بثٌّ", undefined);
    expect(captured[0]?.priority).toBe("informational");
  });

  test("الوسمُ لا يدهسُ أولويّةً صريحةً مرَّرَها المُنادي", async () => {
    captured.length = 0;
    await withTrafficPriority(spy, "broadcast_recipient").sendMessage("1", "نصٌّ", undefined, {
      priority: "critical",
    });
    expect(captured[0]?.priority).toBe("critical");
  });
});
