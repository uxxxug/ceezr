/**
 * الغرض: إثباتُ **أثرِ** عزلِ مسارِ استقبالِ الاستغاثةِ (`F8-05` · ADR-0077) لا
 *    شكلِه: أنَّ النداءَ يصلُ إلى `trigger_sos` بـ`orderId: null` وإن سقطَ دليلُ
 *    المستخدمِ، وإن غابَت بطاقةُ الرحلةِ، وإن أخفقَت `Redis` عن حالةِ الجلسةِ.
 * الحالة: اختبار فعلي — 2026-09-10 · البند `F8-05`.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 *
 * ## ما يُثبِتُه هذا الملفُّ وما لا يُثبِتُه
 *
 * يُثبِتُ أنَّ **الحِملَ يخرجُ** من الحوارِ صحيحاً في كلِّ صورةِ عطبٍ كانت تُسقِطُ
 * النداءَ. وأمّا أنَّ الطلبَ يُحَلُّ صحيحاً في القاعدةِ تحتَ القفلِ — أحدثَ طلبٍ
 * حيٍّ للمُبلِّغِ، وللسائقِ ما هوَ مُسنَدٌ إليه دونَ `searching` — فيُثبِتُه
 * `tests/integration/safety-sos.test.ts` على PostgreSQL حقيقيٍّ. **ولا يُدَّعى
 * ههنا شيءٌ عن القاعدةِ.**
 *
 * وحاجزُ `scripts/check-sos-intake-isolation.ts` يفرضُ الشكلَ نصّاً؛ وهذا الملفُّ
 * يقيسُ الأثرَ. فالشكلُ بلا أثرٍ ادّعاءٌ، والأثرُ بلا شكلٍ يعودُ صامتاً.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { createMemorySessionStore } from "../../apps/gateway/src/bots/shared/session.ts";
import {
  type DriverBotDependencies,
  handleDriverUpdate,
} from "../../packages/application/bots/driver-dialog.ts";
import {
  handleRiderUpdate,
  type RiderBotDependencies,
} from "../../packages/application/bots/rider-dialog.ts";
import type { IncomingUpdate, Sender } from "../../packages/application/bots/types.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type { TriggerSosInput } from "../../packages/application/safety/trigger-sos.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";
import {
  cityDirectory,
  driverDirectory,
  JEDDAH,
  offerDecisionPort,
  offerWriterDouble,
  orderWriter,
  rideRequestCommand,
  riderDirectory,
  subscriptionReader,
  trialPort,
  verifiedDriver,
} from "../support/bot-doubles.ts";
import {
  candidateRepo,
  fixedClock,
  offerRepo,
  orderRepo,
  seededRows,
  settingsRepo,
} from "../support/in-memory-ports.ts";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const SENDER: Sender = { telegramUserId: "900", chatId: "900", languageHint: "ar" };
const ar = (key: string) => translate("ar", key);

function text(value: string): IncomingUpdate {
  return { kind: "text", from: SENDER, updateId: 1, text: value };
}
function callback(data: string): IncomingUpdate {
  return { kind: "callback", from: SENDER, updateId: 1, data };
}

/** يُسجِّلُ ما وصلَ إلى الدالّةِ الذرّيّةِ، ويُعيدُ الحكمَ المطلوبَ. */
function safetyPort(outcome: {
  incidentId: string | null;
  error: string | null;
  created?: boolean;
}) {
  const seen: TriggerSosInput[] = [];
  return {
    seen,
    dep: {
      trigger: {
        incidents: {
          trigger: async (input: TriggerSosInput) => {
            seen.push(input);
            return ok(
              outcome.incidentId === null
                ? { incidentId: null, error: outcome.error ?? "UNKNOWN" }
                : {
                    incidentId: outcome.incidentId,
                    created: outcome.created ?? outcome.error === null,
                  },
            );
          },
        },
      },
      /**
       * قراراتُ فريقِ الإسنادِ ليسَت مِن مسارِ الاستقبالِ. والرَّمْيُ ههنا حكمٌ:
       * إن نادَتْها ضغطةُ `/sos` يوماً سقطَ الاختبارُ بدلَ أن يمرَّ صامتاً.
       */
      resolutions: {
        incidents: {
          claim: async () => {
            throw new Error("لا يجوزُ أن يُنادى منفذُ القراراتِ في مسارِ الاستقبالِ");
          },
          resolve: async () => {
            throw new Error("لا يجوزُ أن يُنادى منفذُ القراراتِ في مسارِ الاستقبالِ");
          },
        },
      },
    },
  };
}

