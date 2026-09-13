/**
 * الغرض: مسارُ الاقتباسِ — `POST /v1/quote/ride`: مسافةٌ موسومةٌ ومدّةٌ صادقةٌ
 *   وبطاقاتُ خدماتٍ، **بلا أجرةٍ ولا وسيلةِ دفعٍ** (البند `F2-04` · `SR-04` ·
 *   القسم 10.2).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-04` (نصفُه المشروعُ).
 * ينتمي إلى: apps/gateway/src/routes
 * يُستخدم من: `apps/gateway/src/server.ts` عبرَ تركيبٍ اختياريٍّ، وشاشةُ
 *   الاقتباسِ في `apps/miniapp`.
 * يُتوقع أن يستخدمه لاحقاً: `F2-05` يُنشئُ الطلبَ بمسارٍ آخرَ ويستدعي الحكمَ
 *   نفسَه في القاعدةِ، لا نداءً من الخادمِ إلى نفسِه.
 * ملاحظات مستقبلية: حقلُ الأجرةِ لا يُضافُ إلى هذه الحمولةِ قبلَ إغلاقِ `DEC-11`
 *   بسندٍ نظاميٍّ مكتوبٍ؛ ويومَها يُنشَأُ في `F12-16` عقدٌ معَ مصدرِ سياستِه.
 *
 * ## لماذا الرفضُ `200` لا `4xx` — كما في `F2-03`
 *
 * «انطلاقُك خارجَ منطقةِ الخدمةِ» جوابٌ كاملٌ عن سؤالٍ صحيحٍ. و`4xx` تُقرأُ
 * «طلبُك خاطئٌ» فتُخفيها طبقاتُ العميلِ تحتَ «تعذَّرَ الاتصالُ». و`ok` يبقى
 * دلالتَه في المشروعِ: «وصلَ السؤالُ وجُوِّبَ»، و`accepted` هوَ الجوابُ.
 *
 * ## ولماذا رمزانِ للرفضِ الجغرافيِّ لا رمزٌ
 *
 * `ORIGIN_OUTSIDE_SERVICE_AREA` و`DESTINATION_OUTSIDE_SERVICE_AREA` يُنشَرانِ
 * مفصولَينِ لأنَّ فعلَ التصحيحِ مختلفٌ: الأوّلُ «تحرَّكْ أو صحِّحْ دبّوسَك»
 * والثانيُ «اخترْ وجهةً أخرى». ورمزٌ واحدٌ يُنتِجُ شاشةً تنصحُ الراكبَ بتصحيحِ
 * ما لم يُخطئْ فيه.
 *
 * ## وما لا يفعلُه هذا المسارُ عن قصدٍ
 *
 *   ــ **لا يعرفُ سعراً ولا وسيلةَ دفعٍ ولا حقلاً فارغاً لهما**: آليّةُ الأجرةِ
 *      محجوبةٌ على قرارٍ نظاميٍّ (`ADR 0039` §٤)، و`م13-7` يُجمِّدُ الهياكلَ
 *      التمهيديّةَ نصّاً: لا أعمدةَ ولا ترحيلاتٍ ولا واجهاتٍ ولا حقولَ عرضٍ
 *      «جاهزةً للأجرةِ». وحاجزُ `scripts/check-quote-contract.ts` يُسقِطُ CI إن
 *      عادَ أحدُها.
 *   ــ **لا يخترعُ مدّةً**: المدّةُ حكمُ `packages/domain/eta`، وهيَ اليومَ
 *      امتناعٌ `NOT_CONFIGURED` في كلِّ البيئاتِ لأنَّ استضافةَ محرِّكِ توجيهٍ
 *      عملٌ تشغيليٌّ لم يُنجَزْ (`ADR 0024`).
 *   ــ **لا يقرأُ مدينةً من الطلبِ**: المدينةُ من صفِّ المستخدمِ (القاعدة 0.4).
 *   ــ **لا يُعيدُ نصّاً معروضاً**: مفاتيحُ وأعدادٌ ورموزٌ (القسم 9.11).
 *   ــ **لا يُعيدُ حكماً عندَ غيابِ التبعياتِ**: `503` لا `200`.
 */

