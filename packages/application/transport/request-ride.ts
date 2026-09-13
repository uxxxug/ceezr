/**
 * الغرض: حالةُ استخدامِ إنشاءِ الرحلةِ — جلسةٌ موقَّعةٌ، ثمَّ مفتاحُ تكرارٍ مقبولٌ،
 *   ثمَّ إحداثيّتانِ وخدمةٌ معروفةٌ، ثمَّ **نداءٌ واحدٌ ذرّيٌّ** للحكمِ في القاعدةِ
 *   (البند `F2-05` · `SR-05` · `ARCH-006` · القاعدة 0.5).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-05`.
 * ينتمي إلى: packages/application/transport
 * يُستخدم من: `apps/gateway/src/routes/rides.ts`
 * يُتوقع أن يستخدمه لاحقاً: حوارُ الراكبِ في `packages/application/bots/rider-dialog.ts`
 *   حينَ يُهجَّرُ إنشاؤُه المكشوفُ إلى هذا الأمرِ (زيادةٌ لها حجزُها، لا ههنا).
 * ملاحظات مستقبلية: لا يُضافُ سعرٌ ولا وسيلةُ دفعٍ ولا عقوبةُ إلغاءٍ قبلَ
 *   `DEC-11` و`F12-16` (`ADR 0039` §٤ · `م13-7`).
 *
 * **سِفرُ هذا الملفِّ** (يُثبَتُ ولا يُمحى — `ح-1`): كانَ حتّى `main`@`f952b04`
 * **هيكلاً فارغاً** يُصدِّرُ `export {}` ويُعلِنُ عن نفسِه «لا تنفيذَ»، وكانَ
 * الإنشاءُ الحقيقيُّ `insert into orders` مكشوفاً في
 * `packages/infrastructure/transport/order-adapters.ts` بلا مفتاحِ تكرارٍ ولا
 * حكمِ حدِّ خدمةٍ ولا منعِ طلبَينِ نشطَينِ. فهذا الملفُّ **يُفعَّلُ الآنَ** بالبندِ
 * `F2-05`، ويبقى المحوّلُ القديمُ قائماً لحوارِ البوتِ حتّى تُحجَزَ هجرتُه —
 * فالحاجزُ `scripts/check-ride-request-contract.ts` يمنعُ **مسارَ الشبكةِ**
 * أن يعودَ إلى إنشاءٍ بلا مفتاحٍ، ولا يُخفي الدَّينَ الباقيَ.
 *
 * ## لماذا الحكمُ نداءٌ واحدٌ لا سلسلةُ نداءاتٍ
 *
 * «هل المدينةُ تخدمُ؟ وهل النقطتانِ داخلَ الحدِّ؟ وهل للراكبِ رحلةٌ نشطةٌ؟ ثمَّ
 * أنشِئْ» أربعةُ أسئلةٍ عن **لحظةٍ واحدةٍ**. ولو قُسِّمَت نداءاتٍ لَأمكنَ أن
 * يُقرأَ «لا رحلةَ نشطةً» ثمَّ تُنشأَ رحلةٌ من تبويبٍ آخرَ قبلَ الإدراجِ، فيُنشأَ
 * طلبانِ لراكبٍ واحدٍ. فالسلسلةُ كلُّها في معاملةٍ واحدةٍ في المحرِّكِ
 * (القاعدة 0.5)، وههنا **تحضيرُ الأمرِ** لا الحكمُ.
 *
 * ## ولماذا يُفحَصُ المفتاحُ ههنا وهوَ مفحوصٌ في القاعدةِ
 *
 * لأنَّ الفحصَينِ يُجيبانِ سؤالَينِ: النطاقُ يقولُ «هذا المفتاحُ غيرُ مقبولٍ
 * **شكلاً**» فيُرَدُّ قبلَ أن يُشغَلَ اتّصالٌ بالقاعدةِ، والقاعدةُ تقولُ «لا أكتبُ
 * صفّاً بمفتاحٍ ناقصٍ» فتَصدُّ مَن نادى الدالّةَ من غيرِ هذا الطريقِ. ورفعُ أحدِ
 * الفحصَينِ لأنَّ الآخرَ موجودٌ **إضعافُ حاجزٍ** (`ح-7`).
 *
 * ## ما لا تفعلُه هذه الحالةُ عن قصدٍ
 *
 *   ــ **لا تُسنِدُ سائقاً ولا تُخطِرُ أحداً**: الإنشاءُ يُنتِجُ طلباً حالتُه
 *      `searching`، والبثُّ والإسنادُ `F3` بآلةِ حالاتِه.
 *   ــ **لا تخترعُ مفتاحاً عندَ غيابِه**: أمرٌ بلا مفتاحٍ يُرَدُّ برمزٍ مُعلَنٍ.
 *      ومفتاحٌ يختلقُه الخادمُ لكلِّ نداءٍ يُبطِلُ `ARCH-006` نصّاً ومعنًى.
 *   ــ **لا تقرأُ مدينةً من الجسمِ**: المدينةُ من صفِّ صاحبِ الحسابِ (القاعدة 0.4).
 *   ــ **لا تُعيدُ نصّاً معروضاً**: رموزٌ ومعرّفاتٌ وأختامٌ (القسم 9.11).
 */

