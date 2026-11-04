/**
 * الغرض: قراءةُ حمولةِ إخطارِ التدخّلِ الإداريِّ وقرارُ الهجرِ (`WR-42`). ما
 *   يُقاسُ هنا قرارٌ منطقيٌّ خالصٌ لا يحتاجُ قاعدةً: أيُّ حمولةٍ تُقبلُ، وأيُّها
 *   تُهجَرُ لأنّها لن تُقبلَ أبدًا — سائقٌ لا محادثةَ له لحظةَ الالتقاطِ، أو فعلٌ
 *   مجهولٌ لا يعرفُهُ المعالجُ. والفرقُ جوهريٌّ: الهجرُ يُنهي الصفَّ، والفشلُ
 *   يُعادُ. أمّا ذرّيةُ الإيداعِ فتُقاسُ على PostgreSQL حقيقيّةٍ في
 *   tests/integration/wr-42-admin-order-intervention.test.ts.
 * الحالة: منفّذ فعلياً — 2026-11-04 (`WR-42`).
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: bun test
 */
import { describe, expect, it } from "bun:test";
import {
  type AdminInterventionMessenger,
  type AdminInterventionNotice,
  createAdminInterventionHandler,
} from "../../packages/application/dispatch/deliver-admin-intervention-notification.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type { CityId, DriverId, OrderId } from "../../packages/shared/kernel/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const ORDER = "11111111-1111-4111-8111-111111111111" as OrderId;
const DRIVER = "22222222-2222-4222-8222-222222222222" as DriverId;

function messenger(
  seen: AdminInterventionNotice[],
  outcome: "ok" | "null" | "fail" = "ok",
): AdminInterventionMessenger {
  return {
    sendAdminIntervention: async (notice) => {
      seen.push(notice);
      if (outcome === "fail") {
        return err(new PortFailureError("notifier.adminIntervention", "telegram down"));
      }
      return ok(outcome === "null" ? null : "msg-1");
    },
  };
}

function delivery(payload: Readonly<Record<string, unknown>>) {
  return {
    deliveryId: "33333333-3333-4333-8333-333333333333",
    kind: "admin_order_intervention",
    cityId: "44444444-4444-4444-8444-444444444444" as CityId,
    claimToken: "55555555-5555-4555-8555-555555555555",
    attempts: 1,
    maxAttempts: 3,
    batchLimit: 8,
    requestId: null,
    payload,
  };
}

const FULL = {
  order_id: ORDER,
  driver_id: DRIVER,
  chat_id: "9001",
  language: "en",
  action: "complete",
  reason: "رحلةٌ معلَّقةٌ والطرفانِ ينتظرانِ",
  was_status: "in_progress",
};

describe("WR-42 — معالجُ إخطارِ التدخّلِ الإداريِّ", () => {
  it("الحمولةُ الكاملةُ تُرسَلُ برسالتِها ومعرّفِها", async () => {
    const seen: AdminInterventionNotice[] = [];
    const handler = createAdminInterventionHandler(messenger(seen));
    const outcome = await handler(delivery(FULL));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value).toEqual({ abandon: false, messageId: "msg-1", failure: null });
    expect(seen).toEqual([
      {
        orderId: ORDER,
        driverId: DRIVER,
        chatId: "9001",
        language: "en",
        action: "complete",
        reason: "رحلةٌ معلَّقةٌ والطرفانِ ينتظرانِ",
        wasStatus: "in_progress",
      },
    ]);
  });

  it("بلا سببٍ ولا حالةٍ سابقةٍ تُرسَلُ الرسالةُ وما عرفَتْهُ فقط — واللغةُ عربيةٌ افتراضًا", async () => {
    const seen: AdminInterventionNotice[] = [];
    const handler = createAdminInterventionHandler(messenger(seen));
    const outcome = await handler(
      delivery({
        order_id: ORDER,
        driver_id: DRIVER,
        chat_id: "9001",
        action: "cancel",
      }),
    );
    expect(outcome.ok).toBe(true);
    expect(seen[0]?.language).toBe("ar");
    expect(seen[0]?.reason).toBeNull();
    expect(seen[0]?.wasStatus).toBeNull();
  });

  it("السائقُ بلا محادثةٍ يُهجَرُ صفُّهُ لا أن يُعادَ أبدًا", async () => {
    const seen: AdminInterventionNotice[] = [];
    const handler = createAdminInterventionHandler(messenger(seen));
    const outcome = await handler(delivery({ ...FULL, chat_id: "" }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value).toEqual({ abandon: true, messageId: null, failure: null });
    expect(seen).toHaveLength(0);
  });

  it("فعلٌ لا يعرفُهُ المعالجُ يُهجَرُ الصفُّ — فلا رسالةَ تُبنى على مجهولٍ", async () => {
    const seen: AdminInterventionNotice[] = [];
    const handler = createAdminInterventionHandler(messenger(seen));
    const outcome = await handler(delivery({ ...FULL, action: "reschedule" }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.abandon).toBe(true);
    expect(seen).toHaveLength(0);
  });

  it("فشلُ الإرسالِ يُعادُ الصفُّ لا أن يُهجَرَ", async () => {
    const seen: AdminInterventionNotice[] = [];
    const handler = createAdminInterventionHandler(messenger(seen, "fail"));
    const outcome = await handler(delivery(FULL));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.abandon).toBe(false);
    expect(outcome.value.failure).toBe("telegram down");
  });
});
