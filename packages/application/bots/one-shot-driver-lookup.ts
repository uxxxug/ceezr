/**
 * الغرض: LOAD-01 · C2 — تغليفُ منافذِ البوتِ بحيثُ يستهلِكُ **أولُ بحثٍ عن المرسلِ** في
 *   الحوارِ قيمةَ القراءةِ المدمجةِ (`findSenderContext`) المقروءةِ في موضعِ الترطيبِ
 *   نفسِهِ، بدلَ أن يطلَبَها مرّةً ثانيةً من القاعدة. كلُّ بحثٍ لاحقٍ — أياً كان — يمرُّ
 *   إلى المنفذِ الأصليِّ كما هو: لا ختمَ ولا تخزينٌ ولا تجميدُ لقطةٍ على الحوارِ كلِّه.
 * الحالة: منفّذ فعلياً — بند LOAD-01 (C2).
 * ينتمي إلى: application/bots
 * يستخدمه: apps/gateway/src/bots/driver/index.ts (مسار contact وحده).
 * ملاحظات مستقبلية: إن قيسَ لاحقاً أنَّ البحثَ الثاني في مسارٍ ما يريدُ نفسَ القيمةِ
 *   فهذا قرارٌ مستقلٌّ يُتَّخَذُ بقياسٍ لا بالتعميمِ من هنا.
 */

import { ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";
import type { DriverProfile } from "./types.ts";

/**
 * يُنتِجُ غلافًا حول `findByTelegramId` يُجيبُ عن **أولِ نداءٍ يطابقُ المرسلَ** بالقيمةِ
 * المُحمَّلةِ سلفاً، ثمَّ يمرِّرُ كلَّ نداءٍ بعدهُ إلى المنفذِ الأصليِّ. النداءُ عن مُرسِلٍ
 * آخرَ لا يُستهلَكُ أصلاً: القيمةَ المُحمَّلةَ لهذا المُرسِلِ وحدهُ.
 *
 * العقدُ المُصنِّعُ: القيمةَ المُحمَّلةَ نتيجةُ قراءةٍ **ناجحةٍ** (ليست فشلًا) — فشلُ
 * القراءةِ المدمجةِ لا يمرُّ من هنا أصلاً: المتصلُ يتراجعُ حينها إلى المسارِ القديمِ
 * كاملًا (قراءتان منفصلتان كما كانا).
 */
export function oneShotDriverLookup(
  underlying: (telegramUserId: string) => Promise<Result<DriverProfile | null, PortFailureError>>,
  telegramUserId: string,
  preloaded: DriverProfile | null,
): (telegramUserId: string) => Promise<Result<DriverProfile | null, PortFailureError>> {
  let consumed = false;
  return async (requested) => {
    if (!consumed && requested === telegramUserId) {
      consumed = true;
      return ok(preloaded);
    }
    return underlying(requested);
  };
}
