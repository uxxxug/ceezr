/**
 * الغرض: اختبارُ وحدةٍ لناشرِ بطاقةِ السلامةِ (`PD-020`) — جنسُ البلاغِ يختارُ
 *   القالبَ قبلَ أيِّ شيءٍ آخرَ: بلاغُ تعذُّرِ إكمالٍ **برمزٍ مُهادِنٍ** لا برمزِ
 *   طوارئِ الاستغاثةِ (🆘)، فمَن يفتحُ القروبَ يُميِّزُ في نصفِ ثانيةٍ ماذا
 *   يقرأُ وماذا يُجهِّزُ، وفريقُ السلامةِ السريعُ لا يُستنفَرُ لقرارِ إسنادٍ.
 * الحالة: منفَّذٌ فعليّاً — البند `PD-020`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test`.
 * الحاكم: docs/adr/0159-safety-channel-entry-delivery-review-and-driver-cannot-complete.md
 */

import { describe, expect, it } from "bun:test";
import type { SafetyDelivery } from "../../packages/application/safety/ports.ts";
import type { TelegramSender } from "../../packages/infrastructure/notification/telegram-api-sender.ts";
import { createSafetyCardPublisher } from "../../packages/infrastructure/notification/telegram-safety-notifier.ts";
import { DEFAULT_LANGUAGE, t } from "../../packages/shared/i18n/index.ts";

const tr = t(DEFAULT_LANGUAGE);

function delivery(overrides: Partial<SafetyDelivery>): SafetyDelivery {
  return {
    deliveryId: "d-1",
    claimToken: "c-1",
    groupId: "-1001",
    incidentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeffff0000",
    orderId: "11111111-2222-4333-8444-555566667777",
    reporterRole: "driver",
    service: "transport",
    status: "pending",
    incidentReason: "sos",
    locationWkt: "POINT(39.17 21.54)",
    maxAttempts: 3,
    ...overrides,
  };
}

/** مُرسِلٌ يلتقطُ النصَّ — لا شبكةَ ولا اتصالَ بتيليجرام. */
function capturingSender(captured: { text: string | null }): TelegramSender {
  return {
    sendMessage: async (_chatId, text) => {
      captured.text = text;
      return "42";
    },
    sendPhoto: async () => null,
    sendLocation: async () => null,
  };
}

describe("ناشر بطاقة السلامة يختار القالب بجنس البلاغ", () => {
  it("بلاغ تعذّر إكمال من مهمة قائمة يقرأ بقالب التعذّر لا بقالب الطوارئ", async () => {
    const captured: { text: string | null } = { text: null };
    const publisher = createSafetyCardPublisher(capturingSender(captured));
    const result = await publisher.publish(delivery({ incidentReason: "driver_cannot_complete" }));
    expect(result.ok).toBe(true);
    // نصُّ القالبِ مُقارَنٌ بأصلِهِ من القاموسِ لا بنسخةٍ مكتوبةٍ بيدٍ تتقادَمُ.
    expect(captured.text).toBe(
      tr("safety.group_card_cannot_complete", {
        incident: "aaaaaaaa",
        order: "11111111-2222-4333-8444-555566667777",
        service: tr("safety.service_transport"),
        location: "21.54, 39.17",
      }),
    );
    expect(captured.text?.startsWith("🆘")).toBe(false);
  });

  it("بلاغ استغاثة SOS يبقى بقالب الطوارئ — لا يتغيّر القالبُ القائمُ", async () => {
    const captured: { text: string | null } = { text: null };
    const publisher = createSafetyCardPublisher(capturingSender(captured));
    const result = await publisher.publish(delivery({ incidentReason: "sos" }));
    expect(result.ok).toBe(true);
    expect(captured.text).toBe(
      tr("safety.group_card", {
        incident: "aaaaaaaa",
        order: "11111111-2222-4333-8444-555566667777",
        reporter: tr("safety.reporter_driver"),
        service: tr("safety.service_transport"),
        location: "21.54, 39.17",
      }),
    );
    expect(captured.text?.startsWith("🆘")).toBe(true);
  });
});
