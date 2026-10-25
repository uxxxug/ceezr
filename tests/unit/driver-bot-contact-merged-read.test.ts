/**
 * الغرض: LOAD-01 · C2 — إثبات عقدِ الدمجِ في مسارِ contact لمحوّلِ بوتِ السائق:
 *   قراءةٌ مدمجةٌ واحدةٌ (لغة + سائق) في موضعِ الترطيبِ، تُستهلِكُها أولُ قراءةٍ عن
 *   المرسلِ في الحوار، وتُعادُ قراءتُها عند **كلِّ** محاولةِ CAS (BUG-007) — فلا لقطةً
 *   أقدمَ من موضعِ الترطيبِ مهما تكرّرتِ المحاولات، وفشلُها يُرجِعُ المسارَ كاملًا
 *   إلى القراءتينِ المنفصلتينِ كما كانا. وبقيةُ أنواعِ التحديثِ لم تُمسّ.
 * الحالة: اختبار فعلي — بند LOAD-01 (C2).
 * ينتمي إلى: tests/unit
 * ملاحظات مستقبلية: توسيعُ الدمجِ إلى أنواعٍ أخرى قرارٌ يُتَّخَذُ بقياسٍ لا بتعميمِ هذا الاختبار.
 */
import { describe, expect, it } from "bun:test";
import { createDriverBot } from "../../apps/gateway/src/bots/driver/index.ts";
import { createLanguageHydration } from "../../apps/gateway/src/bots/shared/language-middleware.ts";
import { createMemorySessionStore } from "../../apps/gateway/src/bots/shared/session.ts";
import { SessionCasConflictError } from "../../apps/gateway/src/bots/shared/session-revision.ts";
import type { DriverBotDependencies } from "../../packages/application/bots/driver-dialog.ts";
import type {
  DriverProfile,
  DriverSenderContext,
  SessionStore,
} from "../../packages/application/bots/types.ts";
import { INITIAL_STATE } from "../../packages/application/bots/types.ts";
import type { LanguagePreferencePort } from "../../packages/application/i18n-translation/select-language.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type { SupportedLanguage } from "../../packages/domain/i18n-translation/index.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import { err, ok, type Result } from "../../packages/shared/result/index.ts";
import {
  cityDirectory,
  driverDirectory,
  JEDDAH,
  MAKKAH,
  offerDecisionPort,
  subscriptionReader,
  trialPort,
  verifiedDriver,
} from "../support/bot-doubles.ts";
import { fixedClock, seededRows, settingsRepo } from "../support/in-memory-ports.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const NOW = new Date("2026-10-25T12:00:00.000Z");
const CHAT = "900";

/**
 * مزدوجُ دليلِ السائقينَ مع القراءةِ المدمجةِ: يعدُّ نداءاتِ `findSenderContext`
 * و`findByTelegramId` الأصليّ، ويسمحُ بتغييرِ القيمةِ بينَ النداءاتِ (لمحاكاةِ كتابةٍ
 * متزامنةٍ للغةٍ بينَ محاولتَي CAS).
 */
function mergedDirectory(
  contextAt: (call: number) => Result<DriverSenderContext | null, PortFailureError>,
) {
  let contextCalls = 0;
  let lookups = 0;
  const drivers = driverDirectory(null);
  const underlying = drivers.findByTelegramId.bind(drivers);
  return {
    drivers: {
      ...drivers,
      findSenderContext: async (): Promise<
        Result<DriverSenderContext | null, PortFailureError>
      > => {
        contextCalls += 1;
        return contextAt(contextCalls);
      },
      findByTelegramId: async (
        telegramUserId: string,
      ): Promise<Result<DriverProfile | null, PortFailureError>> => {
        lookups += 1;
        return underlying(telegramUserId);
      },
    },
    contextCalls: () => contextCalls,
    lookups: () => lookups,
  };
}

/** منفذُ تفضيلاتٍ يعدُّ نداءاتِ `getLanguage` — يجب أن تبقى صفراً في مسارِ الدمجِ. */
function countingPreferences() {
  let reads = 0;
  const port: LanguagePreferencePort = {
    getLanguage: async (): Promise<Result<SupportedLanguage | null, never>> => {
      reads += 1;
      return ok("ar");
    },
    setLanguage: async () => ok({ changed: true, language: "ar", previous: "ar" }),
  };
  return { port, reads: () => reads };
}

