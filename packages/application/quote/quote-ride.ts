/**
 * الغرض: حالةُ استخدامِ الاقتباسِ — جلسةٌ، ثمَّ إحداثيّتانِ مقبولتانِ، ثمَّ نداءٌ
 *   واحدٌ ذرّيٌّ للحكمِ، ثمَّ مدّةٌ من `packages/domain/eta` وبطاقاتُ خدماتٍ
 *   (البند `F2-04` · `SR-04`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-04` (نصفُه المشروعُ).
 * ينتمي إلى: packages/application/quote
 * يُستخدم من: `apps/gateway/src/routes/quote.ts`
 * يُتوقع أن يستخدمه لاحقاً: `F2-05` يستدعي `quoteRide` قبلَ إنشاءِ الطلبِ ويرفضُ
 *   خدمةً بطاقتُها غيرُ متاحةٍ — الحكمُ في الخادمِ لا في الشاشةِ.
 * ملاحظات مستقبلية: لا يُضافُ سعرٌ ولا وسيلةُ دفعٍ ههنا قبلَ `DEC-11` و`F12-16`.
 *
 * ## لماذا نداءٌ واحدٌ للقاعدةِ
 *
 * المدينةُ وحدُّها وخدماتُها والمسافةُ سؤالٌ واحدٌ عن **لحظةٍ واحدةٍ**. ولو
 * قُسِّمَ أربعةَ نداءاتٍ لَأمكنَ أن تُقرأَ المدينةُ قبلَ تعطيلِها والخدماتُ بعدَه،
 * فيُقتبَسَ لمدينةٍ لا تخدمُ. فالحكمُ في القاعدةِ في نداءٍ واحدٍ (القاعدة 0.5).
 *
 * ## ولماذا تُبنى البطاقاتُ ههنا لا في القاعدةِ
 *
 * القاعدةُ تُجيبُ «مَن يُخدَمُ فعلاً»، وهذا قياسٌ. وأمّا «أيَّ بطاقةٍ يرى الراكبُ
 * ولماذا تُعرَضُ المتعذِّرةُ معطَّلةً» فقرارُ منتَجٍ يتغيَّرُ بالتجربةِ (القاعدة
 * 0.3). فالقياسُ في القاعدةِ والعرضُ في النطاقِ.
 *
 * ## ولماذا المدّةُ امتناعٌ مُعلَنٌ لا رقمٌ
 *
 * `ADR 0024` يمنعُ السرعةَ الثابتةَ ومعاملَ الالتفافِ، ويشترطُ مدّةً من محرِّكِ
 * توجيهٍ حقيقيٍّ، وإلّا **امتناعاً مُصنَّفاً**. ولا محرِّكَ مُستضافاً اليومَ
 * (استضافتُه عملٌ تشغيليٌّ، والخادمُ العامُّ ممنوعٌ)، فـ`estimateArrival` تُعيدُ
 * `NOT_CONFIGURED` بصدقٍ. وهذا الصدقُ **هوَ** المخرَجُ: الشاشةُ تقولُ «المدّةُ
 * غيرُ متاحةٍ» ولا تخترعُ دقائقَ.
 *
 * ## ما لا تفعلُه هذه الحالةُ عن قصدٍ
 *
 * لا تُنشئُ رحلةً ولا تحجزُ سائقاً ولا تكتبُ صفّاً: الاقتباسُ قراءةٌ. ولا تحسبُ
 * مدّةً بنفسِها. ولا تعرفُ أجرةً (`ADR 0039` §٤، `م13-7`).
 */

import { makeCoordinates } from "../../domain/geo/value-objects.ts";
import { readPlacePoint } from "../../domain/places/place-kinds.ts";
import { offersFromServed } from "../../domain/quote/service-offer.ts";
import type { RoutingProvider } from "../../maps/core/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import { estimateArrival } from "../tracking/estimate-arrival.ts";
import type { QuoteJudge, QuoteOutput, QuoteRefusal, QuoteStoreFailure } from "./ports.ts";

