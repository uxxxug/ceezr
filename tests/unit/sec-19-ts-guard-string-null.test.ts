/**
 * الغرض: قياسُ حرسِ `SEC-19-ب-٤` — حرسٌ في TypeScript قبلَ `String(...)`
 *   يمنعُ `String(null)` من إنتاجِ `"null"` وإرسالِه إلى تيليجرامَ.
 *
 *   الفرعُ `offer` لا يُحلُّ عنوانُهُ في SQL (كالأفرعِ السبعةِ الأخرى) بل في
 *   TypeScript. فحرسُ Step 3 (SQL) لا يَلمَسُه. وهذا القياسُ يتأكَّدُ من أنَّ:
 *   ١) `telegram_id = null` لا يُرسَلُ `"null"` إلى المُرسِلِ.
 *   ٢) الصفُّ يُعلَنُ `undeliverable` بـ`TELEGRAM_DELIVERY_UNAVAILABLE`.
 *   ٣) `sender.sendReturningId` لا يُستدعى أبدًا.
 *
 * الحالة: قياسٌ وحدويٌّ — لا يحتاجُ قاعدةَ بياناتٍ.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI (verify)
 */

import { describe, expect, it, mock } from "bun:test";
import { createOfferNotificationHandler } from "../../packages/application/dispatch/deliver-offer-notification.ts";
import type {
  NotificationDeliveryDeps,
  NotificationOutboxPort,
  OutboxDelivery,
} from "../../packages/application/notification/deliver-notification.ts";
import { deliverNotification } from "../../packages/application/notification/deliver-notification.ts";
import { createOfferPublisher } from "../../packages/infrastructure/notification/telegram-driver-notifier.ts";
import { ok } from "../../packages/shared/result/index.ts";

/** مُرسِلٌ مُزوَّرٌ لا يُستدعى أبدًا — إنْ دُعِيَ فالاختبارُ يفشلُ. */
function createStubSender() {
  const sendReturningId = mock(
    async (_chatId: string, _text: string, _keyboard: unknown): Promise<string | null> => {
      return "msg-stub";
    },
  );
  return { sendReturningId };
}

/**
 * SQL مُزوَّرٌ يُعيدُ `telegram_id = null` — يحاكي مستخدمًا بلا قناةِ تيليجرامَ.
 * يَعملُ كـtagged template literal: `sql\`...\`` يُعيدُ وعدًا بالصفوفِ.
 */
function createNullTelegramSql() {
  const sqlFn = async () => [{ telegram_id: null, language_code: "ar" }];
  // postgres.js يستخدم الخاصيّة `typed` لتحديدِ نوعِ الصفوفِ المُعادة.
  Object.defineProperty(sqlFn, "typed", { value: sqlFn });
  return sqlFn as unknown as Parameters<typeof createOfferPublisher>[0];
}

function createMockOutbox(): NotificationOutboxPort {
  return {
    claim: async () =>
      ok({
        delivery: {
          deliveryId: "00000000-0000-0000-0000-000000000001",
          kind: "offer",
          cityId: "00000000-0000-0000-0000-000000000002" as never,
          claimToken: "00000000-0000-0000-0000-000000000003",
          attempts: 1,
          maxAttempts: 3,
          batchLimit: 10,
          requestId: null,
          payload: {
            offer_id: "00000000-0000-0000-0000-000000000004",
            order_id: "00000000-0000-0000-0000-000000000005",
            driver_id: "00000000-0000-0000-0000-000000000006",
            distance_km: "5.0",
            expires_at: new Date(Date.now() + 300_000).toISOString(),
            offer_status: "pending",
          },
        } as OutboxDelivery,
      }),
    finish: async () => ok({ ok: true, outcome: "delivered" as const }),
    abandon: mock(async () => ok(true)),
    undeliverable: mock(async () => ok(true)),
  } as unknown as NotificationOutboxPort;
}

describe("SEC-19-ب-٤ — حرسُ String(null) قبلَ الإرسالِ في الفرعِ offer", () => {
  it('`telegram_id = null` لا يُرسِلُ "null" إلى المُرسِلِ ويُعلِنُ `undeliverable`', async () => {
    const sender = createStubSender();
    const sql = createNullTelegramSql();
    const publisher = createOfferPublisher(sql, sender);
    const handler = createOfferNotificationHandler(publisher);

    const outbox = createMockOutbox();
    const deps: NotificationDeliveryDeps = {
      outbox,
      handlers: { offer: handler },
    };

    const result = await deliverNotification(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // الصفُّ عُذِرَ تسليمُه لا أُرسِلَ ولا أُعيدَ
    expect(result.value.undeliverable).toBe(true);
    expect(result.value.delivered).toBe(false);
    expect(result.value.abandoned).toBe(false);
    expect(result.value.died).toBe(false);
    expect(result.value.found).toBe(true);

    // المُرسِلُ لم يُستدعَ أبدًا — لا بـ"null" ولا بغيرِه
    expect(sender.sendReturningId).not.toHaveBeenCalled();

    // outbox.undeliverable استُدعِيَ لا outbox.abandon
    expect(outbox.undeliverable).toHaveBeenCalled();
    expect(outbox.abandon).not.toHaveBeenCalled();
  });
});