import { readPlacePoint } from "../../domain/places/place-kinds.ts";
import { isServiceKind } from "../../domain/quote/service-offer.ts";
import { readIdempotencyKey, readRideNotes } from "../../domain/transport/ride-request.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import type {
  RideRequestCommand,
  RideRequestVerdict,
  RideStoreFailure,
} from "./ride-request-ports.ts";

export interface RequestRideDeps {
  readonly sessions: MiniAppSessionReader;
  /** غيابُه يُعطِّلُ المسارَ بـ503 ولا يجعلُه يُجيبُ بلا كتابةٍ. */
  readonly rides: RideRequestCommand;
  readonly now: () => Date;
}

export type RequestRidePublicErrorCode =
  | "SESSION_REQUIRED"
  | "SESSION_INVALID"
  | "SESSION_EXPIRED"
  | "SESSION_NOT_AVAILABLE"
  | "MALFORMED"
  /** الترويسةُ إلزاميّةٌ — ورمزُها **مستقلٌّ** عن `MALFORMED` كي تُشرَحَ للعميلِ. */
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_KEY_INVALID"
  | "UNKNOWN_SERVICE"
  | "NOTES_TOO_LONG"
  | "ACCOUNT_NOT_FOUND"
  | "RIDER_NOT_REGISTERED"
  | "RIDE_STORE_NOT_AVAILABLE";

function sessionErrorFrom(reason: string): RequestRidePublicErrorCode {
  if (reason === "EXPIRED") return "SESSION_EXPIRED";
  if (reason === "NOT_CONFIGURED") return "SESSION_NOT_AVAILABLE";
  return "SESSION_INVALID";
}

export function rideStoreErrorFrom(failure: RideStoreFailure): RequestRidePublicErrorCode {
  if (failure.reason === "USER_NOT_FOUND") return "ACCOUNT_NOT_FOUND";
  if (failure.reason === "RIDER_NOT_REGISTERED") return "RIDER_NOT_REGISTERED";
  return "RIDE_STORE_NOT_AVAILABLE";
}

export async function requestRide(
  deps: RequestRideDeps,
  input: {
    readonly accessToken: string | undefined;
    /** من ترويسةِ `Idempotency-Key` لا من الجسمِ: الأمرُ يُعرَّفُ بنقلِه. */
    readonly idempotencyKey: string | undefined;
    readonly body: unknown;
  },
): Promise<Result<RideRequestVerdict, RequestRidePublicErrorCode>> {
  if (input.accessToken === undefined || input.accessToken.length === 0) {
    return err("SESSION_REQUIRED");
  }
  const session = deps.sessions.read(input.accessToken, deps.now().getTime());
  if (!session.ok) return err(sessionErrorFrom(session.error.reason));

  const key = readIdempotencyKey(input.idempotencyKey);
  if ("refusal" in key) {
    return err(key.refusal === "MISSING" ? "IDEMPOTENCY_KEY_REQUIRED" : "IDEMPOTENCY_KEY_INVALID");
  }

  if (typeof input.body !== "object" || input.body === null || Array.isArray(input.body)) {
    return err("MALFORMED");
  }
  const body = input.body as Record<string, unknown>;

  // عقدُ «إحداثيّةٌ مقبولةٌ» واحدٌ في المشروعِ (`F2-02`) ولا يُكتَبُ ثانياً ههنا.
  const origin = readPlacePoint(body.originLat, body.originLng);
  const destination = readPlacePoint(body.destinationLat, body.destinationLng);
  if (origin === null || destination === null) return err("MALFORMED");

  // خدمةٌ لا يعرفُها النطاقُ تُرَدُّ ههنا: تمريرُها إلى `service_type` يُنتِجُ
  // استثناءَ تحويلٍ مكشوفاً في القاعدةِ يُقرأُ عطباً لا رفضاً.
  if (typeof body.service !== "string" || !isServiceKind(body.service)) {
    return err("UNKNOWN_SERVICE");
  }

  const notes = readRideNotes(body.notes);
  if ("refusal" in notes) {
    return err(notes.refusal === "NOTES_TOO_LONG" ? "NOTES_TOO_LONG" : "MALFORMED");
  }

  const created = await deps.rides.create({
    telegramUserId: session.value.telegramUserId,
    idempotencyKey: key.key,
    service: body.service,
    origin,
    destination,
    notes: notes.notes,
  });
  if (!created.ok) return err(rideStoreErrorFrom(created.error));

  return ok(created.value);
}
