/**
 * الغرض: اختبار محوّل تلغرام: قراءة التحديث الخام، بناء الأزرار، وإرسال الردود فعلاً.
 * الحالة: اختبار فعلي — الإرسال يُلتقط بمزدوج بدل شبكة تلغرام.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: عند وصول رمز البوت يُضاف اختبار دخان واحد يرسل رسالة حقيقية إلى مجموعة اختبار.
 */
import { describe, expect, it } from "bun:test";
import { createDriverBot } from "../../apps/gateway/src/bots/driver/index.ts";
import {
  isCallbackDataValid,
  toTelegramMarkup,
} from "../../apps/gateway/src/bots/shared/keyboards.ts";
import { createMemorySessionStore } from "../../apps/gateway/src/bots/shared/session.ts";
import { toIncomingUpdate } from "../../apps/gateway/src/bots/shared/telegram-mapper.ts";
import { createUpdateHandler } from "../../apps/gateway/src/container.ts";
import type { DriverBotDependencies } from "../../packages/application/bots/driver-dialog.ts";
import { INITIAL_STATE } from "../../packages/application/bots/types.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import { ok } from "../../packages/shared/result/index.ts";
import {
  capturingSender,
  cityDirectory,
  driverDirectory,
  failingSender,
  JEDDAH,
  offerDecisionPort,
  offerWriterDouble,
  orderWriter,
  rideRequestCommand,
  riderDirectory,
  subscriptionReader,
  trialPort,
} from "../support/bot-doubles.ts";
import {
  candidateRepo,
  fixedClock,
  offerRepo,
  orderRepo,
  seededRows,
  settingsRepo,
} from "../support/in-memory-ports.ts";

const NOW = new Date("2026-08-06T12:00:00.000Z");

function deps(): DriverBotDependencies {
  return {
    sessions: createMemorySessionStore(fixedClock(NOW)),
    drivers: driverDirectory(null),
    cities: cityDirectory([JEDDAH]),
    settings: settingsRepo(seededRows(JEDDAH.id)),
    subscriptions: subscriptionReader(null),
    trial: trialPort(true),
    dispatch: {
      claimRide: async () =>
        ok({
          claimed: true,
          duplicate: false,
          reason: null,
          cityId: null,
          rider: null,
          driverName: null,
          driverPlate: null,
          driverVehicle: null,
        }),
    },
    offers: offerDecisionPort(),
    clock: fixedClock(NOW),
  };
}

describe("toIncomingUpdate", () => {
  it("يقرأ رسالة نصية", () => {
    const incoming = toIncomingUpdate({
      update_id: 1,
      message: { chat: { id: 900 }, from: { id: 900, language_code: "ar" }, text: "/start" },
    });
    expect(incoming).toEqual({
      kind: "text",
      updateId: 1,
      from: { telegramUserId: "900", chatId: "900", languageHint: "ar" },
      text: "/start",
    });
  });

  it("يقرأ ضغطة زرّ ويأخذ الدردشة من الرسالة المرفقة", () => {
    const incoming = toIncomingUpdate({
      update_id: 1,
      callback_query: {
        data: "offer:accept:order-1",
        from: { id: 900 },
        message: { chat: { id: 42 } },
      },
    });
    expect(incoming?.kind).toBe("callback");
    expect(incoming?.from.chatId).toBe("42");
  });

  it("يقرأ الموقع وجهة الاتصال", () => {
    const loc = toIncomingUpdate({
      update_id: 1,
      message: { chat: { id: 1 }, from: { id: 1 }, location: { latitude: 21.5, longitude: 39.1 } },
    });
    expect(loc).toMatchObject({ kind: "location", location: { latitude: 21.5, longitude: 39.1 } });

    const phone = toIncomingUpdate({
      update_id: 1,
      message: {
        chat: { id: 1 },
        from: { id: 1 },
        contact: { user_id: 1, phone_number: "+966501234567" },
      },
    });
    expect(phone).toMatchObject({ kind: "contact", phone: "+966501234567" });
  });

  it("يعيد null لما لا يخصّنا بلا خطأ", () => {
    expect(toIncomingUpdate({})).toBeNull();
    expect(toIncomingUpdate({ update_id: 1, message: { text: "بلا مُرسِل" } })).toBeNull();
    expect(
      toIncomingUpdate({
        update_id: 1,
        callback_query: { from: { id: 1 }, message: { chat: { id: 1 } } },
      }),
    ).toBeNull();
  });

  it("رسالة بلا نص ولا موقع تُصنَّف غير مدعومة لا مهمَلة", () => {
    expect(
      toIncomingUpdate({ update_id: 1, message: { chat: { id: 1 }, from: { id: 1 } } }),
    ).toMatchObject({
      kind: "unsupported",
    });
  });
});

