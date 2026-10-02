/**
 * الغرض: `BOT-GRP-01` — البوتُ في القروبِ لا يُجيبُ إلا على ما وُجِّهَ إليه، وكلُّ ضغطةِ زرٍّ
 *   تُجابُ فيتوقّفُ مؤشّرُ التحميلِ.
 * الحالة: اختبار فعلي — الإرسال يُلتقط بمزدوج بدل شبكة تلغرام.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: إن أُضيفَ أمرٌ قروبيٌّ جديدٌ يمرُّ تلقائياً (يبدأُ بـ`/`).
 */
import { describe, expect, it } from "bun:test";
import { createDriverBot } from "../../apps/gateway/src/bots/driver/index.ts";
import { createMemorySessionStore } from "../../apps/gateway/src/bots/shared/session.ts";
import type { DriverBotDependencies } from "../../packages/application/bots/driver-dialog.ts";
import {
  admitUpdate,
  isGroupUpdate,
  silenceUnknownInGroup,
} from "../../packages/application/bots/group-chat.ts";
import type { IncomingUpdate } from "../../packages/application/bots/types.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import { ok } from "../../packages/shared/result/index.ts";
import {
  capturingSender,
  cityDirectory,
  driverDirectory,
  JEDDAH,
  offerDecisionPort,
  subscriptionReader,
  trialPort,
} from "../support/bot-doubles.ts";
import { fixedClock, seededRows, settingsRepo } from "../support/in-memory-ports.ts";

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

const GROUP = -1004386839352;
const USER = 8634283336;

const groupText = (text: string): IncomingUpdate => ({
  kind: "text",
  updateId: 1,
  text,
  from: { telegramUserId: String(USER), chatId: String(GROUP), languageHint: "ar" },
});

describe("القاعدةُ الخالصةُ", () => {
  it("الخاصُّ ليس قروباً ويمرُّ كلُّه", () => {
    const privateText: IncomingUpdate = {
      kind: "text",
      updateId: 1,
      text: "مرحبا",
      from: { telegramUserId: "9", chatId: "9", languageHint: "ar" },
    };
    expect(isGroupUpdate(privateText)).toBe(false);
    expect(admitUpdate(privateText)).toBe(true);
  });

  it("في القروبِ: النصُّ الحرُّ لا يمرُّ، والأمرُ يمرُّ، والزرُّ يمرُّ", () => {
    expect(admitUpdate(groupText("السلام عليكم"))).toBe(false);
    expect(admitUpdate(groupText("/answer 1234 تم"))).toBe(true);
    expect(
      admitUpdate({
        kind: "callback",
        updateId: 1,
        data: "sos:claim:x",
        from: { telegramUserId: String(USER), chatId: String(GROUP), languageHint: "ar" },
      }),
    ).toBe(true);
    expect(
      admitUpdate({
        kind: "unsupported",
        updateId: 1,
        from: { telegramUserId: String(USER), chatId: String(GROUP), languageHint: "ar" },
      }),
    ).toBe(false);
  });

  it("«لم أفهم» إلى القروبِ يُحذَفُ بكلِّ لغةٍ، وما سواه يبقى", () => {
    const update = groupText("/i");
    const kept = {
      chatId: String(USER),
      text: translate("ar", "common.unknown_command"),
      keyboard: null,
    };
    const replies = [
      { chatId: String(GROUP), text: translate("ar", "common.unknown_command"), keyboard: null },
      { chatId: String(GROUP), text: translate("en", "common.unknown_command"), keyboard: null },
      { chatId: String(GROUP), text: "تمّ الاستلام", keyboard: null },
      kept,
    ];
    expect(silenceUnknownInGroup(update, replies).map((r) => r.text)).toEqual([
      "تمّ الاستلام",
      kept.text,
    ]);
  });
});