export interface QuoteDeps {
  readonly sessions: MiniAppSessionReader;
  readonly judge: QuoteJudge;
  /** `null` = لا محرِّكَ مُهيَّأً؛ وهوَ الحالُ في كلِّ البيئاتِ اليومَ. */
  readonly routing: RoutingProvider | null;
  readonly now: () => Date;
}

export type QuotePublicErrorCode =
  | "SESSION_REQUIRED"
  | "SESSION_INVALID"
  | "SESSION_EXPIRED"
  | "SESSION_NOT_AVAILABLE"
  | "MALFORMED"
  | "ACCOUNT_NOT_FOUND"
  | "QUOTE_STORE_NOT_AVAILABLE";

function sessionErrorFrom(reason: string): QuotePublicErrorCode {
  if (reason === "EXPIRED") return "SESSION_EXPIRED";
  if (reason === "NOT_CONFIGURED") return "SESSION_NOT_AVAILABLE";
  return "SESSION_INVALID";
}

function storeErrorFrom(failure: QuoteStoreFailure): QuotePublicErrorCode {
  if (failure.reason === "USER_NOT_FOUND") return "ACCOUNT_NOT_FOUND";
  return "QUOTE_STORE_NOT_AVAILABLE";
}

/** الرفضُ المقيسُ حمولةٌ ناجحةٌ: سؤالٌ صحيحٌ جوابُه «لا». */
export type QuoteResult =
  | { readonly accepted: true; readonly quote: QuoteOutput }
  | {
      readonly accepted: false;
      readonly refusal: QuoteRefusal;
      readonly city: QuoteOutput["city"] | null;
    };

export async function quoteRide(
  deps: QuoteDeps,
  input: { readonly accessToken: string | undefined; readonly body: unknown },
): Promise<Result<QuoteResult, QuotePublicErrorCode>> {
  if (input.accessToken === undefined || input.accessToken.length === 0) {
    return err("SESSION_REQUIRED");
  }
  const session = deps.sessions.read(input.accessToken, deps.now().getTime());
  if (!session.ok) return err(sessionErrorFrom(session.error.reason));

  if (typeof input.body !== "object" || input.body === null) return err("MALFORMED");
  const body = input.body as Record<string, unknown>;

  // عقدُ «إحداثيّةٌ مقبولةٌ» واحدٌ في المشروعِ (`F2-02`) ولا يُكتَبُ ثانياً ههنا.
  const origin = readPlacePoint(body.originLat, body.originLng);
  const destination = readPlacePoint(body.destinationLat, body.destinationLng);
  if (origin === null || destination === null) return err("MALFORMED");

  const judged = await deps.judge.judge({
    telegramUserId: session.value.telegramUserId,
    origin,
    destination,
  });
  if (!judged.ok) return err(storeErrorFrom(judged.error));

  const verdict = judged.value;
  if (!verdict.accepted) {
    return ok({ accepted: false, refusal: verdict.refusal, city: verdict.city });
  }

  // المدّةُ لا تُحسَبُ ههنا: `estimateArrival` تُعيدُ امتناعاً مُصنَّفاً أو
  // مدّةَ محرِّكٍ، ولا ترفعُ استثناءً (`ADR 0024`).
  // الإحداثيّتانِ قُبِلَتا أعلاه بعقدِ `readPlacePoint`، و`makeCoordinates`
  // يُعيدُ `Result` لا يُهمَلُ: لو فشلَ — وهوَ ما لا يقعُ ههنا — رجعَت المدّةُ
  // امتناعاً `NO_INPUT` ولم يُسقَط الاقتباسُ كلُّه لأجلِ حقلٍ تكميليٍّ.
  const fromPoint = makeCoordinates(origin.lat, origin.lng);
  const toPoint = makeCoordinates(destination.lat, destination.lng);
  const eta = await estimateArrival(
    {
      from: fromPoint.ok ? fromPoint.value : null,
      to: toPoint.ok ? toPoint.value : null,
    },
    { routing: deps.routing },
  );

  return ok({
    accepted: true,
    quote: {
      city: verdict.quote.city,
      areaVersion: verdict.quote.areaVersion,
      distance: verdict.quote.distance,
      eta,
      services: offersFromServed(verdict.quote.servedServices),
    },
  });
}
