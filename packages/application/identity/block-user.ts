/**
 * الغرض: حالة استخدام مستقبلية: block-user ضمن تسجيل وتوثيق المستخدمين
 * الحالة: هيكل فقط — لا تنفيذ. لا تُضِف منطقاً هنا قبل أمر تفعيل صريح.
 * ينتمي إلى: application/identity
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway (البوتات/الـ Webhooks)، apps/workers، apps/admin-dashboard
 * ملاحظات مستقبلية: التوقيع المستهدف عند التفعيل: export async function blockUser(input, deps): Promise<Result<T, E>>. RPC المرتبط المحتمل: block_user. يُفعَّل جزئياً في الأمر الثاني.
 * التنفيذ الفعلي: packages/application/bots/driver-dialog.ts ودوال SQL في
 *   supabase/migrations — انظر admin_set_user_blocked وadmin_set_driver_verification.
 *   هذا الملف بنية مستقبلية لطبقة application/identity عند فصل الهوية عن حوار البوت.
 */
export {};
