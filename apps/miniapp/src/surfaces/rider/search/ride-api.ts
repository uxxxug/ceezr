/**
 * الغرض: بابُ الرحلةِ عندَ العميلِ — إنشاءٌ بمفتاحِ تكرارٍ، وقراءةُ حالةِ بحثٍ،
 *   وإلغاءٌ؛ بلا منطقِ عرضٍ وبلا حالةٍ محفوظةٍ (البند `F2-05`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-05`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/search
 * يُستخدم من: `SearchScreen.tsx` افتراضاً، ويُستبدَلُ في الاختبارِ بحاقنٍ.
 * يُتوقع أن يستخدمه لاحقاً: `F2-06` يزيدُ `readRide` على النسقِ نفسِه.
 *
 * ## لماذا المفتاحُ **مُعطًى** لا مُولَّدٌ ههنا
 *
 * لأنَّ إعادةَ المحاولةِ يجبُ أن تحملَ المفتاحَ **نفسَه**؛ ولو وُلِّدَ داخلَ دالّةِ
 * النداءِ لَحملَت كلُّ محاولةٍ مفتاحاً جديداً، فكانَ `ARCH-006` حرفاً بلا أثرٍ:
 * ضغطتانِ سريعتانِ ⇒ رحلتانِ. فالتوليدُ عندَ **نيّةِ** الراكبِ (شاشةُ الاقتباسِ)
 * والاستعمالُ ههنا، ويُعادُ بلا تغييرٍ في كلِّ محاولةٍ.
 *
 * ## وما لا يفعلُه
 *
 *   ــ **لا يُخزِّنُ ردّاً**: حالةُ بحثٍ محفوظةٌ محلّيّاً تُقرأُ بعدَ إسنادٍ حصلَ.
 *   ــ **لا يُعيدُ المحاولةَ من نفسِه**: الإعادةُ قرارُ شاشةٍ تعرفُ ما يراه الراكبُ.
 *   ــ **لا يبتلعُ خطأً**: يرمي كما يرمي حدُّ API (`ApiError`/`ApiNetworkError`).
 */

import { apiFetch } from "../../../api/client.ts";
import type {
  CancelRideResponse,
  RequestRideResponse,
  RideSearchResponse,
} from "./ride-contract.ts";

export type * from "./ride-contract.ts";

export interface RequestRideInput {
  readonly idempotencyKey: string;
  readonly service: string;
  readonly originLat: number;
  readonly originLng: number;
  readonly destinationLat: number;
  readonly destinationLng: number;
  /** ملاحظةُ السائقِ — تُطوى إن كانَت فارغةً ولا تُرسَلُ نصّاً فارغاً. */
  readonly notes?: string;
}

export function requestRide(input: RequestRideInput): Promise<RequestRideResponse> {
  const { idempotencyKey, notes, ...rest } = input;
  return apiFetch<RequestRideResponse>("/v1/rides", {
    method: "POST",
    idempotencyKey,
    body: notes === undefined || notes.length === 0 ? rest : { ...rest, notes },
  });
}

export function readRideSearch(orderId: string): Promise<RideSearchResponse> {
  return apiFetch<RideSearchResponse>(`/v1/rides/${encodeURIComponent(orderId)}/search`, {
    method: "GET",
  });
}

export function cancelRide(input: {
  readonly orderId: string;
  readonly idempotencyKey: string;
}): Promise<CancelRideResponse> {
  return apiFetch<CancelRideResponse>(`/v1/rides/${encodeURIComponent(input.orderId)}/cancel`, {
    method: "POST",
    idempotencyKey: input.idempotencyKey,
    body: {},
  });
}
