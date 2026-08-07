/**
 * الغرض: نشر حالات الإسناد والطوارئ في قروب الإسناد لكل مدينة
 * الحالة: مُتجاوَز جزئياً — مسار «فشل المطابقة» نُفِّذ في المرحلة 2.3 خارج هذا الملف:
 *   النشر: packages/infrastructure/notification/telegram-negotiation-notifier.ts
 *           (createEscalationGroupPublisher)
 *   حالة الاستخدام: packages/application/dispatch/escalate-unmatched-order.ts
 *   المشغّل: apps/workers/src/jobs/rotate-unsubscribed-negotiation.ts
 *   ما زال ناقصاً: زرّ SOS من العميل/السائق (بند مستقل، ليس ضمن 2.3).
 * ينتمي إلى: apps/gateway/groups
 * يُتوقع أن يستخدمه لاحقاً: مسار SOS عند تنفيذه
 * ملاحظات مستقبلية: عند تنفيذ SOS استخدم النَّاشر القائم بدل كتابة ناشر ثانٍ.
 */
export {};
