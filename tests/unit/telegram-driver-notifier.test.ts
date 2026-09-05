/**
 * الغرض: إثباتٌ أنَّ مُخطرَ السائقِ يبني زرَّ الرفضِ على `offerId` لا `orderId` —
 *   فيَنصبُّ الرفضُ على عرضٍ واحدٍ لا على كلِّ عرضٍ معلَّقٍ للسائقِ على الطلبِ (`BUG-003`).
 *   اختبارُ التنسيقِ `isCallbackDataValid` وحده لا يكفي: يمرُّ ولو ظلَّ المُخطرُ يرسلُ `orderId`.
 * الحالة: اختبار وحدةٍ بمزدوجاتٍ في الذاكرة — يلتقطُ لوحةَ المفاتيحِ الفعليةَ التي يُمرّرُها
 *   المُخطرُ إلى المُرسِل، ويتحقَّقُ من حمولةِ زرِّ الرفضِ حرفاً.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, it } from "bun:test";
import type { Keyboard } from "../../packages/application/bots/types.ts";
import type { OfferNotification } from "../../packages/application/dispatch/broadcast-offers.ts";
import type { DistanceKm } from "../../packages/domain/geo/value-objects.ts";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createTelegramDriverNotifier,
  type OutboundSender,
} from "../../packages/infrastructure/notification/telegram-driver-notifier.ts";
import type { DriverId, OfferId, OrderId } from "../../packages/shared/kernel/index.ts";
import { isOk } from "../../packages/shared/result/index.ts";

/** سائقٌ موجودٌ دائماً — المُخطرُ يقرأُ `telegram_id` و`language_code` فقط. */
function fakeSql(): Sql {
  const run = () => [{ telegram_id: "999", language_code: "ar" }];
  const sql = ((_strings: TemplateStringsArray, ..._values: unknown[]) =>
    Promise.resolve(run())) as unknown as Sql;
  (sql as unknown as { end: () => Promise<void> }).end = async () => undefined;
  return sql;
}

/** مُرسِلٌ يلتقطُ اللوحةَ الفعليةَ — لا شبكةَ ولا اتصالَ بتيليجرام. */
function capturingSender(captured: { keyboard: Keyboard | null }): OutboundSender {
  return {
    send: async (_chatId: string, _text: string, keyboard: Keyboard | null) => {
      captured.keyboard = keyboard;
      return true;
    },
  } as unknown as OutboundSender;
}

describe("createTelegramDriverNotifier — زرُّ الرفضِ يحملُ offerId لا orderId (BUG-003)", () => {
  it("زرُّ الرفضِ بياناتُه `offer:reject:<offerId>` لا `offer:reject:<orderId>`", async () => {
    const captured: { keyboard: Keyboard | null } = { keyboard: null };
    const notifier = createTelegramDriverNotifier(fakeSql(), capturingSender(captured));

    // offerId ≠ orderId عمداً — ليثبتَ الاختبارُ أنَّ الزرَّ يأخذُ offerId لا orderId.
    const notification: OfferNotification = {
      orderId: "order-1" as OrderId,
      offerId: "offer-xyz" as OfferId,
      driverId: "drv-1" as DriverId,
      distanceKm: 2.3 as DistanceKm,
      expiresInSeconds: 30,
    };

    const result = await notifier.notifyOffer(notification);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value).toBe(true);

    const keyboard = captured.keyboard;
    expect(keyboard).not.toBeNull();
    if (keyboard === null) return;
    expect(keyboard.kind).toBe("inline");
    if (keyboard.kind !== "inline") return;
    const row = keyboard.rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row).toHaveLength(2);
    const acceptButton = row[0];
    const rejectButton = row[1];
    expect(acceptButton).toBeDefined();
    expect(rejectButton).toBeDefined();
    if (acceptButton === undefined || rejectButton === undefined) return;

    // القبولُ لم يُمَسَّ — ما زالَ يحمِلُ orderId كما كان.
    expect(acceptButton.data).toBe("offer:accept:order-1");
    // الرفضُ صارَ يحمِلُ offerId — لا orderId. هذا هو صميمُ BUG-003.
    expect(rejectButton.data).toBe("offer:reject:offer-xyz");
    // والضمانُ الحاسمُ: لو ظلَّ المُخطرُ يرسلُ orderId لفشلَ هذا التوكيدُ.
    expect(rejectButton.data).not.toContain("order-1");
  });

  it("سائقٌ غيرُ موجودٍ يُعادُ عنه false لا رميٌ — البثُّ يستمرُّ لبقيةِ الدفعةِ", async () => {
    const missingSql = (() => Promise.resolve([])) as unknown as Sql;
    const captured: { keyboard: Keyboard | null } = { keyboard: null };
    const notifier = createTelegramDriverNotifier(missingSql, capturingSender(captured));

    const result = await notifier.notifyOffer({
      orderId: "order-1" as OrderId,
      offerId: "offer-xyz" as OfferId,
      driverId: "drv-ghost" as DriverId,
      distanceKm: 2.3 as DistanceKm,
      expiresInSeconds: 30,
    });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value).toBe(false);
    expect(captured.keyboard).toBeNull();
  });
});
