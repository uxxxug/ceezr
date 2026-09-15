/**
 * الغرض: نداءا حصيلةِ السائقِ — **قراءتانِ لا كتابةَ فيهما** (`F3-05` · `SD-06`
 *   · `SD-09`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-05`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/activity
 * يُستخدم من: `ActivityScreen.tsx`
 * يُتوقع أن يستخدمه لاحقاً: `SD-07` — نداءُ الاشتراكِ يُضافُ في ملفِّه لا ههنا.
 * الحاكم: docs/adr/0120-transparency-is-a-denominator-not-a-slogan.md
 *
 * ## لِمَ **تُعادُ المحاولةُ** ههنا خلافاً لنداءاتِ المَهمّةِ
 *
 * لأنَّ هاتَينِ قراءتانِ لا كاتبَتانِ: إعادةُ قراءةٍ بعدَ انقطاعِ شبكةٍ لا تُعيدُ
 * فعلاً نجحَ ولم يصلْ جوابُه. ولكنَّ الإعادةَ **بزرٍّ يفهمُه الإنسانُ** لا حلقةً
 * تلقائيّةً: دورةٌ صامتةٌ على شاشةِ تقريرٍ تستهلكُ بطاريّةً وحُزمةً بلا أن يطلبَ
 * أحدٌ رقماً جديداً.
 *
 * ## ولِمَ السقفُ يُرسَلُ ولا يُقصَرُ ههنا
 *
 * القاعدةُ تقصُرُه، والطبقةُ تقصُرُه، **والمُنفَذُ يُنشَرُ في الردِّ**. فقصرٌ ثالثٌ
 * في العميلِ يجعلُ للسقفِ ثلاثةَ حاسبينَ ينزلقُ أحدُهم — والعميلُ يقرأُ
 * `limit` الحقيقيَّ من الجوابِ.
 *
 * ## وما لا تفعلُه هذه النداءاتُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تُرسِلُ تاريخَينِ ولا منطقةَ زمنٍ**: نافذةٌ يرسمُها جهازٌ تجعلُ لكلِّ
 *      جهازٍ حصيلةً، والساعةُ المحليّةُ قد تكونُ مغلوطةً.
 *   ــ **لا تُرسِلُ معرِّفَ سائقٍ**: الهويّةُ في الرمزِ الموقَّعِ وحدَه.
 *   ــ **لا تُخزِّنُ جواباً محلّيّاً**: تقريرٌ مخزَّنٌ يُقرأُ حصيلةً لا رحلةً فيها.
 *   ــ **لا تجمعُ النداءَينِ في واحدٍ**: الجدولُ يُطلَبُ عندَ التوسيعِ فحسب.
 */

import { apiFetch } from "../../../api/client.ts";
import type {
  ApiActivityPeriod,
  DriverActivityEntriesResponse,
  DriverActivitySummaryResponse,
} from "./activity-contract.ts";

export type * from "./activity-contract.ts";

export function readDriverActivitySummary(
  period: ApiActivityPeriod,
): Promise<DriverActivitySummaryResponse> {
  return apiFetch<DriverActivitySummaryResponse>(
    `/v1/driver/activity?period=${encodeURIComponent(period)}`,
    { method: "GET" },
  );
}

export function readDriverActivityEntries(
  period: ApiActivityPeriod,
  limit: number,
): Promise<DriverActivityEntriesResponse> {
  return apiFetch<DriverActivityEntriesResponse>(
    `/v1/driver/activity/entries?period=${encodeURIComponent(period)}&limit=${String(limit)}`,
    { method: "GET" },
  );
}