/** منفذٌ يُخفِقُ إخفاقاً تقنيّاً — كما يفعلُ انقطاعُ القاعدةِ لا رفضُ الحكمِ. */
function brokenSafetyPort() {
  return {
    ...safetyPort({ incidentId: null, error: null }).dep,
    trigger: {
      incidents: {
        trigger: async () => err(new PortFailureError("rpc.trigger_sos", "network")),
      },
    },
  };
}

/** دليلٌ مقطوعٌ: كلُّ قراءةٍ إخفاقٌ تقنيٌّ. وهوَ العطبُ الذي كانَ يُسقِطُ النداءَ. */
const BROKEN_READ = async () => err(new PortFailureError("directory.findByTelegramId", "network"));

// ==========================================================================
// السائقُ
// ==========================================================================

describe("عزلُ استقبالِ الاستغاثةِ — أمرُ السائقِ", () => {
  let deps: DriverBotDependencies;

  beforeEach(() => {
    deps = {
      sessions: createMemorySessionStore(fixedClock(NOW)),
      drivers: driverDirectory(verifiedDriver()),
      cities: cityDirectory(),
      settings: settingsRepo(seededRows(JEDDAH.id)),
      subscriptions: subscriptionReader(null),
      trial: trialPort(true),
      dispatch: { claimRide: async () => err(new PortFailureError("dispatch.claimRide", "n/a")) },
      offers: offerDecisionPort(),
      clock: fixedClock(NOW),
    };
  });

  it("يُنادي الدالّةَ بـ`orderId: null` ودورِ السائقِ ومُعرِّفِ تلغرام", async () => {
    const safety = safetyPort({ incidentId: "incident-1", error: null });
    const replies = await handleDriverUpdate(text("/sos"), { ...deps, safety: safety.dep });
    expect(safety.seen).toEqual([
      { orderId: null, actorTelegramId: SENDER.telegramUserId, reporterRole: "driver" },
    ]);
    expect(replies[0]?.text).toBe(ar("safety.sent"));
  });

  /** العطبُ الأصليُّ: قراءةُ الدليلِ فوقَ المُوزِّعِ كانت تردُّ «حدثَ عطلٌ». */
  it("يصلُ النداءُ وإن كانَ دليلُ السائقينَ مقطوعاً بالكاملِ", async () => {
    const safety = safetyPort({ incidentId: "incident-1", error: null });
    const drivers = { ...driverDirectory(verifiedDriver()), findByTelegramId: BROKEN_READ };
    const replies = await handleDriverUpdate(text("/sos"), {
      ...deps,
      drivers,
      safety: safety.dep,
    });
    expect(safety.seen).toHaveLength(1);
    expect(replies[0]?.text).toBe(ar("safety.sent"));
    expect(replies[0]?.text).not.toBe(ar("common.error_try_again"));
  });

  /** والعطبُ الثاني: غيابُ بطاقةِ الرحلةِ كانَ يردُّ «لم أفهم هذه الرسالةَ». */
  it("يصلُ النداءُ بلا منفذِ بطاقةِ الرحلةِ أصلاً", async () => {
    const safety = safetyPort({ incidentId: "incident-1", error: null });
    // الحذفُ لا التّصفيرُ: `exactOptionalPropertyTypes` يمنعُ `undefined` صريحاً،
    // والمقصودُ منفذٌ غيرُ مربوطٍ أصلاً لا منفذٌ مربوطٌ بلا شيءٍ.
    const { tripCards: _unbound, ...withoutTripCards } = deps;
    const replies = await handleDriverUpdate(text("/sos"), {
      ...withoutTripCards,
      safety: safety.dep,
    });
    expect(safety.seen).toHaveLength(1);
    expect(replies[0]?.text).not.toBe(ar("common.unknown_command"));
  });

  it("سائقٌ غيرُ مسجَّلٍ لا يُمنَعُ في الحوارِ: الحكمُ للدالّةِ لا للبوتِ", async () => {
    const safety = safetyPort({ incidentId: null, error: "ACTOR_NOT_FOUND" });
    const drivers = driverDirectory(null);
    const replies = await handleDriverUpdate(text("/sos"), {
      ...deps,
      drivers,
      safety: safety.dep,
    });
    expect(safety.seen).toHaveLength(1);
    expect(replies[0]?.text).toBe(ar("common.error_try_again"));
  });

  it("`NO_ACTIVE_ORDER` يُترجَمُ «لا رحلةَ قائمةً» لا «حدثَ عطلٌ»", async () => {
    const safety = safetyPort({ incidentId: null, error: "NO_ACTIVE_ORDER" });
    const replies = await handleDriverUpdate(text("/sos"), { ...deps, safety: safety.dep });
    expect(replies[0]?.text).toBe(ar("safety.no_active_order"));
  });

  it("إخفاقٌ تقنيٌّ في الدالّةِ يُقالُ عطلاً — لا «لا رحلةَ قائمةً»", async () => {
    const replies = await handleDriverUpdate(text("/sos"), {
      ...deps,
      safety: brokenSafetyPort(),
    });
    expect(replies[0]?.text).toBe(ar("common.error_try_again"));
    expect(replies[0]?.text).not.toBe(ar("safety.no_active_order"));
  });

  it("تكرارُ النداءِ في النافذةِ يُقالُ «أُرسِلَت» لا يُخفِقُ", async () => {
    const safety = safetyPort({ incidentId: "incident-1", error: null, created: false });
    const replies = await handleDriverUpdate(text("/sos"), { ...deps, safety: safety.dep });
    expect(replies[0]?.text).toBe(ar("safety.already_sent"));
  });

  it("بلا تبعيّةِ سلامةٍ مربوطةٍ: الأمرُ غيرُ مفهومٍ — ولا يُدَّعى إرسالٌ", async () => {
    const replies = await handleDriverUpdate(text("/sos"), deps);
    expect(replies[0]?.text).toBe(ar("common.unknown_command"));
    expect(replies[0]?.text).not.toBe(ar("safety.sent"));
  });

  /**
   * `loadState` يفتحُ على `INITIAL_STATE` عندَ إخفاقِ المخزنِ. **يُقاسُ لا يُدَّعى**:
   * انقطاعُ `Redis` لا يجوزُ أن يُسقِطَ استغاثةً، والفرقُ الوحيدُ لغةُ الردِّ.
   */
  it("يصلُ النداءُ وإن أخفقَ مخزنُ الجلساتِ (انقطاعُ Redis)", async () => {
    const safety = safetyPort({ incidentId: "incident-1", error: null });
    const sessions = {
      load: async () => err(new PortFailureError("session.load", "network")),
      save: async () => err(new PortFailureError("session.save", "network")),
      clear: async () => err(new PortFailureError("session.clear", "network")),
    };
    const replies = await handleDriverUpdate(text("/sos"), {
      ...deps,
      sessions,
      safety: safety.dep,
    });
    expect(safety.seen).toHaveLength(1);
    expect(replies[0]?.text).toBe(ar("safety.sent"));
  });
});