describe("المحوّلُ", () => {
  it("رسالةٌ عاديّةٌ في القروبِ ⇒ صمتٌ واعترافٌ بالاستلام", async () => {
    const sender = capturingSender();
    const bot = createDriverBot(deps(), sender);
    const handled = await bot.handleUpdate({
      update_id: 10,
      message: {
        chat: { id: GROUP },
        from: { id: USER, language_code: "ar" },
        text: "السلام عليكم",
      },
    });
    expect(handled).toBe(true);
    expect(sender.sent).toHaveLength(0);
  });

  it("أمرٌ مجهولٌ في القروبِ ⇒ لا «لم أفهم» أمامَ الجميعِ", async () => {
    const sender = capturingSender();
    const bot = createDriverBot(deps(), sender);
    await bot.handleUpdate({
      update_id: 11,
      message: { chat: { id: GROUP }, from: { id: USER, language_code: "ar" }, text: "/i" },
    });
    expect(sender.sent.filter((m) => m.chatId === String(GROUP))).toHaveLength(0);
  });

  it("رسالةُ خدمةٍ في القروبِ (إضافةُ عضوٍ) ⇒ صمتٌ", async () => {
    const sender = capturingSender();
    const bot = createDriverBot(deps(), sender);
    await bot.handleUpdate({
      update_id: 12,
      message: { chat: { id: GROUP }, from: { id: USER, language_code: "ar" } },
    });
    expect(sender.sent).toHaveLength(0);
  });

  it("الخاصُّ لم يتغيّر: نصٌّ مجهولٌ ما زالَ يُجابُ", async () => {
    const sender = capturingSender();
    const bot = createDriverBot(deps(), sender);
    await bot.handleUpdate({
      update_id: 13,
      message: { chat: { id: 900 }, from: { id: 900, language_code: "ar" }, text: "/nonexistent" },
    });
    expect(sender.sent.length).toBeGreaterThan(0);
  });

  it("ضغطةُ زرٍّ ⇒ تُجابُ بمعرّفِها مرّةً واحدةً", async () => {
    const answered: string[] = [];
    const sender = {
      ...capturingSender(),
      answerCallbackQuery: async (id: string) => {
        answered.push(id);
      },
    };
    const bot = createDriverBot(deps(), sender);
    await bot.handleUpdate({
      update_id: 14,
      callback_query: {
        id: "cbq-1",
        data: "sos:claim:00000000-0000-0000-0000-000000000000",
        from: { id: USER, language_code: "ar" },
        message: { chat: { id: GROUP } },
      },
    });
    expect(answered).toEqual(["cbq-1"]);
  });

  it("إخفاقُ إجابةِ الزرِّ لا يُسقِطُ المعالجةَ", async () => {
    const sender = {
      ...capturingSender(),
      answerCallbackQuery: async () => {
        throw new Error("network");
      },
    };
    const bot = createDriverBot(deps(), sender);
    const handled = await bot.handleUpdate({
      update_id: 15,
      callback_query: {
        id: "cbq-2",
        data: "unknown:thing",
        from: { id: 900, language_code: "ar" },
        message: { chat: { id: 900 } },
      },
    });
    expect(handled).toBe(true);
  });
});

describe("ترقيةُ القروبِ", () => {
  it("تُسجَّلُ بالمعرّفَين ولا تُرسَلُ رسالةٌ", async () => {
    const sender = capturingSender();
    const logged: { message: string; meta: Record<string, unknown> }[] = [];
    const bot = createDriverBot(deps(), sender, (message, meta) => logged.push({ message, meta }));
    await bot.handleUpdate({
      update_id: 16,
      message: {
        chat: { id: -1004386839352 },
        from: { id: USER, language_code: "ar" },
        migrate_from_chat_id: -5474387056,
      },
    });
    expect(sender.sent).toHaveLength(0);
    expect(logged).toContainEqual({
      message: "bot.group_migrated_to_supergroup",
      meta: {
        oldChatId: "-5474387056",
        newChatId: "-1004386839352",
        action: "update cities group ids via admin_update_city_group_ids",
      },
    });
  });
});
