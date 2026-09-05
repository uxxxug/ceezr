/**
 * الغرض: إثبات أنّ أغلفة الرصد لا تُسقط شيئاً من المنفذ الذي تلفّه.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: كل غلاف رصد جديد — يُضاف إلى الجدول أدناه.
 * ملاحظات مستقبلية: لا شيء.
 *
 * ## لماذا هذا الملف موجود
 *
 * `instrumentPaymentRepository` كان يبني المنفذ بتعداد دواله يدوياً، فأسقط
 * `confirmWebhookPayment` الاختياري بلا صوت. والنتيجة أنّ كل ويبهوك دفع في
 * الإنتاج كان يعود 409 ولا اشتراك مدفوع يُفعَّل — بينما كل الاختبارات خضراء،
 * لأنّها تمرّر المستودع مجرّداً بلا غلاف.
 *
 * الخطأ لم يكن في دالةٍ واحدة بل في أسلوبٍ متكرّر: «أعد بناء الكائن بتعداد ما
 * تعرفه». وكل منفذٍ يكتسب دالةً لاحقاً — اختياريةً كانت أو لا — يقع في نفس
 * الحفرة بصمت. فالحماية ليست اختبار تلك الدالة بعينها، بل شرطٌ بنيويّ واحد
 * يُطبَّق على كل غلاف: ما دخل يخرج.
 *
 * لذلك يمرّر كل اختبارٍ هنا دالةً حارسة زائدة ليست في الواجهة أصلاً، ثم يطلب
 * أن تبقى موجودةً وعاملة. غلافٌ ينسخ ما يعرفه فقط يسقط في هذا الشرط، وغلافٌ
 * ينشر ما وصله ثم يتجاوز ما يقيسه ينجح فيه — وهذا هو الأسلوب المطلوب.
 */

import { describe, expect, it } from "bun:test";
import {
  instrumentPaymentConfirmationDeps,
  instrumentPaymentRepository,
  instrumentWebhookEventStore,
} from "../../apps/gateway/src/observability/payment.ts";
import {
  instrumentTelegramHandler,
  instrumentUpdateDeduplicator,
} from "../../apps/gateway/src/observability/telegram.ts";
import {
  instrumentDispatchRpc,
  instrumentExpireOffersRpc,
  instrumentOfferWriter,
} from "../../packages/infrastructure/observability/dispatch.ts";
import { createOperationalMetrics } from "../../packages/infrastructure/observability/metrics.ts";
import { ok } from "../../packages/shared/result/index.ts";

/** دالةٌ ليست في أيّ واجهة: وجودها بعد اللفّ هو الدليل على أنّ الغلاف لا يحجب. */
const SENTINEL = "دالةٌ_مستقبليّةٌ_لم_تكن_في_الواجهة";

function withSentinel<T extends object>(port: T): T & Record<string, () => string> {
  return { ...port, [SENTINEL]: () => "محفوظة" } as T & Record<string, () => string>;
}

function expectPreserved(original: object, wrapped: object): void {
  for (const key of Object.keys(original)) {
    expect(wrapped).toHaveProperty(key);
  }
  const call = (wrapped as Record<string, unknown>)[SENTINEL];
  expect(typeof call).toBe("function");
  expect((call as () => string)()).toBe("محفوظة");
}

