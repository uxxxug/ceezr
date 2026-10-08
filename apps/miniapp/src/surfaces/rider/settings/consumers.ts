/**
 * الغرض: سجلُّ «مَن يقرأُ هذا؟» للوحاتِ الإعدادِ المبنيّةِ على عقدٍ قائمٍ ([B]) — `TRUTH-01`.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/settings
 *
 * الأمرُ التصميميّ (§0.4 و§14.2): **لا واجهةَ لشيءٍ قبلَ أن يوجدَ مَن يستهلكُه.** مفتاحٌ يُحفَظُ
 * ولا يقرؤه مسارُ إرسالٍ وعدٌ كاذب؛ ورسالةٌ تُكتَبُ في تذكرةٍ لا تعرضُها لوحةُ الإدارةِ وعدٌ كاذب.
 *
 * - `notificationPrefs`: لا مسارَ بثٍّ ولا إرسالٍ يقرأُ `offers_notifications_enabled` ولا
 *   `updates_notifications_enabled`، والبثُّ الإداريُّ بلا تصنيفِ «عروض/تحديثات». فالمفتاحانِ لا
 *   يُطفئانِ شيئاً ⇒ لا يُعرَضان، ويُقالُ الحدُّ صريحاً.
 * - `ticketThread`: لا صفحةَ إدارةٍ ولا دعمٍ تقرأُ `ticket_messages` ⇒ لا خانةَ كتابة.
 *
 * العقدُ في الخادمِ باقٍ (DEC-42/DEC-43) بلا حذف: قلبُ العلَمِ إلى `true` يكونُ **في PR نفسِه**
 * الذي يوصِلُ المستهلِك، ويُثبِتُه اختبارٌ يقرأُ مسارَ المستهلِكِ لا العلَمَ وحدَه.
 */
export const RIDER_SETTINGS_CONSUMERS = Object.freeze({
  notificationPrefs: false,
  ticketThread: false,
} as const);

export type RiderSettingsConsumer = keyof typeof RIDER_SETTINGS_CONSUMERS;

export function hasConsumer(feature: RiderSettingsConsumer): boolean {
  return RIDER_SETTINGS_CONSUMERS[feature];
}
