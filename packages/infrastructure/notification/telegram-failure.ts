/**
 * الغرض: تصنيفُ إخفاق تلغرام: عابرٌ يُعاد، ودائمٌ لا يُعاد. مشتركٌ بين البثّ
 *   الجماعي وإشعارات الاشتراك لأن نسخَه مرّتين يعني اختلافَ سلوكِ الإعادة بينهما
 *   عند أوّل تعديل.
 * الحالة: منفّذ فعلياً — استُخرج من telegram-broadcast-sender.ts في 2026-08-14.
 * ينتمي إلى: infrastructure/notification
 * يُتوقع أن يستخدمه لاحقاً: أيّ مُرسِلٍ آخر يكتب صفّاً بحالة تسليم.
 * ملاحظات مستقبلية: 429 عابرٌ اليوم ويُعاد بموعد المدينة؛ إن احتجنا احترامَ
 *   `retry_after` بالثانية فمكانه هنا لا في المستدعي.
 */

/**
 * أكواد تلغرام التي لا تُغيّرها إعادةُ المحاولة:
 * • 403 — حجب البوت أو حسابٌ مُلغى. لن يستقبل شيئاً بعد اليوم.
 * • 400 — محادثةٌ غير موجودة أو معرّفٌ فاسد. الخطأ في الصفّ لا في الشبكة.
 * وما عداهما (429، 5xx، انقطاعُ شبكة) عابرٌ يُعاد بموعدٍ من إعداد المدينة.
 */
const PERMANENT_CODES = new Set([400, 403]);

export function classifyTelegramFailure(cause: unknown): { code: string; permanent: boolean } {
  const raw = cause as { error_code?: unknown; description?: unknown } | null;
  const errorCode = typeof raw?.error_code === "number" ? raw.error_code : null;
  const description =
    typeof raw?.description === "string"
      ? raw.description
      : cause instanceof Error
        ? cause.message
        : String(cause);
  if (errorCode === null) return { code: description.slice(0, 120), permanent: false };
  return {
    code: `${errorCode}:${description}`.slice(0, 120),
    permanent: PERMANENT_CODES.has(errorCode),
  };
}