import { type Context, Hono } from "hono";
import {
  type QuoteDeps,
  type QuotePublicErrorCode,
  type QuoteResult,
  quoteRide,
} from "../../../../packages/application/quote/quote-ride.ts";
import { bearerTokenFrom } from "./me.ts";
import { readBounded } from "./telegram-webhook.ts";

export interface QuoteRouteDependencies {
  /** غيابُها يُعطِّلُ المسارَ بـ503 ولا يجعلُه يُجيبُ بلا تحقّقٍ. */
  readonly quote?: QuoteDeps;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/** أربعةُ حقولٍ عشريّةٍ. حدُّ نقلٍ لا قيمةُ منتَجٍ (القاعدة 0.3). */
export const QUOTE_MAX_BYTES = 512;

const STATUS_BY_ERROR: Readonly<Record<QuotePublicErrorCode, 400 | 401 | 404 | 503>> = {
  SESSION_REQUIRED: 401,
  SESSION_INVALID: 401,
  SESSION_EXPIRED: 401,
  SESSION_NOT_AVAILABLE: 503,
  MALFORMED: 400,
  // الجلسةُ صحيحةٌ ولا صفَّ مستخدمٍ: `404` لا `401`، ولا يُنشَأُ الصفُّ (ADR 0035).
  ACCOUNT_NOT_FOUND: 404,
  QUOTE_STORE_NOT_AVAILABLE: 503,
};

function rejected(c: Context, error: QuotePublicErrorCode) {
  return c.json({ ok: false, error }, STATUS_BY_ERROR[error]);
}

/**
 * الحكمُ كما يُنشَرُ.
 *
 * والمسافةُ تُنشَرُ **كائناً** لا رقماً: `{ kind, meters }`. ولو نُشِرَ الرقمُ
 * وحدَه لَأمكنَ لعميلٍ أن يعرضَه «طولَ الطريقِ»، وقد قاسَ `ADR 0024` فارقاً
 * يبلغُ 2.834 ضِعفاً في أسوأِ زوجٍ مقيسٍ. فالوسمُ يُسافرُ معَ القيمةِ على السلكِ
 * كما يُسافرُ معَها في النوعِ.
 */
function publishQuote(result: QuoteResult) {
  if (!result.accepted) {
    return {
      accepted: false as const,
      refusal: result.refusal,
      city: result.city,
    };
  }
  const { quote } = result;
  return {
    accepted: true as const,
    city: quote.city,
    areaVersion: quote.areaVersion,
    distance: { kind: quote.distance.kind, meters: quote.distance.meters },
    // الامتناعُ يُنشَرُ بسببِه لا يُطوى: «غيرُ متاحةٍ» بلا سببٍ تُقرأُ عطباً.
    eta: quote.eta,
    services: quote.services,
  };
}

export function createQuoteRoutes(deps: QuoteRouteDependencies): Hono {
  const app = new Hono();

  app.post("/v1/quote/ride", async (c) => {
    if (deps.quote === undefined) {
      deps.log?.("quote.route_disabled", {});
      return rejected(c, "QUOTE_STORE_NOT_AVAILABLE");
    }

    const declaredLength = Number(c.req.header("content-length") ?? Number.NaN);
    if (Number.isFinite(declaredLength) && declaredLength > QUOTE_MAX_BYTES) {
      return c.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);
    }
    const raw = await readBounded(c.req.raw.body, QUOTE_MAX_BYTES);
    if (raw === null) return c.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ ok: false, error: "INVALID_JSON" }, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return c.json({ ok: false, error: "INVALID_BODY" }, 400);
    }

    const result = await quoteRide(deps.quote, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      body,
    });
    if (!result.ok) return rejected(c, result.error);

    return c.json({ ok: true, ...publishQuote(result.value) });
  });

  return app;
}
