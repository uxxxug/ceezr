/**
 * الغرض: نشر بطاقة الطلب وآلية أول ثلاث ضغطات في قروب غير المشتركين
 * الحالة: مُتجاوَز — نُفِّذ في المرحلة 2.3 خارج هذا الملف عمداً، وبقي هنا كمَعْلَم توثيقي.
 *   النشر: packages/infrastructure/notification/telegram-negotiation-notifier.ts
 *           (createUnsubscribedGroupPublisher)
 *   حالة الاستخدام: packages/application/dispatch/publish-to-unsubscribed-group.ts
 *   استقبال ضغطة «قبول»: packages/application/bots/driver-dialog.ts (بادئة unsub:claim)
 *   الربط: apps/gateway/src/container.ts
 *   السبب: ضغطة الزرّ تصل عبر مسار الويبهوك القائم نفسه لا عبر مستمع قروب منفصل، فإفراد
 *   وحدة «قروب» هنا كان سيُنشئ مسار إدخال ثانياً لنفس التحديث — وهو ازدواج لا فائدة منه.
 * ينتمي إلى: apps/gateway/groups
 * يُتوقع أن يستخدمه لاحقاً: لا أحد — يُحذف عند تنظيف الهياكل بعد القسم 3.
 * ملاحظات مستقبلية: لا تُضِف منطقاً هنا؛ أضِفه في الملفات المذكورة أعلاه.
 */
export {};
