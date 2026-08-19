/**
 * الغرض: سطرُ انتظارٍ متغيّر بدل جملةٍ واحدة تتكرّر في كلّ طلب. لحظاتُ الانتظار
 *   هي أطولُ ما يعيشه المستخدم في المنصّة، والجملةُ نفسُها في كلّ مرّة تُقرأ
 *   رسالةً آليةً لا خدمةً حيّة.
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14.
 * ينتمي إلى: packages/application/bots
 * يُتوقع أن يستخدمه لاحقاً: rider-dialog.ts، driver-dialog.ts
 * ملاحظات مستقبلية: زيادةُ عدد البدائل تحتاج مفاتيحَ i18n جديدة فقط —
 *   `VARIANT_COUNT` يُقرأ من طول القائمة لا من رقمٍ مكتوب في مكانين.
 */
import { t } from "../../shared/i18n/index.ts";

/**
 * لماذا لا `Math.random`؟ لأنّ العشوائيةَ الحقيقية تجعل الاختبار متقلّباً، ولأنّ
 * الرسالةَ نفسَها قد تُعاد صياغتُها لنفس الطلب في ردٍّ تالٍ فتقفز الجملة بلا سبب.
 * البذرةُ نصٌّ مستقرّ (معرّفُ الطلب، ومعه دقائقُ الانتظار حيث يُقصَد التغيّرُ مع
 * الوقت)، فيثبت السطرُ لنفس اللحظة ويختلف بين طلبٍ وطلب — وهذا هو المطلوب.
 */
function seedIndex(seed: string, length: number): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    // FNV-1a: كافٍ لتوزيعٍ متساوٍ على أربعة بدائل، ولا يُستخدم لشيءٍ أمنيّ.
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % length;
}

/** عائلاتُ الانتظار. كلّ عائلةٍ قائمةُ مفاتيح، والاختيارُ منها بالبذرة. */
const FAMILIES = {
  riderSearching: [
    "waiting.rider_search_1",
    "waiting.rider_search_2",
    "waiting.rider_search_3",
    "waiting.rider_search_4",
  ],
  riderSearchingDelivery: [
    "waiting.delivery_search_1",
    "waiting.delivery_search_2",
    "waiting.delivery_search_3",
    "waiting.delivery_search_4",
  ],
  riderStillSearching: [
    "waiting.rider_still_1",
    "waiting.rider_still_2",
    "waiting.rider_still_3",
    "waiting.rider_still_4",
  ],
  driverAvailable: [
    "waiting.driver_ready_1",
    "waiting.driver_ready_2",
    "waiting.driver_ready_3",
    "waiting.driver_ready_4",
  ],
} as const;

export type WaitingFamily = keyof typeof FAMILIES;

export function waitingLine(family: WaitingFamily, seed: string, language: string): string {
  const keys = FAMILIES[family];
  return t(language)(keys[seedIndex(seed, keys.length)] ?? keys[0]);
}

/**
 * دقائقُ الانتظار في دِلاءٍ من ثلاث دقائق: بذرةٌ بالدقيقة تُغيّر السطر مع كلّ
 * تحديثٍ فيبدو البوت مضطرباً، وبذرةٌ بلا زمنٍ تُجمّد السطرَ على انتظارٍ طويل.
 */
export function waitBucket(minutes: number): string {
  return String(Math.floor(Math.max(0, minutes) / 3));
}

/**
 * كلُّ بدائل العائلة بلغةٍ واحدة. يحتاجها الاختبار ليُثبت أنّ ما وصل المستخدمَ من
 * هذه العائلة لا من غيرها، بلا أن يُعيد كتابة قائمةِ المفاتيح عنده — فقائمتان
 * تتباعدان، فيبقى الاختبار أخضرَ على سطرٍ حُذف من الإنتاج.
 */
export function waitingVariants(family: WaitingFamily, language: string): readonly string[] {
  const tr = t(language);
  return FAMILIES[family].map((key) => tr(key));
}
