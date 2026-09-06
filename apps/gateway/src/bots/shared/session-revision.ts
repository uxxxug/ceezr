/**
 * الغرض: تتبّع مراجعة جلسة الحوار (revision) لمنع أن تكتب تحديثٌ متزامنٌ فوق
 *   حالةٍ أحدث (BUG-007). المراجعةُ تُرفق كرمزٍ (Symbol) على كائن الحالة لا
 *   كحقلٍ دائم، فلا تُخزَّن في JSON ولا تُراها القاعدةُ ولا الحوار: `JSON.stringify`
 *   يُسقط الرموز، وانتشارُ الكائن `{...state}` ينسخها فتبقى مع الحالة المنشورة
 *   حين يُمرِّرها الحوار إلى `save`. وبهذا تسري المراجعةُ من التحميل إلى الحفظ
 *   دون تغيير توقيع `SessionStore` ولا سطرٍ واحد في أي حوار.
 * الحالة: منفّذ فعلياً — BUG-007.
 * ينتمي إلى: apps/gateway/src/bots/shared
 * يُتوقَّع أن يستخدمه لاحقاً: redis-session.ts، session.ts (memory).
 * ملاحظات مستقبلية: الرمزُ بياناتُ تخزينٍ عابرةٌ لا حالةُ مجال، فلا يصحّ أن يصير
 *   حقلاً دائماً في `DialogState` ولا أن يُقايسَه `toEqual` — ومن يُريد مقارنةً
 *   دقيقةً يستخدم `stripRevision`.
 */

import type { DialogState } from "../../../../../packages/application/bots/types.ts";

/** رمزٌ غيرُ معدودٍ يحمِل مراجعة الجلسة على كائن الحالة. */
const SESSION_REVISION: unique symbol = Symbol("waslah.session.revision");

/**
 * ارفق المراجعةَ بحالةٍ جديدة (بلا تعديل الأصل). انتشارُ الكائن `{...state}` ينسخُ
 * الرمزَ فتبقى مع الحالة التي يبنيها الحوار ويمرّرها إلى `save`. لا تُعدَّل الحالةُ
 * الأصليةُ فيُتفسَد ثابتٌ مشتركٌ، والمراجعةُ بياناتٌ عابرةٌ لا حالةُ مجال.
 */
export function attachRevision(state: DialogState, revision: number): DialogState {
  return { ...(state as object), [SESSION_REVISION]: revision } as unknown as DialogState;
}

/** اقرأ المراجعةَ من كائن. غيابُ الرمز يعني «حالةٌ طازجةٌ لم تُحمَّل» فيُكتبُ
 *  غيرَ مشروطٍ (إعادةُ تعيينٍ)، أمّا وجودُ الرمز ولو 0 فيعني «حالةٌ حمَّلها
 *  الحوارُ» فيُطبَّقُ عليها CAS فلا تكتبُ فوقَ مراجعةٍ أحدث. */
export function readRevision(state: object): number | undefined {
  const value = (state as unknown as Record<symbol, unknown>)[SESSION_REVISION];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** انسخ الحالةَ بلا مراجعة، للمقارنة الدقيقة في الاختبارات. يقبل null فيُعيد null. */
export function stripRevision(state: DialogState | null): DialogState | null {
  if (state === null) return null;
  // Object.keys يُعيد المفاتيحَ النصّيةَ فقط، فيخرجُ الرمزُ من النسخة.
  const clone: Record<string, unknown> = {};
  for (const key of Object.keys(state as object)) {
    clone[key] = (state as unknown as Record<string, unknown>)[key];
  }
  return clone as unknown as DialogState;
}

export { SESSION_REVISION };

/**
 * إشارةُ تعارضِ CAS — تُرمى من طبقةِ مخزنِ الجلسات (gateway) وحدها عند فشلِ الكتابةِ
 * الشرطية، لا من طبقةِ التطبيق التي لا ترمي. يلتقطها محوّلُ البوتِ فيُعيدُ تحميلَ
 * الحالةِ وإعادةَ حسابِ الردودِ قبلَ إرسالِ أيِّ رسالة. ليست خطأَ عملٍ متوقَّعاً، بل
 * إشارةُ إعادةِ محاولةٍ لحظيةِ التزامن: لا تُسجَّل في الدليلِ عطلاً ولا تُبلَّغ
 * تلغرام، وإنما تُعاد المحاولةُ بصمتٍ حتى تنجحَ أو تستنفدَ الحدَّ.
 */
export class SessionCasConflictError extends Error {
  constructor(
    readonly telegramUserId: string,
    readonly expectedRevision: number,
  ) {
    super("تعارض مراجعة الجلسة — حُجِزَت كتابةٌ متزامنة");
    this.name = "SessionCasConflictError";
  }
}
