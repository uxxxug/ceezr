/**
 * الغرض: إثبات قرارات مهمّتي دورة حياة الاشتراك وتنظيف التوفّر البائت بمنافذ مزدوجة:
 *   ترتيب الإرسال قبل التثبيت، عزل فشل سائق واحد، اختيار الصياغة، وقراءة المهلة
 *   من إعدادات المدينة لا من رقم في الكود.
 * الحالة: اختبار وحدة حقيقي بلا شبكة ولا قاعدة — المرحلة 2.6 الخطوة 02.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI (bun test)
 * ملاحظات مستقبلية: التجديد المدفوع التلقائي يضيف حالات هنا بلا تغيير القائم.
 */

import { describe, expect, test } from "bun:test";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import { deactivateStaleAvailability } from "../../packages/application/scheduling/deactivate-stale-availability.ts";
import type {
  ExpiringSubscription,
  ExpiryWarningSender,
  SubscriptionLifecycleRpcPort,
} from "../../packages/application/subscription/expire-subscriptions.ts";
import {
  expireDueSubscriptions,
  warnExpiringSubscriptions,
} from "../../packages/application/subscription/expire-subscriptions.ts";
import type { CityId, DriverId } from "../../packages/shared/kernel/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const CITY = "11111111-1111-1111-1111-111111111111" as CityId;

function expiring(overrides: Partial<ExpiringSubscription> = {}): ExpiringSubscription {
  return {
    subscriptionId: "sub-1",
    cityId: CITY,
    driverId: "22222222-2222-2222-2222-222222222222" as DriverId,
    telegramId: "500001",
    languageCode: "ar",
    plan: "transport",
    status: "active",
    endsAt: new Date("2026-08-10T00:00:00.000Z"),
    daysLeft: 2,
    ...overrides,
  };
}

interface Recorded {
  readonly sent: { chatId: string; text: string }[];
  readonly warnings: { id: string }[];
}

function stubRpc(
  due: readonly ExpiringSubscription[],
  recorded: Recorded,
  options: { readonly recordFails?: boolean } = {},
): SubscriptionLifecycleRpcPort {
  return {
    expireDue: async () => ok({ expiredCount: due.length }),
    expiringSoon: async () => ok(due),
    recordWarning: async (id) => {
      if (options.recordFails === true) {
        return err(new PortFailureError("rpc.record_subscription_warning", "انقطع الاتصال"));
      }
      recorded.warnings.push({ id });
      return ok(undefined);
    },
  };
}

function stubSender(recorded: Recorded, failFor: readonly string[] = []): ExpiryWarningSender {
  return {
    send: async ({ chatId, text }) => {
      if (failFor.includes(chatId)) {
        return err(new PortFailureError("telegram.sendMessage", "bot was blocked by the user"));
      }
      recorded.sent.push({ chatId, text });
      return ok(undefined);
    },
  };
}

function empty(): Recorded {
  return { sent: [], warnings: [] };
}

