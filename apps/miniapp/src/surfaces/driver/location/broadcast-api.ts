/**
 * الغرض: نداءُ بثِّ موقعِ السائقِ ومخزنُ السياسةِ المنشورةِ — **مُرسِلٌ واحدٌ**
 *   إلى `POST /v1/driver/location` القائمِ (`F4-01`)، وسياسةٌ تُقرأُ من قراءةِ
 *   المَهمّةِ نفسِها بلا نداءٍ ثانٍ (البند `F3-04`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-04`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/location
 * يُستخدم من: `LocationBroadcast.tsx` · `job-api.ts` (الكاتبُ الوحيدُ للمخزنِ)
 * يُتوقع أن يستخدمه لاحقاً: أيُّ سطحٍ يحتاجُ آخرَ سياسةٍ منشورةٍ — يقرأُ ولا
 *   يكتبُ، فالكاتبُ يبقى واحداً.
 * يحرسُه: scripts/check-location-broadcast-contract.ts
 * الحاكم: docs/adr/0119-a-heartbeat-needs-a-published-reason.md
 *
 * ## لِمَ مخزنٌ في الوحدةِ لا نداءُ سياسةٍ خاصٌّ
 *
 * السياسةُ تُنشَرُ **في جوابِ `GET /v1/driver/job`** الذي تقرؤه الشاشةُ أصلاً،
 * فمسارٌ ثانٍ لها يعني رحلتَينِ إلى الخادمِ في كلِّ دورةٍ وحقيقتَينِ قد تختلفانِ
 * لحظةً. فالقراءةُ الواحدةُ **تكتبُ** آخرَ سياسةٍ ههنا، والباثُّ **يقرأُ** —
 * كاتبٌ واحدٌ وقارئونَ.
 *
 * ## وما لا تفعلُه هذه الوحدةُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تُخزِّنُ موقعاً ولا تُراكِمُ نبضاتٍ للإرسالِ لاحقاً**: طابورٌ محلّيٌّ
 *      يُرسِلُ بعدَ عودةِ الشبكةِ يكتبُ **ماضياً** موضعاً حاضراً، وموقعٌ متأخّرٌ
 *      يُسنِدُ طلباً إلى سائقٍ بعيدٍ. فما فاتَ يُترَكُ، والنبضةُ التاليةُ أصدقُ.
 *   ــ **لا تُقرِّرُ مَتى تبثُّ**: القرارُ في `packages/domain/driver/location-broadcast.ts`
 *      نقيّاً يُقاسُ، وههنا نقلٌ فحسب.
 *   ــ **لا تُعيدُ محاولةً بنفسِها**: التراجعُ حكمُ الدالّةِ النقيّةِ لا حلقةٌ ههنا.
 */

import { apiFetch } from "../../../api/client.ts";
import type { ApiLocationBroadcast } from "../job/job-contract.ts";

/** حمولةُ النبضةِ — أسماءُ حقولِ `F4-01` كما هيَ، ولا حقلَ زائداً يُخترَعُ. */
export interface DriverLocationFixBody {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMeters?: number;
  readonly headingDegrees?: number;
  readonly recordedAtMs?: number;
}

/**
 * جوابُ المُستقبِلِ. و`accepted: false` **ليسَ فشلاً**: `STALE` تعني «وصلَ أحدثُ
 * منها»، وإعادةُ إرسالِها تكرارٌ لا إصلاحٌ (فلا تراجعَ عليها).
 */
export interface DriverLocationAcceptedResponse {
  readonly ok: true;
  readonly accepted: true;
  readonly verdict?: unknown;
  readonly recordedAtMs?: number;
  readonly dispatchable?: boolean;
}

export interface DriverLocationSkippedResponse {
  readonly ok: true;
  readonly accepted: false;
  readonly reason: string;
}

export type DriverLocationResponse = DriverLocationAcceptedResponse | DriverLocationSkippedResponse;

export function postDriverLocation(body: DriverLocationFixBody): Promise<DriverLocationResponse> {
  return apiFetch<DriverLocationResponse>("/v1/driver/location", {
    method: "POST",
    body,
  });
}

/** آخرُ سياسةٍ منشورةٍ، أو `null` إن لم تُقرأْ مَهمّةٌ بعدُ — **غيابٌ لا افتراضٌ**. */
let lastPublishedPolicy: ApiLocationBroadcast | null = null;
const listeners = new Set<(policy: ApiLocationBroadcast) => void>();

/** يُنادى من قراءةِ المَهمّةِ وحدَها — الكاتبُ واحدٌ (القاعدة 0.6). */
export function publishLocationBroadcastPolicy(policy: ApiLocationBroadcast): void {
  lastPublishedPolicy = policy;
  for (const listener of listeners) listener(policy);
}

export function lastLocationBroadcastPolicy(): ApiLocationBroadcast | null {
  return lastPublishedPolicy;
}

export function onLocationBroadcastPolicy(
  listener: (policy: ApiLocationBroadcast) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** للاختبارِ وحدَه: يُعيدُ المخزنَ إلى الغيابِ فلا يتسرَّبُ حالٌ بينَ حالاتٍ. */
export function resetLocationBroadcastPolicy(): void {
  lastPublishedPolicy = null;
  listeners.clear();
}
