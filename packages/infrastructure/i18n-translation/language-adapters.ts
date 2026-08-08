/**
 * الغرض: محوّل تفضيل اللغة — يقابل الدالّتين set_user_language و get_user_language.
 * الحالة: منفّذ فعلياً ومُختبَر على قاعدة حقيقية — المرحلة 2.6.
 * ينتمي إلى: infrastructure/i18n-translation
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts، apps/admin-dashboard
 * ملاحظات مستقبلية: قراءة اللغة تُخزَّن مؤقتاً في Redis حين تصير في مسار كل رسالة.
 */

import type {
  LanguageChangeOutcome,
  LanguagePreferencePort,
} from "../../application/i18n-translation/index.ts";
import type { PortFailureError } from "../../application/ports/index.ts";
import {
  normalizeLanguageTag,
  type SupportedLanguage,
} from "../../domain/i18n-translation/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import { guard, readEnvelope, type Sql } from "../db/client.ts";

export function createLanguagePreferencePort(sql: Sql): LanguagePreferencePort {
  return {
    setLanguage: (
      telegramId: string,
      language: SupportedLanguage,
    ): Promise<Result<LanguageChangeOutcome, PortFailureError>> =>
      guard("rpc.set_user_language", async () => {
        const rows = await sql`select set_user_language(${telegramId}::bigint, ${language}) as r`;
        const envelope = readEnvelope(rows[0]?.r);
        if (envelope === null) throw new Error("EMPTY_ENVELOPE");
        if (!envelope.ok) throw new Error(String(envelope.error ?? "UNKNOWN"));

        return {
          language,
          changed: envelope.changed === true,
          previous: normalizeLanguageTag(
            typeof envelope.previous_language === "string" ? envelope.previous_language : null,
          ),
        };
      }),

    getLanguage: async (
      telegramId: string,
    ): Promise<Result<SupportedLanguage | null, PortFailureError>> => {
      const outcome = await guard("rpc.get_user_language", async () => {
        const rows = await sql`select get_user_language(${telegramId}::bigint) as r`;
        const envelope = readEnvelope(rows[0]?.r);
        // المستخدم غير المسجَّل ليس عطلاً: هو الحالة الطبيعية قبل /start.
        if (envelope === null || !envelope.ok) return null;
        return normalizeLanguageTag(
          typeof envelope.language_code === "string" ? envelope.language_code : null,
        );
      });
      return outcome.ok ? ok(outcome.value) : err(outcome.error);
    },
  };
}
