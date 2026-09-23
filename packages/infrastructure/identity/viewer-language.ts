/**
 * الغرض: كتابةُ لغةِ الواجهةِ في حسابِ المستخدمِ — محوّلٌ **للكتابةِ وحدها**
 *   لمنفذِ `ViewerAccountLanguageWriter` (البند `PD-030` · `ADR 0178`).
 * الحالة: منفّذ فعلياً — `PD-030`.
 * ينتمي إلى: infrastructure/identity
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway/src/index.ts` عبر حقنِ التبعياتِ فقط.
 *
 * ولماذا ملفٌّ منفصلٌ لا في `viewer-account.ts`؟ لأنَّ `viewer-account.ts` محوّلُ
 * **قراءةٍ وحدَها** بحكمِ `F1-05` و`ADR 0035`: لا `update` ولا `insert` فيه،
 * وحاجزُ `check-viewer-role-authority.ts` يُسقِطُ البناءَ إن وُجدَ فيه `update`.
 * فالكتابةُ في ملفٍّ منفصلٍ تفصلُ المسؤوليتَين وتُبقي الحاجزَ صادقاً.
 */

import type {
  ViewerAccountLanguageWriter,
  ViewerLookupFailure,
} from "../../application/identity/ports.ts";
import { MINIAPP_LANGUAGES } from "../../shared/i18n/miniapp/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

/** اللغاتُ المسموحُ كتابتُها — مصدرٌ واحدٌ: `MINIAPP_LANGUAGES`. */
const ALLOWED_LANGUAGE_CODES: readonly string[] = MINIAPP_LANGUAGES;

function lookupFailed(reason: ViewerLookupFailure["reason"]): ViewerLookupFailure {
  return { code: "VIEWER_LOOKUP_FAILED", reason };
}

/**
 * `users.telegram_id` عمودُ `bigint`، ومعرّفُ الجلسةِ نصٌّ. فالنصُّ غيرُ الرقميِّ
 * **لا يُرسَل إلى القاعدةِ أصلاً**: لا صفَّ يمكن أن يطابقه.
 */
function asTelegramId(value: string): string | null {
  return /^[0-9]{1,19}$/.test(value) ? value : null;
}

export function createViewerAccountLanguageWriter(sql: Sql): ViewerAccountLanguageWriter {
  return {
    updateLanguageCode: async (
      telegramUserId: string,
      languageCode: string,
    ): Promise<Result<void, ViewerLookupFailure>> => {
      const telegramId = asTelegramId(telegramUserId);
      if (telegramId === null) return err(lookupFailed("READER_ERROR"));
      if (!ALLOWED_LANGUAGE_CODES.includes(languageCode)) {
        return err(lookupFailed("READER_ERROR"));
      }
      try {
        const rows = await sql.unsafe<{ readonly telegram_id: string }[]>(
          "update users set language_code = $1, updated_at = now() where telegram_id = $2 returning telegram_id",
          [languageCode, telegramId],
        );
        if (rows.length === 0) {
          // لا صفَّ يُحدَّث: المستخدمُ غيرُ مسجَّلٍ أو معرّفُ تيليجرام غيرُ صحيحٍ.
          return err(lookupFailed("READER_ERROR"));
        }
      } catch {
        return err(lookupFailed("READER_ERROR"));
      }
      return ok(undefined);
    },
  };
}
