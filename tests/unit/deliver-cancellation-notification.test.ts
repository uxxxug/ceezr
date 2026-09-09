/**
 * الغرض: قراءةُ حمولةِ إخطارِ الإلغاءِ وقرارُ الهجرِ (BUG-004). ما يُقاسُ هنا قرارٌ
 *   منطقيٌّ خالصٌ لا يحتاجُ قاعدةً: أيُّ حمولةٍ تُقبلُ، وأيُّها تُهجَرُ لأنّها لن
 *   تُقبلَ أبدًا — سائقٌ لا محادثةَ له لحظةَ الالتقاطِ. والفرقُ جوهريٌّ: الهجرُ
 *   يُنهي الصفَّ، والفشلُ يُعادُ. أمّا ذرّيةُ الإيداعِ فتُقاسُ على PostgreSQL حقيقيّةٍ
 *   في tests/integration/notification-outbox-cancellation.test.ts، ولا يُستعاضُ عن
 *   أحدِهما بالآخر.
 * الحالة: منفّذ فعلياً — 2026-09-06.
 * ينتمي إلى: tests/unit
 * يُستخدم من: bun test
 */
import { describe, expect, it } from "bun:test";
import {
  type CancellationMessenger,
  type CancellationNotice,
  createOrderCancelledHandler,
} from "../../packages/application/dispatch/deliver-cancellation-notification.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type { CityId, DriverId, OrderId } from "../../packages/shared/kernel/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const ORDER = "11111111-1111-4111-8111-111111111111" as OrderId;
const DRIVER = "22222222-2222-4222-8222-222222222222" as DriverId;

function messenger(
  seen: CancellationNotice[],
  outcome: "ok" | "null" | "fail" = "ok",
): CancellationMessenger {
  return {
    sendOrderCancelled: async (notice) => {
      seen.push(notice);
      if (outcome === "fail") {
        return err(new PortFailureError("notifier.orderCancelled", "telegram down"));
      }
      return ok(outcome === "null" ? null : "msg-1");
    },
  };
}

function delivery(payload: Readonly<Record<string, unknown>>) {
  return {
    deliveryId: "33333333-3333-4333-8333-333333333333",
    kind: "order_cancelled",
    cityId: "44444444-4444-4444-8444-444444444444" as CityId,
    claimToken: "55555555-5555-4555-8555-555555555555",
    attempts: 1,
    maxAttempts: 3,
    batchLimit: 8,
    payload,
  };
}

const FULL = {
  order_id: ORDER,
  driver_id: DRIVER,
  chat_id: "9001",
  language: "en",
  was_assigned: true,
} as const;

describe("معالجُ إخطارِ إلغاءِ الطلبِ للسائقِ (BUG-004)", () => {
  it("حمولةٌ تامّةٌ تُرسَلُ كما هي، ومعرّفُ الرسالةِ هو دليلُ التسليمِ", async () => {
    const seen: CancellationNotice[] = [];
    const result = await createOrderCancelledHandler(messenger(seen))(delivery(FULL));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ abandon: false, messageId: "msg-1", failure: null });
    expect(seen).toEqual([
      { orderId: ORDER, driverId: DRIVER, chatId: "9001", language: "en", wasAssigned: true },
    ]);
  });

  it("لغةٌ غائبةٌ أو فارغةٌ تعودُ إلى العربيّةِ لا إلى نصٍّ بلا قاموسٍ", async () => {
    const seen: CancellationNotice[] = [];
    const handler = createOrderCancelledHandler(messenger(seen));
    await handler(delivery({ ...FULL, language: undefined }));
    await handler(delivery({ ...FULL, language: "" }));
    await handler(delivery({ ...FULL, language: 7 }));
    expect(seen.map((notice) => notice.language)).toEqual(["ar", "ar", "ar"]);
  });

  it("`was_assigned` غيرُ الصريحِ يُقرأُ false: صفةُ الإسنادِ لا تُخمَّن", async () => {
    const seen: CancellationNotice[] = [];
    const handler = createOrderCancelledHandler(messenger(seen));
    await handler(delivery({ ...FULL, was_assigned: false }));
    await handler(delivery({ ...FULL, was_assigned: undefined }));
    await handler(delivery({ ...FULL, was_assigned: "true" }));
    expect(seen.map((notice) => notice.wasAssigned)).toEqual([false, false, false]);
  });

  it("حمولةٌ بلا محادثةٍ أو بلا سائقٍ أو بلا طلبٍ تُهجَرُ ولا تُعادُ إلى الأبدِ", async () => {
    const seen: CancellationNotice[] = [];
    const handler = createOrderCancelledHandler(messenger(seen));
    const broken = [
      { ...FULL, chat_id: undefined },
      { ...FULL, chat_id: "" },
      { ...FULL, driver_id: undefined },
      { ...FULL, driver_id: "" },
      { ...FULL, order_id: undefined },
      { ...FULL, order_id: 5 },
    ];
    for (const payload of broken) {
      const result = await handler(delivery(payload));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ abandon: true, messageId: null, failure: null });
    }
    // ولا رسالةَ خرجت: الهجرُ قرارٌ قبلَ الإرسالِ لا بعدَ فشلِه.
    expect(seen).toHaveLength(0);
  });

  it("فشلُ المُرسِلِ يُعادُ لا يُهجَرُ، وسببُه يُنقَلُ كما هو", async () => {
    const seen: CancellationNotice[] = [];
    const result = await createOrderCancelledHandler(messenger(seen, "fail"))(delivery(FULL));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.abandon).toBe(false);
    expect(result.value.messageId).toBeNull();
    expect(result.value.failure).toBe("telegram down");
    expect(seen).toHaveLength(1);
  });

  it("نجاحٌ بلا معرّفِ رسالةٍ ليس تسليمًا: يُعادُ ولا يُختَمُ الصفُّ", async () => {
    const seen: CancellationNotice[] = [];
    const result = await createOrderCancelledHandler(messenger(seen, "null"))(delivery(FULL));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ abandon: false, messageId: null, failure: null });
  });
});