describe("expireDueSubscriptions", () => {
  test("يعيد العدد كما أعادته القاعدة بلا حساب في الطبقة", async () => {
    const recorded = empty();
    const result = await expireDueSubscriptions({
      rpc: stubRpc([expiring(), expiring({ subscriptionId: "sub-2" })], recorded),
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.expiredCount).toBe(2);
  });

  test("يمرّر عطل القاعدة كما هو بلا ادّعاء نجاح", async () => {
    const failure = new PortFailureError("rpc.expire_due_subscriptions", "deadlock detected");
    const result = await expireDueSubscriptions({
      rpc: {
        expireDue: async () => err(failure),
        expiringSoon: async () => ok([]),
        recordWarning: async () => ok(undefined),
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.detail).toBe("deadlock detected");
  });
});

describe("warnExpiringSubscriptions", () => {
  test("يُرسل ثم يُثبِّت — بهذا الترتيب لا عكسه", async () => {
    const recorded = empty();
    const order: string[] = [];
    const rpc: SubscriptionLifecycleRpcPort = {
      expireDue: async () => ok({ expiredCount: 0 }),
      expiringSoon: async () => ok([expiring()]),
      recordWarning: async () => {
        order.push("record");
        return ok(undefined);
      },
    };
    const sender: ExpiryWarningSender = {
      send: async () => {
        order.push("send");
        return ok(undefined);
      },
    };

    const result = await warnExpiringSubscriptions({ days: 2 }, { rpc, sender });

    expect(result.ok).toBe(true);
    expect(order).toEqual(["send", "record"]);
    expect(recorded.warnings).toEqual([]);
  });

  test("لا يُثبِّت تحذيراً لم يخرج: فشل الإرسال يمنع التثبيت", async () => {
    const recorded = empty();
    const result = await warnExpiringSubscriptions(
      { days: 2 },
      { rpc: stubRpc([expiring()], recorded), sender: stubSender(recorded, ["500001"]) },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.warned).toBe(0);
      expect(result.value.failed).toEqual(["sub-1"]);
    }
    expect(recorded.warnings).toEqual([]);
  });

  test("فشل سائق واحد لا يمنع تحذير من بعده", async () => {
    const recorded = empty();
    const batch = [
      expiring({ subscriptionId: "sub-blocked", telegramId: "500001" }),
      expiring({ subscriptionId: "sub-ok", telegramId: "500002" }),
    ];

    const result = await warnExpiringSubscriptions(
      { days: 2 },
      { rpc: stubRpc(batch, recorded), sender: stubSender(recorded, ["500001"]) },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.examined).toBe(2);
      expect(result.value.warned).toBe(1);
      expect(result.value.failed).toEqual(["sub-blocked"]);
    }
    expect(recorded.sent.map((s) => s.chatId)).toEqual(["500002"]);
    expect(recorded.warnings.map((w) => w.id)).toEqual(["sub-ok"]);
  });

  test("نجاح الإرسال مع فشل التثبيت يُحسب تحذيراً — الرسالة وصلت فعلاً", async () => {
    const recorded = empty();
    const failures: string[] = [];

    const result = await warnExpiringSubscriptions(
      { days: 2 },
      {
        rpc: stubRpc([expiring()], recorded, { recordFails: true }),
        sender: stubSender(recorded),
        onSendFailure: (id) => failures.push(id),
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.warned).toBe(1);
      expect(result.value.failed).toEqual([]);
    }
    expect(failures).toEqual(["sub-1"]);
  });

  test("يوم واحد متبقٍّ يعطي صياغة «غداً»، ويومان يعطيان صياغة العدّ", async () => {
    const recorded = empty();
    const batch = [
      expiring({ subscriptionId: "sub-tomorrow", telegramId: "500001", daysLeft: 1 }),
      expiring({ subscriptionId: "sub-two", telegramId: "500002", daysLeft: 2 }),
    ];

    await warnExpiringSubscriptions(
      { days: 2 },
      { rpc: stubRpc(batch, recorded), sender: stubSender(recorded) },
    );

    expect(recorded.sent[0]?.text).toContain("غداً");
    expect(recorded.sent[1]?.text).toContain("2");
    expect(recorded.sent[1]?.text).not.toContain("غداً");
  });

  test("يخاطب كل سائق بلغته المسجَّلة لا بلغة النظام", async () => {
    const recorded = empty();
    const batch = [
      expiring({ subscriptionId: "s-en", telegramId: "500001", languageCode: "en" }),
      expiring({ subscriptionId: "s-ur", telegramId: "500002", languageCode: "ur" }),
    ];

    await warnExpiringSubscriptions(
      { days: 2 },
      { rpc: stubRpc(batch, recorded), sender: stubSender(recorded) },
    );

    expect(recorded.sent[0]?.text).toContain("subscription");
    expect(recorded.sent[1]?.text).toContain("سبسکرپشن");
  });

  test("لا مشترك يقترب انتهاؤه: تقرير صفري وليس فشلاً", async () => {
    const recorded = empty();
    const result = await warnExpiringSubscriptions(
      { days: 2 },
      { rpc: stubRpc([], recorded), sender: stubSender(recorded) },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ examined: 0, warned: 0, failed: [] });
    expect(recorded.sent).toEqual([]);
  });
});

describe("deactivateStaleAvailability", () => {
  const settingsWith = (minutes: string | null) => ({
    findByCity: async () =>
      ok(
        minutes === null
          ? []
          : [
              {
                cityId: CITY,
                key: "availability_stale_minutes",
                value: minutes,
                valueType: "number" as const,
              },
            ],
      ),
  });

  test("يستخدم المهلة من إعدادات المدينة لا القيمة الاحتياطية", async () => {
    const seen: number[] = [];
    const result = await deactivateStaleAvailability(
      { cityId: CITY },
      {
        settings: settingsWith("90"),
        rpc: {
          deactivate: async (_city, minutes) => {
            seen.push(minutes);
            return ok(3);
          },
        },
        fallbackMinutes: 180,
      },
    );

    expect(seen).toEqual([90]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.staleMinutes).toBe(90);
      expect(result.value.deactivated).toBe(3);
    }
  });

  test("يسقط إلى القيمة الاحتياطية حين يغيب الإعداد — ولا يُوقف المهمّة", async () => {
    const seen: number[] = [];
    const result = await deactivateStaleAvailability(
      { cityId: CITY },
      {
        settings: settingsWith(null),
        rpc: {
          deactivate: async (_city, minutes) => {
            seen.push(minutes);
            return ok(0);
          },
        },
        fallbackMinutes: 180,
      },
    );

    expect(seen).toEqual([180]);
    expect(result.ok).toBe(true);
  });

  test("قيمة إعداد غير رقمية لا تُمرَّر للقاعدة: تُستبدل بالاحتياطية", async () => {
    const seen: number[] = [];
    await deactivateStaleAvailability(
      { cityId: CITY },
      {
        settings: settingsWith('"ثلاث ساعات"'),
        rpc: {
          deactivate: async (_city, minutes) => {
            seen.push(minutes);
            return ok(0);
          },
        },
        fallbackMinutes: 180,
      },
    );

    expect(seen).toEqual([180]);
  });

  test("عطل القاعدة يُعاد كما هو ولا يُترجَم إلى صفر", async () => {
    const result = await deactivateStaleAvailability(
      { cityId: CITY },
      {
        settings: settingsWith("90"),
        rpc: {
          deactivate: async () =>
            err(new PortFailureError("rpc.deactivate_stale_availability", "INVALID_STALE_MINUTES")),
        },
        fallbackMinutes: 180,
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.detail).toBe("INVALID_STALE_MINUTES");
  });
});
