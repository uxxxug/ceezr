/**
 * الغرض: شكلُ ردِّ `GET /v1/notifications` و`POST /v1/notifications/:id/read` كما
 *   يقرأُهما العميلُ — أنواعٌ لا منطقٌ (البند `SS-07` · `F6-05`).
 * الحالة: منفّذٌ فعليّاً — البند `SS-07`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/notifications
 * يُستخدم من: `notifications-api.ts` و`notifications-view.ts` و
 *   `NotificationsScreen.tsx`.
 * يُتوقع أن يستخدمه لاحقاً: ملحقٌ مِن مُلحقاتِ الصنفِ إن قُدِّمَ لاحقاً.
 *
 * ## لماذا المؤشِّرُ زمنٌ وحدَه لا زمنٌ ومعرّفٌ
 *
 * لأنَّ `GET /v1/notifications` يُقبِلُ `before` بِصيغةِ ISO-8601 لا غيرَه — لا
 * `beforeId`. فلو حملَ المؤشِّرُ معرّفاً آخرَ لكانَ صانعاً معنىً للقيمةِ لا يفهمُه
 * الخادمُ، وعمودُ المؤشِّرِ في تتبُّعِ الطلبِ يُوهِمُ بفرزٍ معرّفٍ نأيِّ هو غيرُ موجود.
 * القاعدةُ المُغلَقةُ (`packages/shared/config/notification-kinds.ts`) مصدرُ الصدقِ
 * الوحيدُ لأسماءِ الأنواعِ.
 *
 * ## وما لا يصفُه هذا المِلفُّ عن قصدٍ
 *
 *   ــ **لا يفكُّ `payload` ولا يُفنِّدُ حقولَه**: الحمولةُ `jsonb` مُختومةٌ مِن
 *      القاعدةِ، ولا عقدَ يحكمُ معاني حقولِ كلِّ نوعٍ، فالعميلُ لا يُركِّبُ نصّاً
 *      من داخلِها. وذاكَ يُترَكُ لقرارِ منتَجٍ يُكتبُ عقدهُ قبلَ أن يُكتبَ عرضُه.
 *   ــ **لا يحملُ عدداً إجماليّاً**: «unread» ما يدخلُ إلا لأنَّ الخادمَ أصدرَه،
 *      ولا يحفظُه المحلُّ «جاهزاً».
 */

/** قائمةُ الأنواعِ المغلقةُ كما وُلِّدَتْ مِن قاعدةِ المصدرِ — لا تُكتبُ باليدِ. */
export type ApiNotificationKind = string;

export interface ApiNotificationItem {
  /** `uuid` كما أصدرَه الخادمُ. */
  readonly id: string;
  /** نوعٌ مِن القائمةِ المغلقةِ (`NOTIFICATION_KINDS`). */
  readonly kind: ApiNotificationKind;
  /** `critical` | `in_app` — قناةُ التسليمِ كما قُبِلَتْ في القاعدةِ. */
  readonly channel: string;
  /** حمولةٌ خامٌّ — لا تُفكُّ في العميلِ. */
  readonly payload: Readonly<Record<string, unknown>>;
  /** لحظةُ الإنشاءِ بِـISO-8601 — هيَ المؤشِّرُ ومصدرُ الفرزِ. */
  readonly created_at: string;
  /** `null` = غيرُ مقروءٍ. ولا يُستبدَلُ بلحظةٍ أخرى. */
  readonly read_at: string | null;
}

export interface NotificationsResponse {
  readonly ok: true;
  readonly unread: number;
  readonly items: readonly ApiNotificationItem[];
}

export interface MarkReadResponse {
  readonly ok: true;
  readonly id: string;
  readonly read_at: string;
  readonly already_read: boolean;
}
