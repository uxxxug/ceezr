/**
 * الغرض: اختبار حوار بوت السائق من أول /start إلى قبول الطلب — بلا رمز بوت ولا شبكة.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: عند وصل الحوار بمجموعات تلغرام يُضاف اختبار لبثّ بطاقة الطلب.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { createMemorySessionStore } from "../../apps/gateway/src/bots/shared/session.ts";
import {
  type DriverBotDependencies,
  handleDriverUpdate,
} from "../../packages/application/bots/driver-dialog.ts";
import type { IncomingUpdate, Sender } from "../../packages/application/bots/types.ts";
import type { Subscription } from "../../packages/domain/subscription/entity.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import type { DriverId, OrderId } from "../../packages/shared/kernel/index.ts";
import { ok } from "../../packages/shared/result/index.ts";
import {
  cityDirectory,
  type DriverDirectoryDouble,
  driverDirectory,
  JEDDAH,
  MAKKAH,
  offerDecisionPort,
  subscriptionReader,
  trialPort,
  verifiedDriver,
} from "../support/bot-doubles.ts";
import { fixedClock, seededRows, settingsRepo } from "../support/in-memory-ports.ts";

const NOW = new Date("2026-08-06T12:00:00.000Z");
const SENDER: Sender = { telegramUserId: "900", chatId: "900", languageHint: "ar" };

const ar = (key: string, params: Record<string, string | number> = {}) =>
  translate("ar", key, params);

function text(value: string): IncomingUpdate {
  return { kind: "text", from: SENDER, text: value };
}
function callback(data: string): IncomingUpdate {
  return { kind: "callback", from: SENDER, data };
}
function contact(phone: string): IncomingUpdate {
  return { kind: "contact", from: SENDER, phone };
}

let drivers: DriverDirectoryDouble;
let deps: DriverBotDependencies;
let claims: { orderId: OrderId; driverId: DriverId }[];

function build(overrides: Partial<DriverBotDependencies> = {}): DriverBotDependencies {
  return { ...deps, ...overrides };
}

beforeEach(() => {
  drivers = driverDirectory(null);
  claims = [];
  deps = {
    sessions: createMemorySessionStore(fixedClock(NOW)),
    drivers,
    cities: cityDirectory(),
    settings: settingsRepo([...seededRows(JEDDAH.id), ...seededRows(MAKKAH.id)]),
    subscriptions: subscriptionReader(null),
    trial: trialPort(true),
    dispatch: {
      claimRide: async (orderId, driverId) => {
        claims.push({ orderId, driverId });
        return ok({ claimed: true, reason: null });
      },
    },
    offers: offerDecisionPort(),
    clock: fixedClock(NOW),
  };
});

describe("تسجيل السائق — المسار الكامل", () => {
  it("يمضي من /start إلى سائق مسجَّل في المدينة المختارة", async () => {
    const start = await handleDriverUpdate(text("/start"), deps);
    expect(start.map((r) => r.text)).toEqual([ar("driver.welcome"), ar("driver.ask_name")]);

    const name = await handleDriverUpdate(text("أحمد   العمري"), deps);
    expect(name[0]?.text).toBe(ar("driver.ask_phone"));
    expect(name[0]?.keyboard).toEqual({
      kind: "request_contact",
      label: ar("driver.share_phone_button"),
    });

    const phone = await handleDriverUpdate(contact("0501234567"), deps);
    expect(phone[0]?.text).toBe(ar("driver.ask_city"));
    expect(phone[0]?.keyboard).toEqual({
      kind: "inline",
      rows: [
        [{ label: "جدة", data: `city:${JEDDAH.id}` }],
        [{ label: "مكة", data: `city:${MAKKAH.id}` }],
      ],
    });

    const city = await handleDriverUpdate(callback(`city:${JEDDAH.id}`), deps);
    expect(city[0]?.text).toBe(ar("driver.ask_service"));

    const service = await handleDriverUpdate(callback("service:transport"), deps);
    expect(service[0]?.text).toBe(ar("driver.registered", { name: "أحمد العمري", city: "جدة" }));
    // مدة التجربة تأتي من platform_settings لا من ثابت في الكود
    expect(service[1]?.text).toBe(ar("driver.trial_started", { days: 30 }));

    expect(drivers.registrations).toEqual([
      {
        telegramUserId: "900",
        cityId: JEDDAH.id,
        fullName: "أحمد العمري",
        phone: "+966501234567",
        service: "transport",
      },
    ]);
  });

  it("يوحّد صيغة الجوال أياً كانت الصيغة المُدخَلة", async () => {
    for (const input of ["0501234567", "+966501234567", "966 50 123 4567", "50-123-4567"]) {
      drivers = driverDirectory(null);
      deps = build({ drivers, sessions: createMemorySessionStore(fixedClock(NOW)) });
      await handleDriverUpdate(text("/start"), deps);
      await handleDriverUpdate(text("أحمد العمري"), deps);
      await handleDriverUpdate(text(input), deps);
      await handleDriverUpdate(callback(`city:${JEDDAH.id}`), deps);
      await handleDriverUpdate(callback("service:delivery"), deps);
      expect(drivers.registrations[0]?.phone).toBe("+966501234567");
    }
  });

  it("يرفض رقماً غير سعودي ولا ينتقل للخطوة التالية", async () => {
    await handleDriverUpdate(text("/start"), deps);
    await handleDriverUpdate(text("أحمد العمري"), deps);
    const bad = await handleDriverUpdate(text("0301234567"), deps);
    expect(bad[0]?.text).toBe(ar("driver.phone_invalid"));
    const stillPhone = await handleDriverUpdate(text("0501234567"), deps);
    expect(stillPhone[0]?.text).toBe(ar("driver.ask_city"));
  });

  it("يرفض اسماً قصيراً أو أمراً مكان الاسم", async () => {
    await handleDriverUpdate(text("/start"), deps);
    expect((await handleDriverUpdate(text("أ"), deps))[0]?.text).toBe(ar("driver.name_too_short"));
    expect((await handleDriverUpdate(text("x".repeat(100)), deps))[0]?.text).toBe(
      ar("driver.name_too_long"),
    );
  });

  it("لا يقبل مدينة غير مفعَّلة حتى لو ضُغط زرّها", async () => {
    await handleDriverUpdate(text("/start"), deps);
    await handleDriverUpdate(text("أحمد العمري"), deps);
    await handleDriverUpdate(text("0501234567"), deps);
    const forged = await handleDriverUpdate(
      callback("city:99999999-9999-9999-9999-999999999999"),
      deps,
    );
    expect(forged[0]?.text).toBe(ar("common.no_active_city"));
    expect(drivers.registrations).toHaveLength(0);
  });

  it("لا يسجّل شيئاً إن كانت الجلسة قد ضاعت بين الخطوات", async () => {
    // ضغط زرّ الخدمة بلا مرور بأي خطوة قبله
    const orphan = await handleDriverUpdate(callback("service:transport"), deps);
    expect(orphan[0]?.text).toBe(ar("common.unknown_command"));
    expect(drivers.registrations).toHaveLength(0);
  });

  it("يخبر بأنه مسجَّل مسبقاً ولا يعيد التسجيل", async () => {
    const existing = verifiedDriver();
    const replies = await handleDriverUpdate(
      text("/start"),
      build({ drivers: driverDirectory(existing) }),
    );
    expect(replies[0]?.text).toBe(ar("driver.already_registered", { name: existing.fullName }));
  });

  it("يعلن سبب عدم بدء التجربة بدل الصمت", async () => {
    const withReason = build({ trial: trialPort(false, "already_used") });
    await handleDriverUpdate(text("/start"), withReason);
    await handleDriverUpdate(text("أحمد العمري"), withReason);
    await handleDriverUpdate(text("0501234567"), withReason);
    await handleDriverUpdate(callback(`city:${JEDDAH.id}`), withReason);
    const done = await handleDriverUpdate(callback("service:transport"), withReason);
    expect(done[1]?.text).toBe(ar("driver.trial_not_started", { reason: "already_used" }));
  });
});

describe("التوافر", () => {
  it("يمنع التوافر قبل تحقّق الإدارة", async () => {
    const unverified = driverDirectory(verifiedDriver({ isVerified: false }));
    const replies = await handleDriverUpdate(text("/available"), build({ drivers: unverified }));
    expect(replies[0]?.text).toBe(ar("driver.not_verified"));
    expect(unverified.availabilityCalls).toHaveLength(0);
  });

  it("يفعّل التوافر وينبّه إلى غياب الاشتراك", async () => {
    const verified = driverDirectory(verifiedDriver());
    const replies = await handleDriverUpdate(text("/available"), build({ drivers: verified }));
    expect(replies.map((r) => r.text)).toEqual([
      ar("driver.now_available"),
      ar("driver.no_live_subscription"),
    ]);
    expect(verified.availabilityCalls).toEqual([
      { driverId: "driver-1" as DriverId, isAvailable: true },
    ]);
  });

  it("لا ينبّه إلى الاشتراك إن كان سارياً", async () => {
    const live: Subscription = {
      driverId: "driver-1" as DriverId,
      cityId: JEDDAH.id,
      plan: "transport",
      status: "active",
      currentPeriodEnd: new Date(NOW.getTime() + 86_400_000),
    } as Subscription;
    const replies = await handleDriverUpdate(
      text("/available"),
      build({
        drivers: driverDirectory(verifiedDriver()),
        subscriptions: subscriptionReader(live),
      }),
    );
    expect(replies.map((r) => r.text)).toEqual([ar("driver.now_available")]);
  });

  it("يوقف التوافر بلا شرط التحقّق", async () => {
    const unverified = driverDirectory(verifiedDriver({ isVerified: false }));
    const replies = await handleDriverUpdate(text("/unavailable"), build({ drivers: unverified }));
    expect(replies[0]?.text).toBe(ar("driver.now_unavailable"));
    expect(unverified.availabilityCalls).toEqual([
      { driverId: "driver-1" as DriverId, isAvailable: false },
    ]);
  });

  it("يطلب التسجيل من غير المسجَّل", async () => {
    const replies = await handleDriverUpdate(text("/available"), deps);
    expect(replies[0]?.text).toBe(ar("driver.must_register_first"));
  });
});

describe("الاشتراك", () => {
  it("يعرض السعر من platform_settings لا من قيمة مرمَّزة", async () => {
    const replies = await handleDriverUpdate(
      text("/subscription"),
      build({ drivers: driverDirectory(verifiedDriver()) }),
    );
    expect(replies[0]?.text).toBe(
      ar("driver.subscription_none", { plan: "transport", price: 250, currency: "SAR" }),
    );
  });

  it("يتبع سعر المدينة عند اختلافه", async () => {
    const replies = await handleDriverUpdate(
      text("/subscription"),
      build({
        drivers: driverDirectory(verifiedDriver({ cityId: MAKKAH.id })),
        settings: settingsRepo(seededRows(MAKKAH.id, { subscription_price_transport: 199 })),
      }),
    );
    expect(replies[0]?.text).toContain("199");
  });

  it("يعرض تاريخ نهاية الاشتراك السارِي", async () => {
    const live = {
      driverId: "driver-1" as DriverId,
      cityId: JEDDAH.id,
      plan: "both",
      status: "active",
      currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
    } as Subscription;
    const replies = await handleDriverUpdate(
      text("/subscription"),
      build({
        drivers: driverDirectory(verifiedDriver()),
        subscriptions: subscriptionReader(live),
      }),
    );
    expect(replies[0]?.text).toBe(
      ar("driver.subscription_live", { plan: "both", until: "2026-09-01" }),
    );
  });
});

describe("قبول ورفض العرض", () => {
  it("القبول يمرّ عبر الدالة الذرّية ويعلن النجاح", async () => {
    const replies = await handleDriverUpdate(
      callback("offer:accept:order-77"),
      build({ drivers: driverDirectory(verifiedDriver()) }),
    );
    expect(claims).toEqual([{ orderId: "order-77" as OrderId, driverId: "driver-1" as DriverId }]);
    expect(replies[0]?.text).toBe(ar("driver.offer_accepted"));
  });

  it("إن سبقه غيره يعلن ذلك ولا يدّعي النجاح", async () => {
    const replies = await handleDriverUpdate(
      callback("offer:accept:order-77"),
      build({
        drivers: driverDirectory(verifiedDriver()),
        dispatch: { claimRide: async () => ok({ claimed: false, reason: "already_claimed" }) },
      }),
    );
    expect(replies[0]?.text).toBe(ar("driver.offer_taken"));
  });

  it("يميّز انتهاء المهلة عن سبق سائق آخر", async () => {
    const replies = await handleDriverUpdate(
      callback("offer:accept:order-77"),
      build({
        drivers: driverDirectory(verifiedDriver()),
        dispatch: { claimRide: async () => ok({ claimed: false, reason: "offer_expired" }) },
      }),
    );
    expect(replies[0]?.text).toBe(ar("driver.offer_expired"));
  });

  it("الرفض يُسجَّل فوراً ليخرج السائق من الدورة القادمة", async () => {
    const offers = offerDecisionPort();
    const replies = await handleDriverUpdate(
      callback("offer:reject:order-77"),
      build({ drivers: driverDirectory(verifiedDriver()), offers }),
    );
    expect(offers.rejections).toEqual([
      { orderId: "order-77" as OrderId, driverId: "driver-1" as DriverId },
    ]);
    expect(replies[0]?.text).toBe(ar("driver.offer_rejected"));
  });

  it("زرّ بلا معرّف طلب يُرفض بلا استدعاء أي دالة", async () => {
    const replies = await handleDriverUpdate(
      callback("offer:accept:"),
      build({ drivers: driverDirectory(verifiedDriver()) }),
    );
    expect(claims).toHaveLength(0);
    expect(replies[0]?.text).toBe(ar("common.unknown_command"));
  });
});

describe("متانة الحوار", () => {
  it("عطل تقني يُبلَّغ برسالة واحدة واضحة لا باستثناء", async () => {
    const replies = await handleDriverUpdate(
      text("/start"),
      build({
        drivers: {
          ...driverDirectory(null),
          findByTelegramId: async () => ({
            ok: false as const,
            error: { code: "PORT_FAILURE" as const, port: "x", detail: "down" },
          }),
        } as DriverBotDependencies["drivers"],
      }),
    );
    expect(replies[0]?.text).toBe(ar("common.error_try_again"));
  });

  it("أمر مجهول لا يُسقط الحوار", async () => {
    expect((await handleDriverUpdate(text("/foo"), deps))[0]?.text).toBe(
      ar("common.unknown_command"),
    );
  });

  it("/cancel يمحو الجلسة فيعود /start من البداية", async () => {
    await handleDriverUpdate(text("/start"), deps);
    await handleDriverUpdate(text("أحمد العمري"), deps);
    const cancelled = await handleDriverUpdate(text("/cancel"), deps);
    expect(cancelled[0]?.keyboard).toEqual({ kind: "remove" });
    const again = await handleDriverUpdate(text("/start"), deps);
    expect(again[1]?.text).toBe(ar("driver.ask_name"));
  });

  it("يردّ بالإنجليزية إن كانت لغة عميل تلغرام إنجليزية", async () => {
    const english: IncomingUpdate = {
      kind: "text",
      from: { telegramUserId: "901", chatId: "901", languageHint: "en" },
      text: "/help",
    };
    const replies = await handleDriverUpdate(english, deps);
    expect(replies[0]?.text).toBe(translate("en", "driver.help"));
  });

  it("يحفظ موقع السائق المسجَّل فعلاً", async () => {
    const drivers = driverDirectory(verifiedDriver({ hasLocation: false }));
    const replies = await handleDriverUpdate(
      { kind: "location", from: SENDER, location: { latitude: 21.4, longitude: 39.2 } },
      build({ drivers }),
    );
    expect(replies[0]?.text).toBe(ar("driver.location_saved"));
    expect(drivers.locationCalls).toEqual([
      { driverId: "driver-1" as DriverId, location: { latitude: 21.4, longitude: 39.2 } },
    ]);
  });

  it("لا يحفظ موقعاً لغير مسجَّل", async () => {
    const drivers = driverDirectory(null);
    const replies = await handleDriverUpdate(
      { kind: "location", from: SENDER, location: { latitude: 21.4, longitude: 39.2 } },
      build({ drivers }),
    );
    expect(replies[0]?.text).toBe(ar("driver.must_register_first"));
    expect(drivers.locationCalls).toHaveLength(0);
  });

  it("يرفض إحداثيات مستحيلة ولا يكتبها", async () => {
    const drivers = driverDirectory(verifiedDriver());
    const replies = await handleDriverUpdate(
      { kind: "location", from: SENDER, location: { latitude: 999, longitude: 39.2 } },
      build({ drivers }),
    );
    expect(replies[0]?.text).toBe(ar("driver.location_invalid"));
    expect(drivers.locationCalls).toHaveLength(0);
  });

  it("يطلب الموقع عند /available من سائق بلا موقع", async () => {
    const drivers = driverDirectory(verifiedDriver({ hasLocation: false }));
    const replies = await handleDriverUpdate(text("/available"), build({ drivers }));
    expect(replies.map((r) => r.text)).toContain(ar("driver.ask_location"));
    expect(replies[1]?.keyboard).toEqual({
      kind: "request_location",
      label: ar("driver.share_location_button"),
    });
  });
});
