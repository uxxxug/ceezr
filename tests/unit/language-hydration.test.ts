/**
 * الغرض: إثبات العلّة وإصلاحها — لغةٌ اختارها المستخدم وحُفظت في القاعدة كانت تُفقَد
 *   عند كل جلسة جديدة، لأن `getLanguage` لم يكن لها مستدعٍ إنتاجي واحد.
 * الحالة: اختبار فعلي — البند 2.1.
 * ينتمي إلى: tests/unit
 * ملاحظات مستقبلية: عند إضافة تفضيلات أخرى تُرطَّب من القاعدة تُضاف هنا بنفس النمط.
 */
import { describe, expect, it } from "bun:test";
import { createLanguageHydration } from "../../apps/gateway/src/bots/shared/language-middleware.ts";
import { createMemorySessionStore } from "../../apps/gateway/src/bots/shared/session.ts";
import { INITIAL_STATE, type Sender } from "../../packages/application/bots/types.ts";
import type {
  LanguageChangeOutcome,
  LanguagePreferencePort,
} from "../../packages/application/i18n-translation/select-language.ts";
import type { SupportedLanguage } from "../../packages/domain/i18n-translation/index.ts";
import { err, ok, type Result } from "../../packages/shared/result/index.ts";
import { fixedClock } from "../support/in-memory-ports.ts";

const SENDER: Sender = { telegramUserId: "900", chatId: "900", languageHint: "ar" };
const NOW = new Date("2026-08-11T10:00:00.000Z");

type Stored = SupportedLanguage | null;

/** مزدوج منفذ التفضيلات: يحكي القاعدة، ويعدّ نداءاته لإثبات أنها تُستدعى فعلاً. */
function preferences(stored: Stored, fail = false) {
  let reads = 0;
  const port: LanguagePreferencePort = {
    getLanguage: async (): Promise<Result<Stored, never>> => {
      reads += 1;
      if (fail) {
        return err({
          kind: "PORT_FAILURE",
          detail: "قاعدة لا تستجيب",
          operation: "get_user_language",
        } as never);
      }
      return ok(stored);
    },
    setLanguage: async (): Promise<Result<LanguageChangeOutcome, never>> => {
      throw new Error("لا يُنتظر من الترطيب أن يكتب لغةً");
    },
  };
  return { port, reads: () => reads };
}

const sessions = () => createMemorySessionStore(fixedClock(NOW));

describe("ترطيب اللغة من القاعدة", () => {
  /**
   * هذه هي العلّة نفسها: جلسة غائبة (انتهاء مدّة Redis، أو إعادة تشغيل، أو /cancel)
   * وقاعدة تحمل الأردية. كان الحوار يبني الحالة من languageHint فيعود يخاطبه
   * بالعربية بعد أن أخبره صريحاً أنه حفظ لغته.
   */
  it("يكتب لغة القاعدة في جلسة غائبة — وهي العلّة التي كانت تُفقد اللغة", async () => {
    const store = sessions();
    const prefs = preferences("ur");
    await createLanguageHydration({ preferences: prefs.port, sessions: store }).hydrate(SENDER);

    const state = await store.load(SENDER.telegramUserId);
    expect(state.ok && state.value?.language).toBe("ur");
    // وبقيّة الحالة ابتدائية سليمة: الترطيب لا يخترع خطوة حوار
    expect(state.ok && state.value?.step).toBe(INITIAL_STATE.step);
    expect(prefs.reads()).toBe(1);
  });

  it("يصحّح جلسة قائمة بلغة مخالفة بلا لمس بقيّة الحالة", async () => {
    const store = sessions();
    await store.save(SENDER.telegramUserId, {
      ...INITIAL_STATE,
      step: "awaiting_name",
      language: "ar",
      draftName: "أحمد العمري",
    });

    const prefs = preferences("en");
    await createLanguageHydration({ preferences: prefs.port, sessions: store }).hydrate(SENDER);

    const state = await store.load(SENDER.telegramUserId);
    expect(state.ok && state.value?.language).toBe("en");
    // الخطوة الجارية ومسودّتها تبقيان: تصحيح اللغة لا يُسقط تسجيلاً في منتصفه
    expect(state.ok && state.value?.step).toBe("awaiting_name");
    expect(state.ok && state.value?.draftName).toBe("أحمد العمري");
  });

  it("لا يكتب شيئاً حين تتفق الجلسة والقاعدة — لا كتابة بلا حاجة", async () => {
    const store = sessions();
    await store.save(SENDER.telegramUserId, { ...INITIAL_STATE, language: "en" });

    let writes = 0;
    const counting = {
      load: store.load,
      clear: store.clear,
      save: async (id: string, state: Parameters<typeof store.save>[1]) => {
        writes += 1;
        return store.save(id, state);
      },
    };

    await createLanguageHydration({
      preferences: preferences("en").port,
      sessions: counting,
    }).hydrate(SENDER);
    expect(writes).toBe(0);
  });

  /**
   * غير المسجَّل لا تفضيل له، فلا يجوز أن نخلق له جلسةً بلغة مخترعة: الحوار
   * يستعمل languageHint من تلغرام وهو أفضل تخمين متاح لمن لم يختر بعد.
   */
  it("لا يخلق جلسة لغير المسجَّل فيبقى تخمين تلغرام هو المرجع", async () => {
    const store = sessions();
    await createLanguageHydration({
      preferences: preferences(null).port,
      sessions: store,
    }).hydrate(SENDER);

    const state = await store.load(SENDER.telegramUserId);
    expect(state.ok && state.value).toBeNull();
  });

  /**
   * عطل القاعدة لا يُسكت البوت: لغةٌ أقدم أهون من حوار لا يردّ إطلاقاً. ولو رمى
   * الترطيب لسقط التحديث كلّه في المحوّل فصار عطل لغةٍ عطلَ بوتٍ كامل.
   */
  it("عطل القاعدة لا يرمي ولا يمنع الحوار، ويُسجَّل سببه", async () => {
    const store = sessions();
    const logged: string[] = [];

    await createLanguageHydration({
      preferences: preferences("ur", true).port,
      sessions: store,
      log: (message) => logged.push(message),
    }).hydrate(SENDER);

    const state = await store.load(SENDER.telegramUserId);
    expect(state.ok && state.value).toBeNull();
    expect(logged).toContain("language.hydrate_failed");
  });
});
