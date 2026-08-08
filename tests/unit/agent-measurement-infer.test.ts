/**
 * الغرض: اختبار قاعدة الاستنتاج الآلي وحدها — أضعف الطرق الثلاث، فهي أولاها
 *   باختبارٍ يكشف حدودها بدل أن يخفيها.
 * الحالة: اختبار وحدة فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: أي تعديل على `inferVerdict`
 * ملاحظات مستقبلية: حين تُصحَّح القاعدة بناءً على صفوف `inferred` المخالفة لحكم
 *   البشر، تُعدَّل التوقّعات هنا معها — وهذا هو المسار المقصود لا استثناءً عليه.
 */

import { describe, expect, it } from "bun:test";
import { inferVerdict } from "../../packages/application/dispute/agent-measurement.ts";

describe("inferVerdict — مقارنة الفعل بالدعوى لا بالصياغة", () => {
  it("«مشكلة اشتراك» + تفعيل = صدق الوكيل", () => {
    expect(inferVerdict("subscription_issue", "activate")).toBe("accepted");
  });

  it("«مشكلة اشتراك» + رفض أو إنهاء = أخطأ الوكيل", () => {
    expect(inferVerdict("subscription_issue", "reject")).toBe("rejected");
    expect(inferVerdict("subscription_issue", "terminate")).toBe("rejected");
  });

  it("نزاع رحلة: أيّ حسمٍ غير تفعيل الاشتراك موافقٌ لكونه نزاعاً", () => {
    expect(inferVerdict("ride_dispute", "reject")).toBe("accepted");
    expect(inferVerdict("ride_dispute", "terminate")).toBe("accepted");
    expect(inferVerdict("ride_dispute", "activate")).toBe("rejected");
  });

  /**
   * ⚠️ هذان الاختباران يحرسان **امتناع القاعدة عن الحكم**، وهو أهم ما فيها.
   *
   * بلا تصنيف لا دعوى، وبلا دعوى لا صواب ولا خطأ. ولو أعادت `rejected` هنا
   * لصار كلّ اقتراحٍ لم يُصنِّف يُحسَب فشلاً، ولانحدرت النسبة بما لا يقيس شيئاً.
   */
  it("بلا تصنيف: `ignored` لا `rejected` — لا حكم على من لم يدَّعِ", () => {
    expect(inferVerdict(null, "activate")).toBe("ignored");
    expect(inferVerdict(null, "reject")).toBe("ignored");
  });

  it("`general_inquiry`: لا يُقابله فعلٌ في هذا المسار فلا يُحاكَم به", () => {
    expect(inferVerdict("general_inquiry", "reject")).toBe("ignored");
    expect(inferVerdict("general_inquiry", "activate")).toBe("ignored");
  });

  /**
   * ⚠️ التصنيفات الثلاثة أعلاه هي **كلّ ما يُنتجه `supportTicketAgent` اليوم**.
   * وأيّ تصنيف رابع يصل قبل أن تُحدَّث هذه القاعدة يجب أن يسقط في `ignored`
   * لا في حكمٍ مُخمَّن: لا نحسب صواباً ولا خطأً على دعوى لا نعرف كيف تُكذَّب.
   */
  it("تصنيف مجهول لم يُنتجه الوكيل بعد: `ignored` لا حكمٌ مخمَّن", () => {
    expect(inferVerdict("لم-يوجد-بعد", "activate")).toBe("ignored");
  });
});
