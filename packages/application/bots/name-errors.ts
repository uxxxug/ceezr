/**
 * الغرض: ترجمة سبب رفض الاسم إلى مفتاح الرسالة المعروضة، في موضع واحد لكل البوتات.
 *   وُضع هنا لا في domain لأن اختيار الرسالة عرضٌ لا قاعدة عمل، ولا في كل حوار على حدة
 *   لأن ذلك ما جعل حوار الراكب يعرض "الاسم قصير جداً" لاسمٍ طويل جداً.
 * الحالة: منفّذ فعلياً — القسم 1 من الأمر الشامل.
 * ينتمي إلى: application/bots
 * يُتوقع أن يستخدمه لاحقاً: أي حوار تسجيل جديد يطلب اسماً.
 */

import type { InvalidFullNameError } from "../../domain/identity/value-objects.ts";

/**
 * `Record` لا `switch`: إضافة سبب جديد في domain تُسقِط الترجمة هنا وقت الفحص
 * بدل أن تسقط بصمت في فرع `default`.
 */
const KEYS: Record<InvalidFullNameError["reason"], string> = {
  too_short: "driver.name_too_short",
  too_long: "driver.name_too_long",
  looks_like_command: "driver.name_is_command",
  looks_like_gibberish: "driver.name_looks_invalid",
};

export function nameErrorKey(reason: InvalidFullNameError["reason"]): string {
  return KEYS[reason];
}
