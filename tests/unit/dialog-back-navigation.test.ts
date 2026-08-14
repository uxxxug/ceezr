/**
 * الغرض: إثبات أن الرجوع من اختيار الخدمة إلى اختيار المدينة يعمل، ولا يمسح
 *   ما أدخله المستخدم قبله. قبل هذا التغيير كان تصحيح مدينة خاطئة يعني
 *   /cancel وإعادة الاسم والرقم من الصفر.
 * الحالة: منفّذ فعلياً — القسم 2 من الأمر الشامل.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { createMemorySessionStore } from "../../apps/gateway/src/bots/shared/session.ts";
import type { DriverBotDependencies } from "../../packages/application/bots/driver-dialog.ts";
import { handleDriverUpdate } from "../../packages/application/bots/driver-dialog.ts";
import type { IncomingUpdate, Sender } from "../../packages/application/bots/types.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
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
} from "../support/bot-doubles.ts";
import { fixedClock, seededRows, settingsRepo } from "../support/in-memory-ports.ts";

const NOW = new Date("2026-08-06T12:00:00.000Z");
const SENDER: Sender = { telegramUserId: "900", chatId: "900", languageHint: "ar" };

const ar = (key: string) => translate("ar", key, {});

const text = (value: string): IncomingUpdate => ({ kind: "text", from: SENDER, text: value });
const callback = (data: string): IncomingUpdate => ({ kind: "callback", from: SENDER, data });
const contact = (phone: string): IncomingUpdate => ({
  kind: "contact",
  from: SENDER,
  phone,
  ownerTelegramId: SENDER.telegramUserId,
});

describe("الرجوع من اختيار الخدمة إلى اختيار المدينة", () => {
  let drivers: DriverDirectoryDouble;
  let deps: DriverBotDependencies;

  beforeEach(() => {
    drivers = driverDirectory(null);
    deps = {
      sessions: createMemorySessionStore(fixedClock(NOW)),
      drivers,
      cities: cityDirectory(),
      settings: settingsRepo([...seededRows(JEDDAH.id), ...seededRows(MAKKAH.id)]),
      subscriptions: subscriptionReader(null),
      trial: trialPort(true),
      dispatch: {
        claimRide: async () =>
          ok({
            claimed: true,
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
  });

  async function reachServiceStep(): Promise<void> {
    await handleDriverUpdate(text("/start"), deps);
    await handleDriverUpdate(text("أحمد العمري"), deps);
    await handleDriverUpdate(contact("0501234567"), deps);
    await handleDriverUpdate(callback(`city:${JEDDAH.id}`), deps);
  }

  it("زرّ الرجوع معروض فعلاً مع خيارات الخدمة", async () => {
    await handleDriverUpdate(text("/start"), deps);
    await handleDriverUpdate(text("أحمد العمري"), deps);
    await handleDriverUpdate(contact("0501234567"), deps);
    const replies = await handleDriverUpdate(callback(`city:${JEDDAH.id}`), deps);
    const keyboard = replies[0]?.keyboard;
    expect(keyboard?.kind).toBe("inline");
    if (keyboard?.kind === "inline") {
      const labels = keyboard.rows.flat().map((button) => button.label);
      expect(labels).toContain(ar("common.back_button"));
    }
  });

  it("الرجوع يعيد سؤال المدينة", async () => {
    await reachServiceStep();
    const back = await handleDriverUpdate(callback("back:city"), deps);
    expect(back[0]?.text).toBe(ar("driver.ask_city"));
  });

  it("الرجوع لا يمسح الاسم ولا الرقم — لا يُعاد سؤالهما", async () => {
    await reachServiceStep();
    await handleDriverUpdate(callback("back:city"), deps);
    // اختيار مدينة أخرى يقود مباشرةً إلى الخدمة، لا إلى الاسم
    const afterCity = await handleDriverUpdate(callback(`city:${MAKKAH.id}`), deps);
    expect(afterCity[0]?.text).toBe(ar("driver.ask_service"));
    expect(afterCity[0]?.text).not.toBe(ar("driver.ask_name"));
  });

  it("المدينة المصحَّحة هي التي تُسجَّل فعلاً، لا الأولى", async () => {
    await reachServiceStep();
    await handleDriverUpdate(callback("back:city"), deps);
    await handleDriverUpdate(callback(`city:${MAKKAH.id}`), deps);
    await handleDriverUpdate(callback("service:transport"), deps);
    await handleDriverUpdate(callback("vehicle:sedan"), deps);
    await handleDriverUpdate(text("أ ب ج 1234"), deps);
    await handleDriverUpdate(text("1012345678"), deps);
    await handleDriverUpdate(
      { kind: "photo", from: SENDER, fileId: "vphoto_900", caption: null },
      deps,
    );
    expect(drivers.registrations[0]?.cityId).toBe(MAKKAH.id);
    expect(drivers.registrations[0]?.phone).toBe("+966501234567");
  });

  it("الرجوع خارج خطوته لا يفعل شيئاً غامضاً", async () => {
    await handleDriverUpdate(text("/start"), deps);
    const stray = await handleDriverUpdate(callback("back:city"), deps);
    expect(stray[0]?.text).toBe(ar("common.unknown_command"));
  });

  it("هدف رجوع غير معروف يُرفض بدل أن يُخمَّن", async () => {
    await reachServiceStep();
    const bogus = await handleDriverUpdate(callback("back:nowhere"), deps);
    expect(bogus[0]?.text).toBe(ar("common.unknown_command"));
  });
});
