/**
 * الغرض: إثبات أنّ محوّل بوت السائق يُعيدُ المحاولةَ عند تعارضِ مراجعةِ الجلسة
 *   (BUG-007) — لا تُرسَلُ رسالةٌ قبلَ أن تنجحَ الكتابةُ الشرطية، فيُعادُ تحميلُ
 *   الحالةِ وإعادةُ حسابِ الردود، ثم تُرسَلُ الردودُ مرّةً واحدةً لا مرّتين.
 * الحالة: اختبار فعلي — مستبدَلٌ فيه مخزنُ الجلساتِ بمزدوجٍ يرمي التعارضَ مرّةً.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import { createDriverBot } from "../../apps/gateway/src/bots/driver/index.ts";
import { createMemorySessionStore } from "../../apps/gateway/src/bots/shared/session.ts";
import { SessionCasConflictError } from "../../apps/gateway/src/bots/shared/session-revision.ts";
import type { DriverBotDependencies } from "../../packages/application/bots/driver-dialog.ts";
import type { SessionStore } from "../../packages/application/bots/types.ts";
import type { PortFailureError } from "../../packages/application/ports/index.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import { ok, type Result } from "../../packages/shared/result/index.ts";
import {
  cityDirectory,
  driverDirectory,
  JEDDAH,
  MAKKAH,
  offerDecisionPort,
  subscriptionReader,
  trialPort,
} from "../support/bot-doubles.ts";
import { fixedClock, seededRows, settingsRepo } from "../support/in-memory-ports.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const NOW = new Date("2026-08-06T12:00:00.000Z");
const CHAT = "900";

const ar = (key: string): string => translate("ar", key);

/**
 * مخزنُ جلساتٍ يرمي تعارضَ CAS مرّةً واحدةً ثم يفوّضُ الباقي للمخزنِ الحقيقيِّ —
 * يحاكي كتابةً متزامنةً وقعت بين تحميلِ الحوارِ للحالة وحفظِه إيّاها.
 */
function conflictOnceSessions(
  real: SessionStore,
): SessionStore & { readonly saveCalls: () => number } {
  let calls = 0;
  return {
    load: real.load.bind(real),
    save: async (userId, state): Promise<Result<void, PortFailureError>> => {
      calls++;
      if (calls === 1) throw new SessionCasConflictError(userId, 0);
      return real.save(userId, state);
    },
    clear: real.clear.bind(real),
    saveCalls: () => calls,
  };
}

function buildDeps(sessions: SessionStore): DriverBotDependencies {
  return {
    sessions,
    drivers: driverDirectory(null),
    cities: cityDirectory(),
    settings: settingsRepo([...seededRows(JEDDAH.id), ...seededRows(MAKKAH.id)]),
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

function startUpdate(): unknown {
  return {
    message: {
      chat: { id: Number(CHAT) },
      from: { id: Number(CHAT), language_code: "ar" },
      text: "/start",
    },
  };
}

describe("محوّل بوت السائق — إعادة محاولة CAS (BUG-007)", () => {
  it("تعارضٌ مرّةً ثم نجاح: الردودُ تُحسبُ مرّتين وتُرسَلُ مرّةً واحدة", async () => {
    const realSessions = createMemorySessionStore(fixedClock(NOW));
    const sessions = conflictOnceSessions(realSessions);
    const deps = buildDeps(sessions);

    const sent: SentMessage[] = [];
    const sender = capturing(sent);

    const logs: string[] = [];
    const bot = createDriverBot(deps, sender, (message) => logs.push(message));

    const accepted = await bot.handleUpdate(startUpdate() as never);

    // قُبلَ التحديثُ بعد إعادةِ المحاولة.
    expect(accepted).toBe(true);
    // الردودُ أُرسِلَت مرّةً واحدةً فقط — لا ازدواجٌ من المحاولةِ الفاشلة.
    expect(sent.length).toBe(2);
    expect(sent[0]?.text).toBe(ar("driver.welcome"));
    expect(sent[1]?.text).toBe(ar("driver.ask_name"));
    // سُجِّلَ تعارضُ المراجعةِ مرّةً واحدةً.
    expect(logs.some((m) => m.includes("تعارض مراجعة جلسة"))).toBe(true);
    // الحالةُ كُتبت فعلاً بعد إعادةِ المحاولة.
    const stored = await realSessions.load(CHAT);
    expect(stored.ok && stored.value?.step).toBe("awaiting_name");
  });

  it("تعارضٌ متكرّرٌ فوقَ الحدِّ يُسقطُ التحديثَ بلا إرسال", async () => {
    // مخزنٌ يرمي التعارضَ دائماً — لا نجاحَ بعدَ ثلاثِ محاولات.
    const alwaysConflict: SessionStore = {
      load: async () => ok(null),
      save: async (userId) => {
        throw new SessionCasConflictError(userId, 0);
      },
      clear: async () => ok(undefined),
    };
    const sent: SentMessage[] = [];
    const bot = createDriverBot(buildDeps(alwaysConflict), capturing(sent), () => {});

    const accepted = await bot.handleUpdate(startUpdate() as never);

    // لم يُقبَل، ولم تُرسَل أيُّ رسالةٍ — لا ازدواجٌ ولا إعلانُ نجاحٍ كاذب.
    expect(accepted).toBe(false);
    expect(sent.length).toBe(0);
  });
});
