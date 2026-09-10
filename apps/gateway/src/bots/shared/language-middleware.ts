/**
 * الغرض: ترطيب لغة الجلسة من القاعدة قبل كل تحديث، فلا يفقد المستخدم لغته المختارة.
 * الحالة: منفّذ فعلياً — البند 2.1.
 * ينتمي إلى: apps/gateway/bots/shared
 * يستخدمه: apps/gateway/src/bots/{driver,rider}/index.ts عبر createDriverBot/createRiderBot.
 * ملاحظات مستقبلية: عند إضافة تفضيلات أخرى تُخزَّن في القاعدة (المنطقة، وحدة المسافة)
 *   يصير هذا الملفّ ترطيباً عامّاً لا للغة وحدها؛ التوقيع نفسه يتّسع لها بلا تغيير المتصلين.
 */

import {
  INITIAL_STATE,
  type Sender,
  type SessionStore,
} from "../../../../../packages/application/bots/types.ts";
import type { LanguagePreferencePort } from "../../../../../packages/application/i18n-translation/select-language.ts";
import { pseudonymise } from "../../../../../packages/infrastructure/observability/structured-log.ts";

export interface LanguageHydrationDependencies {
  readonly preferences: LanguagePreferencePort;
  readonly sessions: SessionStore;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

export interface LanguageHydration {
  /** يُنادى قبل تسليم التحديث للحوار. لا يرمي ولا يمنع الحوار مهما فشل. */
  hydrate(sender: Sender): Promise<void>;
}

/**
 * العلّة التي يعالجها هذا الملفّ (مُثبَتة في الكود لا مُستنتَجة): `getLanguage` لم يكن
 * لها **أي مستدعٍ إنتاجي** — تُعلَن في select-language.ts وتُنفَّذ في language-adapters.ts
 * ولا يستدعيها إلا اختبار وحدة. وكلا الحوارين يبني الحالة الغائبة من
 * `sender.languageHint` وحده. فمن اختار الأردية يفقد اختياره عند كل جلسة جديدة:
 * انتهاء مدّة جلسة Redis، أو إعادة تشغيل الخدمة، أو `/cancel` الذي يمحو الجلسة.
 * فيرجع البوت يخاطبه بالعربية بعد أن أخبره صريحاً أنه حفظ لغته.
 *
 * والقاعدة هي المرجع لا الجلسة: `handleLanguageCallback` يكتب القاعدة أولاً ثم الجلسة،
 * فالقاعدة أحدث أو مساوية أبداً، ولا تكون الجلسة أحدث منها في أي مسار.
 */
export function createLanguageHydration(deps: LanguageHydrationDependencies): LanguageHydration {
  const log = deps.log ?? (() => {});

  return {
    hydrate: async (sender) => {
      const stored = await deps.preferences.getLanguage(sender.telegramUserId);
      if (!stored.ok) {
        // عطل القاعدة لا يُسكت البوت: لغة أقدم أهون من حوار لا يردّ إطلاقاً.
        log("language.hydrate_failed", {
          actor: pseudonymise(sender.telegramUserId),
          detail: String(stored.error),
        });
        return;
      }

      const dbLanguage = stored.value;
      // null = غير مسجَّل بعد، فلا تفضيل محفوظ له. الحوار يستعمل languageHint من تلغرام
      // وهو أفضل تخمين متاح لمن لم يختر بعد.
      if (dbLanguage === null) return;

      const session = await deps.sessions.load(sender.telegramUserId);
      if (!session.ok) {
        log("language.hydrate_session_unreadable", {
          actor: pseudonymise(sender.telegramUserId),
          detail: String(session.error),
        });
        return;
      }

      const state = session.value;
      if (state === null) {
        // الجلسة الغائبة هي بيت العلّة: هنا كان الحوار يسقط إلى languageHint فيضيع
        // الاختيار. فنكتب الحالة الابتدائية بلغة القاعدة قبل أن يقرأها الحوار.
        const saved = await deps.sessions.save(sender.telegramUserId, {
          ...INITIAL_STATE,
          language: dbLanguage,
        });
        if (!saved.ok) {
          log("language.hydrate_save_failed", {
            actor: pseudonymise(sender.telegramUserId),
            detail: String(saved.error),
          });
          return;
        }
        log("language.hydrated", {
          actor: pseudonymise(sender.telegramUserId),
          language: dbLanguage,
          from: "absent_session",
        });
        return;
      }

      // جلسة قائمة بلغة مخالفة: تصحَّح بلا لمس بقيّة الحالة، فلا تنكسر خطوة جارية.
      if (state.language === dbLanguage) return;
      const saved = await deps.sessions.save(sender.telegramUserId, {
        ...state,
        language: dbLanguage,
      });
      if (!saved.ok) {
        log("language.hydrate_save_failed", {
          actor: pseudonymise(sender.telegramUserId),
          detail: String(saved.error),
        });
        return;
      }
      log("language.hydrated", {
        actor: pseudonymise(sender.telegramUserId),
        language: dbLanguage,
        from: state.language,
      });
    },
  };
}
