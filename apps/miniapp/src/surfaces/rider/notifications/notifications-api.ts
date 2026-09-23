/**
 * الغرض: نداءا المركزِ — `GET /v1/notifications` و`POST /v1/notifications/:id/read`
 *   — سطرانِ فوقَ حدِّ API ولا منطقَ عرضٍ (البند `SS-07` · `F6-05`).
 * الحالة: منفّذٌ فعليّاً — البند `SS-07`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/notifications
 * يُستخدم من: `NotificationsScreen.tsx`.
 *
 * ## لماذا المؤشِّرُ يُرسَلُ كنصٍّ خامٍّ
 *
 * لأنَّ القاعدةَ تقولُ: «مؤشِّرٌ غيرُ صالحٍ يُخفِقُ ولا يُهمَل». فلا تُهدَّمُ
 * القيمةُ في العميلِ بصيغةٍ يقترحُ صحّتها، بل تُرسَلُ كما هيَ ليُحكَمَ عليها في
 * موضعٍ واحدٍ (القاعدة 0.6).
 *
 * ## وما لا يفعلُه عن قصدٍ
 *
 *   ــ **لا يُدمِجُ صفحاتٍ ولا يحتفظُ بمؤشِّرٍ**: الحالةُ ملكُ الشاشةِ.
 *   ــ **لا يستقصي دوريّاً**: الموجَزُ لحظةٌ لا يتحرَّكُ بنفسِه.
 *   ــ **لا يبتلعُ خطأً**: يرمي كما يرمي حدُّ API.
 */

import { apiFetch } from "../../../api/client.ts";
import type { MarkReadResponse, NotificationsResponse } from "./notifications-contract.ts";

export type * from "./notifications-contract.ts";

export function readNotifications(input: {
  readonly limit?: number;
  readonly before?: string;
}): Promise<NotificationsResponse> {
  const params = new URLSearchParams();
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  if (input.before !== undefined && input.before.length > 0) params.set("before", input.before);
  const query = params.toString();
  return apiFetch<NotificationsResponse>(
    `/v1/notifications${query.length > 0 ? `?${query}` : ""}`,
    { method: "GET" },
  );
}

export function markNotificationRead(notificationId: string): Promise<MarkReadResponse> {
  return apiFetch<MarkReadResponse>(
    `/v1/notifications/${encodeURIComponent(notificationId)}/read`,
    { method: "POST" },
  );
}