describe("toTelegramMarkup", () => {
  it("يحوّل أزرار inline", () => {
    expect(
      toTelegramMarkup({ kind: "inline", rows: [[{ label: "جدة", data: "city:1" }]] }),
    ).toEqual({ inline_keyboard: [[{ text: "جدة", callback_data: "city:1" }]] });
  });

  it("يحوّل زرّ الموقع وزرّ الرقم", () => {
    expect(toTelegramMarkup({ kind: "request_location", label: "موقعي" })).toEqual({
      keyboard: [[{ text: "موقعي", request_location: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    expect(toTelegramMarkup({ kind: "request_contact", label: "رقمي" })).toMatchObject({
      keyboard: [[{ text: "رقمي", request_contact: true }]],
    });
  });

  /**
   * البند 4.3: لوحة الردّ في تلغرام واحدة لا تتراكم، فزرّ موقع وحده يمحو القائمة
   * الدائمة — ومعها زرّ الدعم — في منتصف الطلب. القائمة المرفقة تحته هي الإصلاح،
   * وتصير اللوحة دائمةً لا لمرّة لأن إرسال الموقع قد يُعاد (موقع خارج المدينة يُرفض).
   */
  it("يُرفِق القائمة تحت زرّ الطلب فتصير اللوحة دائمة", () => {
    expect(
      toTelegramMarkup({
        kind: "request_location",
        label: "موقعي",
        menuRows: [["مشوار", "توصيل"], ["الدعم"]],
      }),
    ).toEqual({
      keyboard: [
        [{ text: "موقعي", request_location: true }],
        [{ text: "مشوار" }, { text: "توصيل" }],
        [{ text: "الدعم" }],
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
      is_persistent: true,
    });

    expect(
      toTelegramMarkup({ kind: "request_contact", label: "رقمي", menuRows: [["الدعم"]] }),
    ).toMatchObject({ is_persistent: true, one_time_keyboard: false });
  });

  it("قائمة فارغة تُعيد سلوك الزرّ المفرد كما كان", () => {
    expect(toTelegramMarkup({ kind: "request_location", label: "موقعي", menuRows: [] })).toEqual({
      keyboard: [[{ text: "موقعي", request_location: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
  });

  it("يحوّل إزالة اللوحة، ويعيد undefined لغياب اللوحة", () => {
    expect(toTelegramMarkup({ kind: "remove" })).toEqual({ remove_keyboard: true });
    expect(toTelegramMarkup(null)).toBeUndefined();
  });

  it("يعرف حدّ تلغرام لبيانات الزرّ", () => {
    expect(isCallbackDataValid("offer:accept:0193f0aa-1f3c-7b2e-9a0d-2b6c8e4f1a55")).toBe(true);
    /**
     * `BUG-003` — زرُّ الرفضِ يحمِلُ `offerId` (uuid) لا `orderId`، ولا يزالُ تحتَ
     * حدِّ تلغرامَ ٦٤ بايتاً لـ`callback_data`.
     */
    expect(isCallbackDataValid("offer:reject:0193f0aa-1f3c-7b2e-9a0d-2b6c8e4f1a55")).toBe(true);
    expect(isCallbackDataValid("x".repeat(65))).toBe(false);
  });
});

describe("محوّل بوت السائق", () => {
  it("يرسل ردّي /start فعلاً بترتيبهما", async () => {
    const sender = capturingSender();
    const bot = createDriverBot(deps(), sender);
    const handled = await bot.handleUpdate({
      update_id: 1,
      message: { chat: { id: 900 }, from: { id: 900, language_code: "ar" }, text: "/start" },
    });
    expect(handled).toBe(true);
    expect(sender.sent.map((m) => m.text)).toEqual([
      translate("ar", "driver.welcome"),
      translate("ar", "driver.ask_name"),
    ]);
    expect(sender.sent[0]?.chatId).toBe("900");
  });

  it("يمرّر لوحة الأزرار بصيغة تلغرام", async () => {
    const sender = capturingSender();
    const shared = deps();
    const bot = createDriverBot(shared, sender);
    await bot.handleUpdate({
      update_id: 1,
      message: { chat: { id: 900 }, from: { id: 900 }, text: "/start" },
    });
    await bot.handleUpdate({
      update_id: 1,
      message: { chat: { id: 900 }, from: { id: 900 }, text: "أحمد العمري" },
    });
    const last = sender.sent[sender.sent.length - 1];
    const markup = last?.markup as
      | { keyboard: { text: string; request_contact?: true }[][] }
      | undefined;
    expect(markup?.keyboard[0]).toEqual([
      { text: translate("ar", "driver.share_phone_button"), request_contact: true },
    ]);
    // البند 4.3: زرّ الدعم حاضر في نفس اللوحة، فخطوة الرقم لا تسلبه من السائق الجديد
    expect(markup?.keyboard.flat().map((button) => button.text)).toContain(
      translate("ar", "menu.support"),
    );
  });

  it("يعترف بالاستلام ولا يردّ على تحديث لا يخصّنا", async () => {
    const sender = capturingSender();
    const bot = createDriverBot(deps(), sender);
    expect(await bot.handleUpdate({})).toBe(true);
    expect(sender.sent).toHaveLength(0);
  });

  it("يعيد false إن فشل الإرسال فعلاً — بلا ادّعاء نجاح", async () => {
    const bot = createDriverBot(deps(), failingSender("429 too many requests"));
    const handled = await bot.handleUpdate({
      update_id: 1,
      message: { chat: { id: 900 }, from: { id: 900 }, text: "/start" },
    });
    expect(handled).toBe(false);
  });

  it("يسجّل ويفشل بلا إرسال إن تجاوزت بيانات زرّ حدّ تلغرام", async () => {
    const sender = capturingSender();
    const logs: string[] = [];
    const longCity = {
      id: "c".repeat(90) as unknown as typeof JEDDAH.id,
      code: "LNG",
      name: "مدينة",
    };
    const bot = createDriverBot(
      { ...deps(), cities: cityDirectory([longCity]) },
      sender,
      (message) => logs.push(message),
    );
    await bot.handleUpdate({
      update_id: 1,
      message: { chat: { id: 900 }, from: { id: 900 }, text: "/start" },
    });
    await bot.handleUpdate({
      update_id: 1,
      message: { chat: { id: 900 }, from: { id: 900 }, text: "أحمد العمري" },
    });
    const handled = await bot.handleUpdate({
      update_id: 1,
      message: {
        chat: { id: 900 },
        from: { id: 900 },
        contact: { user_id: 900, phone_number: "0501234567" },
      },
    });
    expect(handled).toBe(false);
    expect(logs).toContain("bot.driver.callback_data_too_long");
  });
});

describe("مخزن الجلسات", () => {
  it("يحفظ ويقرأ ثم يمحو", async () => {
    const store = createMemorySessionStore(fixedClock(NOW));
    expect((await store.load("1")).ok && (await store.load("1")).ok).toBe(true);
    await store.save("1", {
      ...INITIAL_STATE,
      step: "awaiting_phone",
      language: "ar",
      draftName: "سالم",
      draftPhone: null,
      draftCityId: null,
      draftService: null,
      draftPickup: null,
      draftDropoff: null,
      draftSupportType: null,
    });
    const loaded = await store.load("1");
    expect(loaded.ok && loaded.value?.draftName).toBe("سالم");
    await store.clear("1");
    const cleared = await store.load("1");
    expect(cleared.ok && cleared.value).toBeNull();
  });

  it("ينسى الجلسة بعد انتهاء مهلتها", async () => {
    let now = NOW;
    const store = createMemorySessionStore({ now: () => now }, 60);
    await store.save("1", {
      ...INITIAL_STATE,
      step: "awaiting_name",
      language: "ar",
      draftName: null,
      draftPhone: null,
      draftCityId: null,
      draftService: null,
      draftPickup: null,
      draftDropoff: null,
      draftSupportType: null,
    });
    now = new Date(NOW.getTime() + 61_000);
    const loaded = await store.load("1");
    expect(loaded.ok && loaded.value).toBeNull();
    expect(store.size()).toBe(0);
  });
});

describe("تركيب التبعيات (container)", () => {
  it("يوجّه تحديث السائق إلى بوت السائق وتحديث العميل إلى بوت العميل", async () => {
    const driverSender = capturingSender();
    const riderSender = capturingSender();
    const handler = createUpdateHandler({
      driver: { deps: deps(), sender: driverSender },
      rider: {
        deps: {
          sessions: createMemorySessionStore(fixedClock(NOW)),
          riders: riderDirectory(null),
          cities: cityDirectory([JEDDAH]),
          orders: orderWriter(),
          rides: rideRequestCommand(),
          activeOrdersOf: async () => [],
          pastOrdersOf: async () => [],
          matching: {
            orders: orderRepo([]),
            offers: offerRepo([]),
            candidates: candidateRepo([]),
            settings: settingsRepo(seededRows(JEDDAH.id)),
            offerWriter: offerWriterDouble(),
            clock: fixedClock(NOW),
          },
          clock: fixedClock(NOW),
        },
        sender: riderSender,
      },
    });

    const update = { update_id: 1, message: { chat: { id: 7 }, from: { id: 7 }, text: "/start" } };
    expect(await handler.handle("driver", update)).toBe(true);
    expect(await handler.handle("rider", update)).toBe(true);

    expect(driverSender.sent[0]?.text).toBe(translate("ar", "driver.welcome"));
    expect(riderSender.sent[0]?.text).toBe(translate("ar", "rider.welcome"));
  });

  it("يرفض حمولة ليست كائناً بلا ادّعاء معالجة", async () => {
    const handler = createUpdateHandler({
      driver: { deps: deps(), sender: capturingSender() },
      rider: {
        deps: {
          sessions: createMemorySessionStore(fixedClock(NOW)),
          riders: riderDirectory(null),
          cities: cityDirectory([JEDDAH]),
          orders: orderWriter(),
          rides: rideRequestCommand(),
          activeOrdersOf: async () => [],
          pastOrdersOf: async () => [],
          matching: {
            orders: orderRepo([]),
            offers: offerRepo([]),
            candidates: candidateRepo([]),
            settings: settingsRepo(seededRows(JEDDAH.id)),
            offerWriter: offerWriterDouble(),
            clock: fixedClock(NOW),
          },
          clock: fixedClock(NOW),
        },
        sender: capturingSender(),
      },
    });
    expect(await handler.handle("driver", "نص لا كائن")).toBe(false);
  });
});
