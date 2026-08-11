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
import {
  allItemsFor,
  helpKeyboard,
  mainMenuKeyboard,
  requestWithMenuKeyboard,
} from "../../packages/application/bots/main-menu.ts";
import type { SupportDialogDependencies } from "../../packages/application/bots/support-dialog.ts";
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
function photo(fileId: string): IncomingUpdate {
  return { kind: "photo", from: SENDER, fileId, caption: null };
}
/** الخطوات الأربع التي صار التسجيل يمرّ بها بعد اختيار الخدمة. */
async function completeKyc(deps: DriverBotDependencies) {
  await handleDriverUpdate(callback("vehicle:sedan"), deps);
  await handleDriverUpdate(text("أ ب ج 1234"), deps);
  await handleDriverUpdate(text("1012345678"), deps);
  return handleDriverUpdate(photo("vphoto_900"), deps);
}
/** الافتراضي: البطاقة للمرسِل نفسه — وهو ما يفعله زرّ "مشاركة رقمي". */
function contact(
  phone: string,
  ownerTelegramId: string | null = SENDER.telegramUserId,
): IncomingUpdate {
  return { kind: "contact", from: SENDER, phone, ownerTelegramId };
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
    // البند 4.3: زرّ الرقم ومعه القائمة تحته لا يمحوها
    expect(name[0]?.keyboard).toEqual(
      requestWithMenuKeyboard(
        { kind: "request_contact", label: ar("driver.share_phone_button") },
        "driver",
        "ar",
      ),
    );

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
    // اختيار الخدمة لم يعد ينهي التسجيل: يليه الملفّ التوثيقي
    expect(service[0]?.text).toBe(ar("driver.ask_vehicle_type"));
    expect(drivers.registrations).toHaveLength(0);

    const done = await completeKyc(deps);
    expect(done[0]?.text).toBe(ar("driver.registered", { name: "أحمد العمري", city: "جدة" }));
    // مدة التجربة تأتي من platform_settings لا من ثابت في الكود
    expect(done[1]?.text).toBe(ar("driver.trial_started", { days: 30 }));

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
      await handleDriverUpdate(contact(input), deps);
      await handleDriverUpdate(callback(`city:${JEDDAH.id}`), deps);
      await handleDriverUpdate(callback("service:delivery"), deps);
      await completeKyc(deps);
      expect(drivers.registrations[0]?.phone).toBe("+966501234567");
    }
  });

  it("يرفض رقماً غير سعودي ولا ينتقل للخطوة التالية", async () => {
    await handleDriverUpdate(text("/start"), deps);
    await handleDriverUpdate(text("أحمد العمري"), deps);
    const bad = await handleDriverUpdate(contact("0301234567"), deps);
    expect(bad[0]?.text).toBe(ar("driver.phone_invalid"));
    const stillPhone = await handleDriverUpdate(contact("0501234567"), deps);
    expect(stillPhone[0]?.text).toBe(ar("driver.ask_city"));
  });

  it("يرفض رقماً مكتوباً بلا زرّ ويعيد عرض الزرّ", async () => {
    await handleDriverUpdate(text("/start"), deps);
    await handleDriverUpdate(text("أحمد العمري"), deps);
    const typed = await handleDriverUpdate(text("0501234567"), deps);
    expect(typed[0]?.text).toBe(ar("driver.phone_must_use_button"));
    expect(typed[0]?.keyboard?.kind).toBe("request_contact");
    // ولم ينتقل: الزرّ الحقيقي ما زال يعمل بعده
    const shared = await handleDriverUpdate(contact("0501234567"), deps);
    expect(shared[0]?.text).toBe(ar("driver.ask_city"));
  });

  it("يرفض بطاقة جهة اتصال لشخص آخر ولا يخزّن رقمها", async () => {
    await handleDriverUpdate(text("/start"), deps);
    await handleDriverUpdate(text("أحمد العمري"), deps);
    const forwarded = await handleDriverUpdate(contact("0509999999", "999999"), deps);
    expect(forwarded[0]?.text).toBe(ar("driver.phone_not_yours"));
    const shared = await handleDriverUpdate(contact("0501234567"), deps);
    expect(shared[0]?.text).toBe(ar("driver.ask_city"));
    await handleDriverUpdate(callback(`city:${JEDDAH.id}`), deps);
    await handleDriverUpdate(callback("service:delivery"), deps);
    await completeKyc(deps);
    expect(drivers.registrations[0]?.phone).toBe("+966501234567");
  });

  it("يرفض بطاقة بلا حساب تلغرام", async () => {
    await handleDriverUpdate(text("/start"), deps);
    await handleDriverUpdate(text("أحمد العمري"), deps);
    const manual = await handleDriverUpdate(contact("0501234567", null), deps);
    expect(manual[0]?.text).toBe(ar("driver.phone_not_yours"));
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
    await handleDriverUpdate(contact("0501234567"), deps);
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
    await handleDriverUpdate(contact("0501234567"), withReason);
    await handleDriverUpdate(callback(`city:${JEDDAH.id}`), withReason);
    await handleDriverUpdate(callback("service:transport"), withReason);
    const done = await completeKyc(withReason);
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
      // البند 6.3: النصّ يسمّي الزرّ بنصّه الحقيقي لا بأمرٍ مكتوب على السائق أن يتعلّمه
      ar("driver.no_live_subscription", { subscription_button: ar("menu.driver.subscription") }),
    ]);
    expect(replies[1]?.text).toContain(ar("menu.driver.subscription"));
    expect(replies[1]?.text).not.toContain("/subscription");
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

  /**
   * الحالة التي وقعت في الإنتاج فعلاً: سائقٌ موثَّق ومتاح ومشترك، و
   * `last_location = null`. فلم يصله طلبٌ واحد، وهو يظنّ نفسه عاملاً لأن
   * البوت قال له «أنت الآن متاح». واستعلام المرشّحين يشترط
   * `d.last_location is not null` فكان خفيّاً عن الإسناد تماماً.
   */
  it("لا يدّعي التوافر لمن لا موقع له، بل يقول الحقيقة ويطلب الموقع", async () => {
    const noLocation = driverDirectory(verifiedDriver({ hasLocation: false }));
    const replies = await handleDriverUpdate(text("/available"), build({ drivers: noLocation }));

    const texts = replies.map((r) => r.text);
    // الادّعاء الكاذب غائب
    expect(texts).not.toContain(ar("driver.now_available"));
    // والحقيقة حاضرة أوّلاً
    expect(texts[0]).toBe(ar("driver.available_needs_location"));
    expect(texts).toContain(ar("driver.ask_location"));
    // والرغبة مسجَّلة رغم ذلك: فمتى وصل الموقع صار ظاهراً بلا أمرٍ جديد
    expect(noLocation.availabilityCalls).toEqual([
      { driverId: "driver-1" as DriverId, isAvailable: true },
    ]);
    // وزرّ الموقع مرفق لا مجرّد نصّ
    expect(replies.some((r) => r.keyboard?.kind === "request_location")).toBe(true);
  });

  it("وصول الموقع لمن كان متاحاً يُخبره أنه صار ظاهراً فعلاً", async () => {
    const drivers = driverDirectory(verifiedDriver({ hasLocation: false, isAvailable: true }));
    const replies = await handleDriverUpdate(
      { kind: "location", from: SENDER, location: { latitude: 21.5433, longitude: 39.1728 } },
      build({ drivers }),
    );
    expect(replies[0]?.text).toBe(ar("driver.location_saved_now_live"));
  });

  it("وصول الموقع لغير المتاح يبقى على الرسالة العادية", async () => {
    const drivers = driverDirectory(verifiedDriver({ hasLocation: false, isAvailable: false }));
    const replies = await handleDriverUpdate(
      { kind: "location", from: SENDER, location: { latitude: 21.5433, longitude: 39.1728 } },
      build({ drivers }),
    );
    expect(replies[0]?.text).toBe(ar("driver.location_saved"));
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

describe("القائمة الدائمة في حوار السائق", () => {
  it("ترافق الترحيب من أوّل رسالة", async () => {
    const start = await handleDriverUpdate(text("/start"), deps);
    expect(start[0]?.keyboard).toEqual(mainMenuKeyboard("driver", "ar"));
  });

  /**
   * لوحة الردّ ترسل **نصّ الزرّ حرفياً**، فبلا ترجمة قبل فحص الخطوة يُسجَّل
   * نصّ الزرّ اسماً للسائق في منتصف تسجيله — وهو ما يمنعه هذا الاختبار.
   */
  it("زرّ القائمة يعمل في منتصف التسجيل ولا يُسجَّل اسماً", async () => {
    await handleDriverUpdate(text("/start"), deps);

    const pressed = await handleDriverUpdate(text(ar("menu.driver.available")), deps);
    // وصل إلى /available فعلاً — لا «اسم غير صالح» ولا «لم أفهم هذه الرسالة»
    expect(pressed[0]?.text).toBe(ar("driver.must_register_first"));

    // والخطوة لم تتقدّم: لم يُأخذ نصّ الزرّ اسماً ويُسأل عن الهاتف
    const state = await deps.sessions.load(SENDER.telegramUserId);
    expect(state.ok && state.value?.step).toBe("awaiting_name");
    expect(state.ok && state.value?.draftName).toBeNull();
  });

  it("يفهم زرّاً بلغة أخرى — لوحة قديمة باقية على جهاز السائق", async () => {
    const pressed = await handleDriverUpdate(text(translate("ur", "menu.driver.available")), deps);
    expect(pressed[0]?.text).toBe(ar("driver.must_register_first"));
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

  it("/cancel يمحو الجلسة فيعود /start من البداية ويُبقي القائمة الدائمة", async () => {
    await handleDriverUpdate(text("/start"), deps);
    await handleDriverUpdate(text("أحمد العمري"), deps);
    const cancelled = await handleDriverUpdate(text("/cancel"), deps);
    // كان هذا الاختبار يثبّت `{kind:"remove"}`. وتغيّر السلوك عمداً: إخلاء أسفل
    // الشاشة عند الإلغاء يسلب المستخدمَ زرَّ الدعم في أكثر لحظة يحتاجه فيها،
    // وهو ما ينقض مطلب «زرّ الدعم في كل الحالات» نصّاً. فالإلغاء رجوعٌ للقائمة.
    expect(cancelled[0]?.keyboard).toEqual(mainMenuKeyboard("driver", "ar"));
    // والمقصود الأصلي من الاختبار — محو الجلسة — يبقى مثبّتاً كما هو
    const again = await handleDriverUpdate(text("/start"), deps);
    expect(again[1]?.text).toBe(ar("driver.ask_name"));
  });

  it("لا يعيد زر نوع شكوى قديم فتح حوار ألغاه السائق", async () => {
    const d = build({
      drivers: driverDirectory(verifiedDriver()),
      // هذا المسار لا يستدعي منافذ الدعم الأخرى: يكفي مخزن الجلسة لإثبات الحراسة.
      support: { sessions: deps.sessions } as SupportDialogDependencies,
    });

    await handleDriverUpdate(text("/support"), d);
    await handleDriverUpdate(text("/cancel"), d);
    const stale = await handleDriverUpdate(callback("sup:type:subscription"), d);

    expect(stale[0]?.text).toBe(ar("common.unknown_command"));
    const state = await d.sessions.load(SENDER.telegramUserId);
    expect(state.ok && state.value).toBeNull();
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
    expect(replies[1]?.keyboard).toEqual(
      requestWithMenuKeyboard(
        { kind: "request_location", label: ar("driver.share_location_button") },
        "driver",
        "ar",
      ),
    );
  });
});

/**
 * البند 4.3 — الدعم بضغطة واحدة في كل الحالات. المطلب ليس وجود زرّ في القائمة
 * (ذاك أُنجز في 2.1) بل **بقاؤه معروضاً**: لوحة الردّ في تلغرام واحدة لا تتراكم،
 * فكل لوحة طلبِ رقم أو موقع أو إزالةٍ كانت تمحو القائمة — ومعها زرّ الدعم —
 * في الخطوات الطويلة نفسها التي يتعثّر فيها المستخدم فيحتاج الدعم.
 */
describe("زرّ الدعم لا يغيب في أي حالة — بوت السائق", () => {
  const supportLabel = ar("menu.support");

  /** كل نصوص الأزرار المعروضة في لوحة ردّ واحدة، أيّاً كان نوعها. */
  const labelsOf = (keyboard: unknown): readonly string[] => {
    const board = keyboard as
      | { kind: string; rows?: string[][]; label?: string; menuRows?: string[][] }
      | null
      | undefined;
    if (board === null || board === undefined) return [];
    if (board.kind === "reply") return (board.rows ?? []).flat();
    if (board.kind === "request_location" || board.kind === "request_contact") {
      return [board.label ?? "", ...(board.menuRows ?? []).flat()];
    }
    return [];
  };

  it("خطوة الرقم تُبقي زرّ الدعم — وهي أكثر مواضع تعثّر السائق الجديد", async () => {
    await handleDriverUpdate(text("/start"), deps);
    const asked = await handleDriverUpdate(text("أحمد العمري"), deps);
    expect(labelsOf(asked[0]?.keyboard)).toContain(supportLabel);
  });

  it("رقم مكتوب بلا زرّ يُرفض والقائمة باقية", async () => {
    await handleDriverUpdate(text("/start"), deps);
    await handleDriverUpdate(text("أحمد العمري"), deps);
    const typed = await handleDriverUpdate(text("0501234567"), deps);
    expect(typed[0]?.text).toBe(ar("driver.phone_must_use_button"));
    expect(labelsOf(typed[0]?.keyboard)).toContain(supportLabel);
  });

  it("طلب الموقع عند /available يُبقي زرّ الدعم", async () => {
    const drivers = driverDirectory(verifiedDriver({ hasLocation: false }));
    const replies = await handleDriverUpdate(text("/available"), build({ drivers }));
    expect(labelsOf(replies[1]?.keyboard)).toContain(supportLabel);
  });

  /**
   * «لا مدينة عاملة» خللٌ تشغيلي عندنا لا خطأ من السائق، وكان يُرسَل مع إزالة
   * اللوحة — فيبقى في شاشة خالية بلا طريق شكوى من عطلٍ ليس من فعله.
   */
  it("غياب المدن العاملة لا يُخلي أسفل الشاشة", async () => {
    await handleDriverUpdate(text("/start"), deps);
    await handleDriverUpdate(text("أحمد العمري"), deps);
    const replies = await handleDriverUpdate(
      contact("0501234567"),
      build({ cities: cityDirectory([]) }),
    );
    expect(replies[0]?.text).toBe(ar("common.no_active_city"));
    expect(replies[0]?.keyboard).toEqual(mainMenuKeyboard("driver", "ar"));
  });

  it("‏/support من غير مسجَّل يردّ بالقائمة لا بنصّ عارٍ", async () => {
    const d = build({ support: { sessions: deps.sessions } as SupportDialogDependencies });
    const replies = await handleDriverUpdate(text("/support"), d);
    expect(replies[0]?.text).toBe(ar("support.not_registered"));
    expect(replies[0]?.keyboard).toEqual(mainMenuKeyboard("driver", "ar"));
  });

  /** ضغطة واحدة: زرّ الدعم نصّاً وسط خطوة تسجيل لا يُسجَّل اسماً ولا رقماً. */
  it("زرّ الدعم وسط خطوة الاسم يفتح الدعم لا يُسجَّل اسماً", async () => {
    const d = build({ support: { sessions: deps.sessions } as SupportDialogDependencies });
    await handleDriverUpdate(text("/start"), d);
    const pressed = await handleDriverUpdate(text(supportLabel), d);
    expect(pressed[0]?.text).toBe(ar("support.not_registered"));
    expect(pressed[0]?.text).not.toBe(ar("driver.ask_phone"));
  });
});

/**
 * البند 6.3 — `/help` يعرض الأوامر أزراراً، ومصدرها واحد مع القائمة الدائمة.
 *
 * العطب الذي كان: نصّ `driver.help` قائمةُ أوامرٍ مكتوبة يداً في القاموس، فتباعد
 * عن القائمة الحقيقية — لم يذكر «الدعم / شكوى» ولا «اللغة» أصلاً.
 */
describe("لوحة /help — البند 6.3", () => {
  it("يعرض كل أوامر السائق أزراراً inline لا نصّاً", async () => {
    const replies = await handleDriverUpdate(text("/help"), build());
    expect(replies).toHaveLength(2);
    expect(replies[0]?.keyboard).toEqual(helpKeyboard("driver", "ar"));

    const keyboard = replies[0]?.keyboard;
    if (keyboard?.kind !== "inline") throw new Error("لوحة /help يجب أن تكون inline");
    const labels = keyboard.rows.flat().map((button) => button.label);
    const data = keyboard.rows.flat().map((button) => button.data);
    // المصدر واحد: كل بند قائمة له زرّ، فلا يتباعد /help عن اللوحة الدائمة مرّة أخرى
    for (const item of allItemsFor("driver")) {
      expect(labels).toContain(ar(item.key));
      expect(data).toContain(`cmd:${item.command}`);
    }
    expect(labels).toContain(ar("menu.support"));
    // ولا يعود النصّ قائمة أوامر مكتوبة
    expect(replies[0]?.text).not.toContain("/available");
  });

  it("الردّ الثاني يُعيد تأكيد القائمة الدائمة لا يتركها للحظّ", async () => {
    const replies = await handleDriverUpdate(text("/help"), build());
    expect(replies[1]?.text).toBe(ar("menu.hint"));
    expect(replies[1]?.keyboard).toEqual(mainMenuKeyboard("driver", "ar"));
  });

  it("ضغط زرّ أمرٍ يمرّ بنفس موجّه الأوامر — /support يفتح الدعم", async () => {
    const d = build({
      drivers: driverDirectory(verifiedDriver()),
      support: { sessions: deps.sessions } as SupportDialogDependencies,
    });
    const replies = await handleDriverUpdate(callback("cmd:/support"), d);
    expect(replies[0]?.text).toBe(ar("support.choose_type"));
  });

  it("زرّ بأمرٍ ليس من أوامر السائق يُرفض ولا يُنفَّذ", async () => {
    // callback_data يأتي من جهاز المستخدم، فزرٌّ مصنوع بيده لا يجوز أن ينادي أي أمر
    const drivers = driverDirectory(verifiedDriver());
    const replies = await handleDriverUpdate(callback("cmd:/ride"), build({ drivers }));
    expect(replies[0]?.text).toBe(ar("common.unknown_command"));
    expect(drivers.availabilityCalls).toEqual([]);
  });
});
