/**
 * الغرض: عقدُ تفضيلاتِ الإشعارات ([B] · R12) — `GET/PUT /v1/me/notification-preferences`
 *   (`apps/gateway/src/routes/me-notification-prefs.ts` · DEC-42) — ونموذجُ عرضٍ نقيّ.
 * الحالة: منفّذ فعلياً — UI-3 / PR 5 (ADR 0238).
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/settings
 *
 * الحقلانِ وحدَهما (`offersEnabled` · `updatesEnabled`) — تفضيلاتٌ **غيرُ تشغيليّة**؛ إشعاراتُ الرحلةِ
 * التشغيليّةُ لا تُطفأ من هنا ولا يُعرَضُ مفتاحٌ يوهمُ بذلك. والحفظُ صريحٌ بزرٍّ، والحالُ بعدَه يُقرأُ من الخادم.
 */

import { apiFetch } from "../../../api/client.ts";

export const NOTIFICATION_PREFS_PATH = "/v1/me/notification-preferences";

export interface NotificationPrefs {
  readonly offersEnabled: boolean;
  readonly updatesEnabled: boolean;
}

export interface NotificationPrefsResponse extends NotificationPrefs {
  readonly ok: true;
}

export function readNotificationPrefs(): Promise<NotificationPrefsResponse> {
  return apiFetch<NotificationPrefsResponse>(NOTIFICATION_PREFS_PATH);
}

export function saveNotificationPrefs(
  prefs: NotificationPrefs,
): Promise<{ readonly ok: true; readonly status: "saved" }> {
  return apiFetch(NOTIFICATION_PREFS_PATH, {
    method: "PUT",
    body: { offersEnabled: prefs.offersEnabled, updatesEnabled: prefs.updatesEnabled },
  });
}

/** هل يختلفُ المسودّةُ عمّا قرأَه الخادم؟ — بلا فرقٍ لا حفظَ يُعرَض. */
export function prefsChanged(saved: NotificationPrefs, draft: NotificationPrefs): boolean {
  return (
    saved.offersEnabled !== draft.offersEnabled || saved.updatesEnabled !== draft.updatesEnabled
  );
}

export const NOTIFICATION_PREF_FIELDS = ["offersEnabled", "updatesEnabled"] as const;
export type NotificationPrefField = (typeof NOTIFICATION_PREF_FIELDS)[number];
