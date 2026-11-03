/**
 * `WR-32` — مِسبارُ رسالةِ خصوصيّةِ الراكبِ وسمعتِه لبوتِ الراكبِ.
 *
 * البوتُ لا يُسجِّلُ الإقرارَ: الإقرارُ فعلٌ في التطبيقِ (`POST /v1/consents`) يُكتَبُ
 * بإصدارِه ووقتِه في `user_consents`. والبوتُ يقرأُ السجلَّ نفسَه ليعرفَ هل يُرسِلُ
 * الرسالةَ مع `/start`: تُرسَلُ للجديدِ ولمن لم يُقِرَّ بالإصدارِ الحاليِّ، وتكفُّ بعدَ
 * الإقرارِ — فلا تتكرّرُ كلَّما فُتِحَ البوتُ، وتعودُ مرّةً مع كلِّ إصدارٍ جديدٍ.
 */

import { riderPrivacyNoticePending } from "../../domain/consent/consent-decision.ts";
import type { ConsentRecordReader } from "./ports.ts";

export interface RiderPrivacyNoticeProbe {
  /** `true` ⇒ تُرسَلُ الرسالةُ · `false` ⇒ أُقِرَّ بالإصدارِ الحاليِّ · `null` ⇒ تعذّرت القراءةُ. */
  pending(telegramUserId: string): Promise<boolean | null>;
}

export function createRiderPrivacyNoticeProbe(
  reader: ConsentRecordReader,
): RiderPrivacyNoticeProbe {
  return {
    pending: async (telegramUserId) => {
      const recorded = await reader.listForTelegramUser(telegramUserId);
      return recorded.ok ? riderPrivacyNoticePending(recorded.value) : null;
    },
  };
}
