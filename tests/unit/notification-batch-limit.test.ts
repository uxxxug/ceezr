/**
 * الغرض: سعةُ شوطِ تسليمِ الصادرِ (F6-06). كانَ `deliverNotificationBatch`
 *    يَضبِطُ عددَ صفوفِ الشوطِ من `maxAttempts` — وهوَ **سقفُ إعادةِ محاولةِ
 *    الصفِّ الواحدِ** لا سعةُ الشوطِ. فمفتاحٌ واحدٌ بمعنيَينِ: من رفعَ سماحَ
 *    الإعادةِ رفعَ حجمَ الشوطِ بلا أن يطلُبَه، ومن ضيّقَها إلى واحدةٍ حبَسَ
 *    التسليمَ كلَّه في صفٍّ واحدٍ لكلِّ دورةٍ. وههنا يُقاسُ الفصلُ.
 * الحالة: مُختبَر.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, test } from "bun:test";
import {
  deliverNotificationBatch,
  type NotificationOutboxPort,
  type OutboxDelivery,
} from "../../packages/application/notification/deliver-notification.ts";
import type { CityId } from "../../packages/shared/kernel/index.ts";
import { ok } from "../../packages/shared/result/index.ts";

const CITY = "44444444-4444-4444-8444-444444444444" as CityId;

function delivery(index: number, batchLimit: number, maxAttempts: number): OutboxDelivery {
  return {
    deliveryId: `33333333-3333-4333-8333-00000000000${index % 10}`,
    kind: "ride_assigned",
    cityId: CITY,
    claimToken: `55555555-5555-4555-8555-00000000000${index % 10}`,
    attempts: 1,
    maxAttempts,
    batchLimit,
    payload: {},
  };
}

/**
 * صندوقٌ لا يفرُغُ: كلُّ التقاطٍ يُعيدُ صفّاً جديداً. فما يُوقِفُ الشوطَ هو
 * السعةُ وحدَها — وهذا بالضبطِ ما يُقاسُ.
 */
function endlessOutbox(
  counters: { claims: number },
  batchLimit: number,
  maxAttempts: number,
): NotificationOutboxPort {
  return {
    claim: async () => {
      counters.claims += 1;
      return ok({ delivery: delivery(counters.claims, batchLimit, maxAttempts) });
    },
    finish: async () => ok({ ok: true, outcome: "delivered" as const }),
    abandon: async () => ok(true),
  } as unknown as NotificationOutboxPort;
}

const handlers = {
  ride_assigned: async () => ok({ abandon: false, messageId: "msg-1", failure: null }),
} as unknown as Parameters<typeof deliverNotificationBatch>[0]["handlers"];

describe("سعةُ شوطِ الصادرِ تُقرأُ من سعتِها لا من سقفِ المحاولاتِ", () => {
  test("الشوطُ يقفُ عندَ `batchLimit` ولو كانَ `maxAttempts` أكبرَ بكثيرٍ", async () => {
    const counters = { claims: 0 };
    const result = await deliverNotificationBatch({
      outbox: endlessOutbox(counters, 3, 25),
      handlers,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.claimed).toBe(3);
    expect(result.value.delivered).toBe(3);
    // ولا التقاطَ رابعٌ: الوقوفُ سعةٌ لا صدفةُ فراغٍ.
    expect(counters.claims).toBe(3);
  });

  test("`maxAttempts` صغيرٌ لا يخنُقُ الشوطَ بعدَ الفصلِ", async () => {
    // قبلَ التصحيحِ كانَ هذا الشوطُ صفّاً واحداً لأنَّ سماحَ الإعادةِ واحدٌ.
    const counters = { claims: 0 };
    const result = await deliverNotificationBatch({
      outbox: endlessOutbox(counters, 6, 1),
      handlers,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.claimed).toBe(6);
  });

  test("بلوغُ السعةِ يُعلَنُ ضغطاً عكسيّاً لا شوطاً فارغاً", async () => {
    const result = await deliverNotificationBatch({
      outbox: endlessOutbox({ claims: 0 }, 2, 5),
      handlers,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // الطابورُ لم يفرُغ، والدورةُ التاليةُ تُكمِلُ — وكتمُ ذلك يُخفِي تراكُماً.
    expect(result.value.backpressure).toBe("BATCH_LIMIT");
  });

  test("طابورٌ فارغٌ: لا صفَّ ولا ضغطَ", async () => {
    const empty = {
      claim: async () => ok({ delivery: null, backpressure: null }),
      finish: async () => ok({ ok: true, outcome: "delivered" as const }),
      abandon: async () => ok(true),
    } as unknown as NotificationOutboxPort;

    const result = await deliverNotificationBatch({ outbox: empty, handlers });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.claimed).toBe(0);
    expect(result.value.backpressure).toBeNull();
  });

  test("منعُ الالتقاطِ لتزامنِ المستهلِكِ يُقرأُ سبباً معلوماً لا فراغاً", async () => {
    // الفرقُ حاسمٌ في اللوحةِ: «لا عملَ» صحّةٌ، و«مُنِعتُ من الالتقاطِ» ضغطٌ.
    const gated = {
      claim: async () => ok({ delivery: null, backpressure: "CONSUMER_CONCURRENCY" as const }),
      finish: async () => ok({ ok: true, outcome: "delivered" as const }),
      abandon: async () => ok(true),
    } as unknown as NotificationOutboxPort;

    const result = await deliverNotificationBatch({ outbox: gated, handlers });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.claimed).toBe(0);
    expect(result.value.backpressure).toBe("CONSUMER_CONCURRENCY");
  });
});