describe("أغلفة الرصد لا تُسقط شيئاً من المنفذ الملفوف", () => {
  const metrics = () => createOperationalMetrics();

  it("instrumentPaymentRepository يحفظ كل دوال المستودع بما فيها الاختياريّة", () => {
    const port = withSentinel({
      findByIdempotencyKey: async () => ok(null),
      createPending: async () => ok({}),
      recordCheckoutUrl: async () => ok(undefined),
      recordProviderReference: async () => ok({ providerTransactionId: "x", stored: true }),
      findStalePending: async () => ok([]),
      confirmPayment: async () => ok({}),
      confirmWebhookPayment: async () => ok({}),
      markFailed: async () => ok(undefined),
      findById: async () => ok(null),
    });
    expectPreserved(port, instrumentPaymentRepository(port as never, metrics()));
  });

  it("instrumentWebhookEventStore يحفظ ما يلفّه", () => {
    const port = withSentinel({ record: async () => ok(true) });
    expectPreserved(port, instrumentWebhookEventStore(port as never, metrics()));
  });

  it("instrumentPaymentConfirmationDeps يحفظ الحقول ويلفّ الاثنين المعروفين", () => {
    const deps = withSentinel({
      payments: { confirmWebhookPayment: async () => ok({}) },
      events: { record: async () => ok(true) },
    });
    const wrapped = instrumentPaymentConfirmationDeps(deps as never, metrics());
    expectPreserved(deps, wrapped);
    expect(typeof wrapped.payments.confirmWebhookPayment).toBe("function");
    expect(typeof wrapped.events.record).toBe("function");
  });

  it("instrumentOfferWriter يحفظ ما يلفّه", () => {
    const port = withSentinel({
      openRound: async () => ok({ opened: true as const, offersInserted: 0, offers: [] }),
    });
    expectPreserved(port, instrumentOfferWriter(port as never, metrics()));
  });

  it("instrumentDispatchRpc يحفظ ما يلفّه", () => {
    const port = withSentinel({
      claimRide: async () => ok({ claimed: true, reason: null }),
    });
    expectPreserved(port, instrumentDispatchRpc(port as never, metrics()));
  });

  /**
   * `BUG-008` — التسليمُ المكرَّرُ نجاحٌ لا قبولٌ ثانٍ: عدُّه مرّتَين يُخرِج
   * مقياساً أكبرَ من الإسناداتِ الواقعةِ فعلاً — وهو أثرٌ جانبيٌّ مكرَّرٌ بعينِه.
   */
  it("instrumentDispatchRpc لا يعدُّ التسليمَ المكرَّرَ قبولاً ثانياً", async () => {
    const claim = (duplicate: boolean) => ({
      claimed: true,
      duplicate,
      reason: null,
      cityId: null,
      rider: null,
      driverName: null,
      driverPlate: null,
      driverVehicle: null,
    });

    const counted = createOperationalMetrics();
    const first = instrumentDispatchRpc(
      { claimRide: async () => ok(claim(false)) } as never,
      counted,
    );
    const repeated = instrumentDispatchRpc(
      { claimRide: async () => ok(claim(true)) } as never,
      counted,
    );

    await first.claimRide("order-1" as never, "driver-1" as never);
    await repeated.claimRide("order-1" as never, "driver-1" as never);
    await repeated.claimRide("order-1" as never, "driver-1" as never);

    const line = counted.registry
      .render()
      .split("\n")
      .find((entry) => entry.startsWith("waslah_dispatch_offers_accepted_total "));
    expect(line).toBe("waslah_dispatch_offers_accepted_total 1");
  });

  it("instrumentExpireOffersRpc يحفظ ما يلفّه", () => {
    const port = withSentinel({ expireStaleOffers: async () => ok(0) });
    expectPreserved(port, instrumentExpireOffersRpc(port as never, metrics()));
  });

  it("instrumentTelegramHandler يحفظ ما يلفّه", () => {
    const port = withSentinel({ handle: async () => true });
    expectPreserved(port, instrumentTelegramHandler(port as never, metrics()));
  });

  it("instrumentUpdateDeduplicator يحفظ ما يلفّه", () => {
    const port = withSentinel({ admit: () => true, size: () => 0 });
    expectPreserved(port, instrumentUpdateDeduplicator(port as never, metrics()));
  });

  /**
   * الشرط المعاكس: الغلاف لا يختلق ما ليس موجوداً. حفظُ ما وصل مطلوب، أمّا
   * تلفيقُ دالةٍ غائبة فيحوّل رفضاً صريحاً إلى انهيارٍ عند أوّل نداء.
   */
  it("لا يختلق دالةً اختياريّة غائبة عن المستودع", () => {
    const wrapped = instrumentPaymentRepository(
      { findByIdempotencyKey: async () => ok(null) } as never,
      metrics(),
    );
    expect("confirmWebhookPayment" in wrapped).toBe(false);
  });
});
