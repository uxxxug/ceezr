/**
 * الغرض: حالةُ استخدامِ إلغاءِ الرحلةِ من شاشةِ البحثِ — جلسةٌ موقَّعةٌ، ثمَّ
 *   مفتاحُ تكرارٍ مقبولٌ شكلاً، ثمَّ تفويضٌ إلى الإلغاءِ الذرّيِّ في القاعدةِ
 *   (البند `F2-05` · `SR-05`: «إلغاءٌ بلا عقوبةٍ قبلَ الإسنادِ»).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-05`.
 * ينتمي إلى: packages/application/transport
 * يُستخدم من: `apps/gateway/src/routes/rides.ts`
 * يُتوقع أن يستخدمه لاحقاً: `F2-06` يزيدُ إلغاءً بعدَ الإسنادِ بسياستِه، ويقرأُ
 *   الرمزَ `ORDER_NOT_CANCELLABLE` نفسَه ولا يخترعُ رمزاً ثانياً.
 * ملاحظات مستقبلية: **لا تُضافُ عقوبةٌ** ههنا. ومتى صدرَ `DEC-11` بسندٍ نظاميٍّ
 *   فموضعُ أثرِها عقدٌ جديدٌ في `F12-16`، لا حقلٌ يُدَسُّ في هذا الجوابِ.
 *
 * **سِفرُ هذا السطحِ** (`ح-1`): الإلغاءُ الذرّيُّ مكتوبٌ منذُ `20260906040000`
 * في `cancel_order_by_rider`، وكانَ يُنادى من حوارِ البوتِ وحدَه
 * (`packages/application/bots/rider-dialog.ts`) بمعرّفِ الراكبِ الداخليِّ.
 * و`packages/application/transport/cancel-ride.ts` هيكلٌ فارغٌ **يبقى كما هوَ**:
 * ملفٌّ جديدٌ أصدقُ من هيكلٍ يُعادُ تعريفُه، لأنَّ اسمَه العامَّ سيُطلَبُ لإلغاءٍ
 * أعمَّ (إلغاءُ سائقٍ، إلغاءٌ إداريٌّ) لا لهذا السطحِ وحدَه.
 *
 * ## لماذا الترويسةُ مطلوبةٌ وإن كانَ الإلغاءُ آمنَ التكرارِ
 *
 * `ARCH-006` يشترطُ أن يحملَ **كلُّ أمرٍ خارجيٍّ** مفتاحَ تكرارٍ، ولا يستثني ما
 * كانَ آمناً اليومَ. والإلغاءُ آمنُ التكرارِ **بطبيعتِه**: الثانيةُ ترتدُّ
 * `ORDER_NOT_CANCELLABLE` من قفلِ الدالّةِ، فلا يُكتَبُ أثرٌ مزدوجٌ ولا يُخطَرُ
 * سائقٌ مرّتَينِ. فالمفتاحُ يُطلَبُ ويُفحَصُ **ولا يُخزَّنُ عموداً**: عمودُ
 * تكرارٍ لأمرٍ لا يحتاجُه هيكلٌ تمهيديٌّ لا مقتضًى، ونحنُ نُعلِنُ السببَ بدلَ
 * أن نُخفيَ أحدَ الأمرَينِ.
 *
 * ## ما لا تفعلُه هذه الحالةُ عن قصدٍ
 *
 *   ــ **لا تكتبُ سجلّاً ولا تُخطِرُ سائقاً**: كلُّه في المعاملةِ الذرّيّةِ نفسِها
 *      (`BUG-004`)؛ وفعلُه ههنا يُنتِجُ إخطاراً عن إلغاءٍ قد ترتدُّ معاملتُه.
 *   ــ **لا تقرأُ حالةَ الرحلةِ أوّلاً لتقرِّرَ**: القراءةُ ثمَّ الكتابةُ نافذةُ
 *      سباقٍ يقبلُ فيها سائقٌ الرحلةَ (القاعدة 0.5) — القفلُ في القاعدةِ يحسمُ.
 *   ــ **لا تعرفُ عقوبةً ولا رسماً ولا حقلاً فارغاً لهما** (`ADR 0039` §٤ · `م13-7`).
 */

import { readIdempotencyKey } from "../../domain/transport/ride-request.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import { type RequestRidePublicErrorCode, rideStoreErrorFrom } from "./request-ride.ts";
import type { RideCancelCommand, RideCancelVerdict } from "./ride-request-ports.ts";

export interface CancelRideRequestDeps {
  readonly sessions: MiniAppSessionReader;
  readonly canceller: RideCancelCommand;
  readonly now: () => Date;
}

export async function cancelRideRequest(
  deps: CancelRideRequestDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly idempotencyKey: string | undefined;
    readonly orderId: string;
  },
): Promise<Result<RideCancelVerdict, RequestRidePublicErrorCode>> {
  if (input.accessToken === undefined || input.accessToken.length === 0) {
    return err("SESSION_REQUIRED");
  }
  const session = await deps.sessions.read(input.accessToken, deps.now().getTime());
  if (!session.ok) {
    const reason = session.error.reason;
    if (reason === "EXPIRED") return err("SESSION_EXPIRED");
    if (reason === "NOT_CONFIGURED") return err("SESSION_NOT_AVAILABLE");
    return err("SESSION_INVALID");
  }

  const key = readIdempotencyKey(input.idempotencyKey);
  if ("refusal" in key) {
    return err(key.refusal === "MISSING" ? "IDEMPOTENCY_KEY_REQUIRED" : "IDEMPOTENCY_KEY_INVALID");
  }

  const cancelled = await deps.canceller.cancel({
    telegramUserId: session.value.telegramUserId,
    orderId: input.orderId,
  });
  if (!cancelled.ok) return err(rideStoreErrorFrom(cancelled.error));
  return ok(cancelled.value);
}