function buildDeps(
  sessions: SessionStore,
  drivers: DriverBotDependencies["drivers"],
): DriverBotDependencies {
  return {
    sessions,
    drivers,
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

function contactUpdate(): unknown {
  return {
    update_id: 7,
    message: {
      chat: { id: Number(CHAT) },
      from: { id: Number(CHAT), language_code: "ar" },
      contact: { phone_number: "+966501234567", first_name: "سائق", user_id: Number(CHAT) },
    },
  };
}

function startUpdate(): unknown {
  return {
    update_id: 1,
    message: {
      chat: { id: Number(CHAT) },
      from: { id: Number(CHAT), language_code: "ar" },
      text: "/start",
    },
  };
}

describe("محوّل بوت السائق — القراءة المدمجة لمسار contact (LOAD-01 · C2)", () => {
  it("قراءة مدمجة واحدة: الترطيب بها وأول قراءة للحوار تستهلكها — لا نداءين منفصلين", async () => {
    const sessions = createMemorySessionStore(fixedClock(NOW));
    const merged = mergedDirectory(() => ok({ language: "ur", driver: null }));
    const prefs = countingPreferences();
    const bot = createDriverBot(
      buildDeps(sessions, merged.drivers),
      capturing([]),
      () => {},
      createLanguageHydration({ preferences: prefs.port, sessions }),
    );

    const accepted = await bot.handleUpdate(contactUpdate() as never);

    expect(accepted).toBe(true);
    // القراءةُ المدمجةُ نُوديت مرةً واحدةً في موضعِ الترطيب.
    expect(merged.contextCalls()).toBe(1);
    // لا `get_user_language` منفصلًا ولا `findByTelegramId` حيًّا — الاستهلاكُ الأحاديُّ كافى.
    expect(prefs.reads()).toBe(0);
    expect(merged.lookups()).toBe(0);
    // الجلسةُ رُطِّبت بلغةِ القراءةِ المدمجةِ (أردية)، وردُّ الحوارِ بها لا بتخمينِ تلغرام.
    const state = await sessions.load(CHAT);
    expect(state.ok && state.value?.language).toBe("ur");
  });

  it("سائق مسجّل من القراءة المدمجة يُستهلك كأنه قراءة حية — عقد recordMiniAppPhoneProof نفسه", async () => {
    const sessions = createMemorySessionStore(fixedClock(NOW));
    const profile = verifiedDriver({ telegramUserId: CHAT });
    const merged = mergedDirectory(() => ok({ language: "ar", driver: profile }));
    const bot = createDriverBot(buildDeps(sessions, merged.drivers), capturing([]), () => {});

    const sent: SentMessage[] = [];
    const accepted = await bot.handleUpdate(contactUpdate() as never);

    // المسجَّلُ سلفاً يُخبَرُ أنَّ هذا أمرٌ لا يعرفه البوتُ — نفسُ حكمِ القراءةِ الحيةِ.
    expect(accepted).toBe(true);
    expect(merged.lookups()).toBe(0);
    const state = await sessions.load(CHAT);
    expect(state.ok && state.value).toBeNull();
    void sent;
  });

  it("تعارض CAS يُعيدُ قراءة القيمة المدمجة في المحاولة التالية — لا لقطة قديمة (الاختبار التفاضلي للقِدم)", async () => {
    const realSessions = createMemorySessionStore(fixedClock(NOW));
    // تعارضٌ واحدٌ عند أول حفظٍ — كالاختبارِ الأصليِّ لـBUG-007.
    let saveCalls = 0;
    const conflictOnce: SessionStore = {
      load: realSessions.load.bind(realSessions),
      save: async (userId, state) => {
        saveCalls += 1;
        if (saveCalls === 1) throw new SessionCasConflictError(userId, 0);
        return realSessions.save(userId, state);
      },
      clear: realSessions.clear.bind(realSessions),
    };
    // اللغةُ تتغيّرُ **بينَ المحاولتينِ** (كتابةٌ متزامنةٌ من أيِّ كاتبٍ — bot أو HTTP):
    // المحاولةُ الأولى تقرأُ أرديةً، ثمَّ يكتبُ المتزامنُ إنجليزيةً، فالمحاولةُ الثانيةُ
    // يجبُ أن تقرأَ الجديدةَ — وهذا ما كانَ يُفشِلُ دمجَ اللغةِ في الالتقاطِ (لقطةٌ أقدمُ
    // من موضعِ الترطيبِ)، ويثبتُ هنا أنَّ الدمجَ في موضعِ الترطيبِ نفسِهِ سليم.
    const values: ("ur" | "en")[] = ["ur", "en"];
    const merged = mergedDirectory((call) =>
      ok({ language: values[call - 1] ?? "en", driver: null }),
    );
    const prefs = countingPreferences();
    const bot = createDriverBot(
      buildDeps(conflictOnce, merged.drivers),
      capturing([]),
      () => {},
      createLanguageHydration({ preferences: prefs.port, sessions: conflictOnce }),
    );

    const accepted = await bot.handleUpdate(contactUpdate() as never);

    expect(accepted).toBe(true);
    // قُرئتِ القيمةُ المدمجةُ عند كلِّ محاولةٍ — مرتينِ لا مرةً واحدةً مُجمَّدة.
    expect(merged.contextCalls()).toBe(2);
    expect(prefs.reads()).toBe(0);
    // الجلسةُ النهائيةُ باللغةِ **الجديدة** — القيمةُ المقرؤةُ في موضعِ الترطيبِ، لا لقطةً.
    const state = await realSessions.load(CHAT);
    expect(state.ok && state.value?.language).toBe("en");
  });

  it("تداخلُ تسجيلٍ متزامنٍ بين القراءةِ المدمجةِ واستهلاكِها: البوّابةُ استشاريّةٌ والنتيجةُ حالةٌ يصلُ إليها المسارُ القديمُ كذلك", async () => {
    /**
     * السباقُ المُحاكى: القراءةُ المدمجةُ (موضعُ الترطيبِ) رأتْ مرسلًا بلا صفِّ سائقٍ
     * (`driver = null`)، ثمَّ أكملَ `POST /v1/onboarding/driver` تسجيلَه — الكاتبُ الوحيدُ
     * غيرِ المتسلسلِ معَ طابورِ البوتِ على وجودِ السائق — ثمَّ استهلكَ الحوارُ اللقطةَ.
     * مسارُ contact لا يستهلكُ من ملفِّ السائقِ سوى **وجودِهِ** (`recordMiniAppPhoneProof`:
     * `existing.value !== null`؟)، ولا يستهلكُ `handlePhone` (طورُ awaiting_phone) شيئًا منهُ أصلًا.
     *
     * **لماذا هذه حالةٌ يصلُ إليها المسارُ القديمُ كذلك:** بوّابةُ الوجودِ استشاريّةٌ
     * وتوقيتيّةٌ بطبيعتِها — القراءةُ الحيّةُ في المسارِ القديمِ تجري عند الاستهلاكِ، فإن
     * أكملَ التسجيلُ **بعدَها وقبلَ حفظِ الجلسةِ** أخذَ الحوارُ الفرعَ نفسَهُ الذي يأخذُهُ هنا.
     * الدمجُ لا يُنشئُ حالةً جديدةً؛ يحرّكُ حدودِ السباقِ مبكرًا بمقدارِ نافذةِ الترطيبِ
     * (عمليتا Redis: hydrate ثمَّ loadState) فحسب. ولما لم يكن في المستودعِ مسارٌ يحذفُ صفَّ
     * `drivers`، فاللقطةُ لا تُقدمُ إلا نحوَ null — لا يمكنٌ لسائقٍ حُذف أن يُحكَمَ موجودًا.
     * والقراءةُ تُعادُ عندَ كلِّ محاولةِ CAS (الاختبارُ السابقُ) فالنافذةُ لا تتّسعُ بالمحاولاتِ.
     */
    const sessions = createMemorySessionStore(fixedClock(NOW));
    const profile = verifiedDriver({ telegramUserId: CHAT });
    // القراءةُ الحيّةُ لو نُوديت لرأتْ سائقًا — التسجيلُ أكملَ بينَ القراءةِ المدمجةِ والاستهلاكِ.
    const live = driverDirectory(profile);
    let contextCalls = 0;
    let liveLookups = 0;
    const underlying = live.findByTelegramId.bind(live);
    const drivers = {
      ...live,
      findSenderContext: async (): Promise<
        Result<DriverSenderContext | null, PortFailureError>
      > => {
        contextCalls += 1;
        return ok({ language: "ar", driver: null });
      },
      findByTelegramId: async (
        telegramUserId: string,
      ): Promise<Result<DriverProfile | null, PortFailureError>> => {
        liveLookups += 1;
        return underlying(telegramUserId);
      },
    };
    const sent: SentMessage[] = [];
    const bot = createDriverBot(buildDeps(sessions, drivers), capturing(sent), () => {});

    const accepted = await bot.handleUpdate(contactUpdate() as never);

    expect(accepted).toBe(true);
    expect(contextCalls).toBe(1);
    // الاستهلاكُ الأحاديّ: الحوارُ حكَمَ باللقطةِ (null) ولم يقرأْ حيًّا بعدَها.
    expect(liveLookups).toBe(0);
    // الفرعُ المأخوذُ هو فرعُ غيرِ المسجّلِ نفسَهُ الذي يأخذُهُ المسارُ القديمُ حينَ يُكملُ
    // التسجيلُ بعدَ قراءتِهِ الحيّة: الرقمُ قُبِلَ وحُفِظَ في الجلسةِ (draftPhone) ورُدَّ بنصِّ
    // الاستلامِ — لا حالةً جديدةً ولا عطلًا.
    expect(sent.length).toBe(1);
    const state = await sessions.load(CHAT);
    expect(state.ok && state.value?.draftPhone).toBe("+966501234567");
    expect(sent[0]?.text).toContain("استلمنا رقم");
  });

  it("فشل القراءة المدمجة يُرجِع المسار كاملاً إلى القراءتين المنفصلتين كما كانا", async () => {
    const sessions = createMemorySessionStore(fixedClock(NOW));
    const merged = mergedDirectory(() =>
      err(new PortFailureError("drivers.findSenderContext", "القاعدة لا تستجيب")),
    );
    const prefs = countingPreferences();
    const bot = createDriverBot(
      buildDeps(sessions, merged.drivers),
      capturing([]),
      () => {},
      createLanguageHydration({ preferences: prefs.port, sessions }),
    );

    const accepted = await bot.handleUpdate(contactUpdate() as never);

    // الحوارُ لم يسقط: الترطيبُ عادَ إلى `getLanguage` والقراءةُ الحيّةُ عادت إلى الحوار.
    expect(accepted).toBe(true);
    expect(prefs.reads()).toBe(1);
    expect(merged.lookups()).toBe(1);
  });

  it("مستخدم غائب (سياق null): لا ترطيب ولا قراءة حيّة — عقد القيمة الفارغة نفسه", async () => {
    const sessions = createMemorySessionStore(fixedClock(NOW));
    const merged = mergedDirectory(() => ok(null));
    const prefs = countingPreferences();
    const bot = createDriverBot(
      buildDeps(sessions, merged.drivers),
      capturing([]),
      () => {},
      createLanguageHydration({ preferences: prefs.port, sessions }),
    );

    const accepted = await bot.handleUpdate(contactUpdate() as never);

    expect(accepted).toBe(true);
    expect(merged.contextCalls()).toBe(1);
    expect(prefs.reads()).toBe(0);
    expect(merged.lookups()).toBe(0);
    // الجلسةُ كتبها الحوارُ نفسُه (draftPhone من بطاقةِ الهاتف) لا الترطيبُ: اللغةُ
    // بقيتِ الابتدائيةَ الافتراضيةَ — الترطيبُ لم يكتب شيئاً لعدمِ وجودِ تفضيلٍ أصلًا.
    const state = await sessions.load(CHAT);
    expect(state.ok && state.value?.language).toBe(INITIAL_STATE.language);
    expect(state.ok && state.value?.draftPhone).toBe("+966501234567");
  });

  it("غير contact (مثل /start) لم يُمسّ: المساران المنفصلان كما كانا", async () => {
    const sessions = createMemorySessionStore(fixedClock(NOW));
    const merged = mergedDirectory(() => ok({ language: "ur", driver: null }));
    const prefs = countingPreferences();
    const sent: SentMessage[] = [];
    const bot = createDriverBot(
      buildDeps(sessions, merged.drivers),
      capturing(sent),
      () => {},
      createLanguageHydration({ preferences: prefs.port, sessions }),
    );

    const accepted = await bot.handleUpdate(startUpdate() as never);

    expect(accepted).toBe(true);
    expect(merged.contextCalls()).toBe(0);
    expect(prefs.reads()).toBe(1);
    expect(merged.lookups()).toBe(1);
  });

  it("ردّ الحوار بلغة القراءة المدمجة — الترطيب سابق للحوار في نفس المحاولة", async () => {
    const sessions = createMemorySessionStore(fixedClock(NOW));
    const merged = mergedDirectory(() => ok({ language: "ur", driver: null }));
    const prefs = countingPreferences();
    const sent: SentMessage[] = [];
    const bot = createDriverBot(
      buildDeps(sessions, merged.drivers),
      capturing(sent),
      () => {},
      createLanguageHydration({ preferences: prefs.port, sessions }),
    );

    const accepted = await bot.handleUpdate(contactUpdate() as never);

    expect(accepted).toBe(true);
    // ردُّ استلامِ الهاتفِ بالأرديةِ — لغةُ القراءةِ المدمجةِ لا تخمينِ تلغرام (ar).
    expect(sent.length).toBe(1);
    expect(sent[0]?.text).toBe(translate("ur", "driver.phone_received_for_app"));
  });
});