// ==========================================================================
// الراكبُ
// ==========================================================================

describe("عزلُ استقبالِ الاستغاثةِ — أمرُ الراكبِ وزرُّه", () => {
  let deps: RiderBotDependencies;

  beforeEach(() => {
    deps = {
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
    };
  });

  it("الأمرُ يُنادي الدالّةَ بـ`orderId: null` ودورِ الراكبِ", async () => {
    const safety = safetyPort({ incidentId: "incident-1", error: null });
    const replies = await handleRiderUpdate(text("/sos"), { ...deps, safety: safety.dep });
    expect(safety.seen).toEqual([
      { orderId: null, actorTelegramId: SENDER.telegramUserId, reporterRole: "rider" },
    ]);
    expect(replies[0]?.text).toBe(ar("safety.sent"));
  });

  it("لا قائمةَ اختيارٍ ولا ضغطةً ثانيةً: الأمرُ نفسُه يُرسِلُ", async () => {
    const safety = safetyPort({ incidentId: "incident-1", error: null });
    const replies = await handleRiderUpdate(text("/sos"), { ...deps, safety: safety.dep });
    expect(replies[0]?.text).not.toBe(ar("safety.choose_order"));
    expect(safety.seen).toHaveLength(1);
  });

  it("يصلُ النداءُ وإن كانَ دليلُ العملاءِ مقطوعاً", async () => {
    const safety = safetyPort({ incidentId: "incident-1", error: null });
    const riders = { ...riderDirectory(null), findByTelegramId: BROKEN_READ };
    const replies = await handleRiderUpdate(text("/sos"), {
      ...deps,
      riders,
      safety: safety.dep,
    });
    expect(safety.seen).toHaveLength(1);
    expect(replies[0]?.text).toBe(ar("safety.sent"));
  });

  it("يصلُ النداءُ وإن كانَ منفذُ الطلباتِ النشطةِ يرمي", async () => {
    const safety = safetyPort({ incidentId: "incident-1", error: null });
    const replies = await handleRiderUpdate(text("/sos"), {
      ...deps,
      activeOrdersOf: async () => {
        throw new Error("لا يجوزُ أن يُنادى هذا المنفذُ في مسارِ الاستغاثةِ");
      },
      safety: safety.dep,
    });
    expect(safety.seen).toHaveLength(1);
    expect(replies[0]?.text).toBe(ar("safety.sent"));
  });

  /**
   * زرٌّ أُرسِلَ قبلَ الإصلاحِ يحملُ مُعرِّفاً في بياناتِه، وقد يشيرُ إلى رحلةٍ
   * انتهَت. فالزرُّ **لا يُكسَرُ**، والمُعرِّفُ **لا يُقرأُ**.
   */
  it("زرٌّ قديمٌ يحملُ مُعرِّفَ رحلةٍ انتهَت: يعملُ ولا يُمرَّرُ مُعرِّفُه", async () => {
    const safety = safetyPort({ incidentId: "incident-1", error: null });
    const replies = await handleRiderUpdate(callback("sos:trigger:order-of-yesterday"), {
      ...deps,
      safety: safety.dep,
    });
    expect(safety.seen).toEqual([
      { orderId: null, actorTelegramId: SENDER.telegramUserId, reporterRole: "rider" },
    ]);
    expect(replies[0]?.text).toBe(ar("safety.sent"));
  });

  it("زرٌّ لا يقولُ `trigger` ليسَ استغاثةً ولا يُنادي الدالّةَ", async () => {
    const safety = safetyPort({ incidentId: "incident-1", error: null });
    const replies = await handleRiderUpdate(callback("sos:claim:incident-1"), {
      ...deps,
      safety: safety.dep,
    });
    expect(safety.seen).toHaveLength(0);
    expect(replies[0]?.text).toBe(ar("common.unknown_command"));
  });

  it("`NO_ACTIVE_ORDER` من الزرِّ يُترجَمُ «لا رحلةَ قائمةً»", async () => {
    const safety = safetyPort({ incidentId: null, error: "NO_ACTIVE_ORDER" });
    const replies = await handleRiderUpdate(callback("sos:trigger"), {
      ...deps,
      safety: safety.dep,
    });
    expect(replies[0]?.text).toBe(ar("safety.no_active_order"));
  });

  it("عميلٌ غيرُ مسجَّلٍ: الحكمُ للدالّةِ لا للبوتِ", async () => {
    const safety = safetyPort({ incidentId: null, error: "ACTOR_NOT_FOUND" });
    const replies = await handleRiderUpdate(text("/sos"), { ...deps, safety: safety.dep });
    expect(safety.seen).toHaveLength(1);
    expect(replies[0]?.text).toBe(ar("common.error_try_again"));
    expect(replies[0]?.text).not.toBe(ar("rider.must_register_first"));
  });

  it("يصلُ النداءُ وإن أخفقَ مخزنُ الجلساتِ (انقطاعُ Redis)", async () => {
    const safety = safetyPort({ incidentId: "incident-1", error: null });
    const sessions = {
      load: async () => err(new PortFailureError("session.load", "network")),
      save: async () => err(new PortFailureError("session.save", "network")),
      clear: async () => err(new PortFailureError("session.clear", "network")),
    };
    const replies = await handleRiderUpdate(text("/sos"), {
      ...deps,
      sessions,
      safety: safety.dep,
    });
    expect(safety.seen).toHaveLength(1);
    expect(replies[0]?.text).toBe(ar("safety.sent"));
  });
});
