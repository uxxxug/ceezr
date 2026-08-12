/**
 * الغرض: محوّلات (Adapters) التكاملات الخارجية لوحدة subscription — تنفيذ منافذ التطبيق.
 * الحالة: مُفعَّل جزئياً — يُصدّر المحوّلات المنفَّذة فعلياً فقط:
 *     • subscription-adapters.ts: createSubscriptionReader، createTrialRpc.
 *     • subscription-change-adapters.ts: createSubscriptionChangeRpc
 *       (الإلغاء والاستئناف وعرض سعر الترقية وتطبيقها) — الأمر الثاني،
 *       قرار المالك 2026-08-12.
 *     • lifecycle-adapters.ts: يُستورد مباشرةً من مستدعيه، ولا يُصدَّر من هنا
 *       كي لا يتغيّر سطح الاستيراد القائم.
 *   الترويسة القديمة قالت «هيكل فقط … يُفعَّل عبر RPC ذرّي renew_subscription»؛
 *   الجزء الأخير خطأ توثيقيّ: لا دالّة بهذا الاسم في القاعدة.
 * ينتمي إلى: infrastructure/subscription
 * يُتوقع أن يستخدمه: apps/* عبر حقن التبعيات فقط، ولا يستوردها
 *   packages/domain/subscription إطلاقاً.
 */

export { createSubscriptionReader, createTrialRpc } from "./subscription-adapters.ts";
export { createSubscriptionChangeRpc } from "./subscription-change-adapters.ts";
