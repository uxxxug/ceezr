/**
 * الغرض: مدخلُ حزمةِ `rider-history` المؤجَّلةِ — سجلُّ الرحلاتِ (`SR-09`) وتفاصيلُها (`SR-10`) ومركزُ الإشعاراتِ (`SS-07`).
 *   لا تُعرَضُ إلّا بطلبِ الراكبِ، والقسمُ 9.4 يحصرُ `rider-home` في «الرئيسية، التسعير، اختيار الخدمة» (`F1-09` · `D-32`).
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider
 */

// `D-33` · `ADR 0188`: نصوصُ جزءِ `rider-history` تُسجَّلُ معَ حزمتِه لا في `shell`.
import "../../../../../packages/shared/i18n/miniapp/ar-parts/rider-history.ts";

export { RideDetailScreen } from "./history/RideDetailScreen.tsx";
export { RideHistoryScreen } from "./history/RideHistoryScreen.tsx";
export { NotificationsScreen } from "./notifications/NotificationsScreen.tsx";
