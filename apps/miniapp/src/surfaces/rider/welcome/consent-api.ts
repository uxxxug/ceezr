/**
 * الغرض: بابُ الموافقاتِ عندَ العميلِ — نداءانِ فقط، بلا منطقِ عرضٍ وبلا حالةٍ
 *   محفوظةٍ (البند `F2-01`).
 * الحالة: منفّذ فعلياً — البند `F2-01`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/welcome
 * يُتوقع أن يستخدمه لاحقاً: `WelcomeScreen.tsx` افتراضاً، ويُستبدَلُ في الاختبارِ
 *   بحاقنٍ فلا يُنادى `fetch` في اختبارِ شاشةٍ.
 * ملاحظات مستقبلية: `F2-11` يحتاجُ `GET /v1/me/data` — ويُضافُ ههنا لا في مكوّنٍ.
 *
 * ما لا يفعلُه: لا يُخزِّنُ ردّاً في ذاكرةٍ ولا في `localStorage`، ولا يُعيدُ
 * المحاولةَ من نفسِه، ولا يُمرِّرُ `Idempotency-Key` (تماثُلُ الأمرِ بنيويٌّ في
 * القاعدةِ — ADR 0092)، ولا يبتلعُ خطأً: يرمي كما يرمي حدُّ API.
 */

import { apiFetch } from "../../../api/client.ts";
import type { ConsentApiStatus } from "./consent-view.ts";

export interface RecordConsentResponse {
  readonly ok: true;
  readonly status: "recorded" | "already_recorded";
  readonly acceptedAt: string;
  readonly onboarding: ConsentApiStatus["onboarding"];
}

export function fetchConsentStatus(): Promise<ConsentApiStatus> {
  return apiFetch<ConsentApiStatus>("/v1/consents");
}

export function submitConsent(kind: string, version: string): Promise<RecordConsentResponse> {
  // `accepted: true` صريحةٌ في الجسمِ ولا تُستنتَجُ من كونِ النداءِ حدثَ: الخادمُ
  // يردُّ `NOT_ACCEPTED` على أيِّ قيمةٍ أخرى، وذاكَ يُبقي «وافقَ» ملفوظاً في
  // السجلِّ لا مُستَنبَطاً من وصولِ طلبٍ.
  return apiFetch<RecordConsentResponse>("/v1/consents", {
    method: "POST",
    body: { kind, version, accepted: true },
  });
}
