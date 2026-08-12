/**
 * الغرض: حالة استخدام مستقبلية: start-trial ضمن اشتراكات السائقين
 * الحالة: هيكل فقط — التنفيذ الفعليّ قائم في مكان آخر ولا يُعاد بناؤه هنا:
 *   packages/infrastructure/subscription/subscription-adapters.ts (createTrialRpc)
 *   يستدعي الدالّة الذرّية start_trial، ويُستدعى من حوار السائق. هذا الملف باقٍ
 *   بلا حذف (البند 1.1) ولا يُصدَّر من index.ts كي لا يُوهم بوجود تنفيذ ثانٍ.
 * ينتمي إلى: application/subscription
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway (البوتات/الـ Webhooks)، apps/workers، apps/admin-dashboard
 * ملاحظات (تاريخية، فيها خطأ توثيقيّ مصحَّح أعلاه): التوقيع المستهدف عند التفعيل: export async function startTrial(input, deps): Promise<Result<T, E>>. RPC المرتبط المحتمل: start_trial. يُفعَّل في الأمر الثاني (المرحلة 2.1) عبر RPC ذرّي renew_subscription.
 */
export {};
