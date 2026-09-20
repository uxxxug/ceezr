/**
 * الغرض: مسارا سطحِ الاستغاثةِ في التطبيقِ المصغَّرِ —
 *   `GET /v1/safety/sos` (حكمٌ مقروءٌ قبلَ العرضِ) و
 *   `POST /v1/safety/sos` (ضغطةٌ تُقيِّدُ وتُودِعُ وترجعُ) — البند `F2-10` ·
 *   `SR-14`؛ ومعَهما قراءةُ السائقِ `GET /v1/driver/safety/sos` — البند `PD-020`.
 * الحالة: منفَّذٌ فعليّاً — البندانِ `F2-10` و`PD-020`.
 * ينتمي إلى: apps/gateway/src/routes
 * يُستخدم من: `apps/gateway/src/server.ts` عبرَ تركيبٍ اختياريٍّ، وسطحُ الطوارئِ
 *   في `apps/miniapp/src/surfaces/rider/sos`، وسطحُ المَهمّةِ للسائقِ في
 *   `apps/miniapp/src/surfaces/driver/job`.
 * يُتوقع أن يستخدمه لاحقاً: سطحُ السائقِ — يُركَّبُ بدورٍ آخرَ — وقد صارَ مسارُهُ
 *   ههنا: للسؤالِ نفسِه حاكمٌ واحدٌ ولا يُكتَبُ مسارٌ لجوابٍ آخرَ.
 * الحاكم: docs/adr/0111-sos-surface-is-a-judged-card-not-a-button.md ·
 *   docs/adr/0159-safety-channel-entry-delivery-review-and-driver-cannot-complete.md
 *
 * ## لماذا المسارُ `/v1/safety/sos` لا `/v1/rides/:id/sos`
 *
 * لأنَّ **الطلبَ يُحَلُّ في القاعدةِ** (`ADR 0077`)، فمُعرِّفٌ في المسارِ إمّا
 * مُهمَلٌ — وحقلٌ مُهمَلٌ في مسارٍ يُقرأُ ضماناً وليسَ بضمانٍ — أو مُستعمَلٌ،
 * فيُنقَضُ `ADR 0077` نصّاً: مُعرِّفٌ من مُدخَلٍ خارجيٍّ قد يشيرُ إلى رحلةِ
 * الأمسِ. وسطحُ الاستغاثةِ **ليسَ سطحَ رحلةٍ**: يبقى دقائقَ بعدَ انتهائِها.
 *
 * ## ولماذا الدورُ **مُركَّبٌ لا مقروءٌ من الطلبِ**
 *
 * «أنا سائقٌ» لو قُرِئَ من الجسمِ لَصارَ مُدخَلاً يُزوَّرُ: راكبٌ يُبلِّغُ بصفةِ
 * سائقٍ فيُقرأُ موقعُ سائقٍ لا يعرفُه. فالدورُ يأتي من **تركيبِ السطحِ** في
 * `index.ts`: سطحُ الراكبِ راكبٌ، وسطحُ السائقِ حينَ يُبنى سائقٌ.
 *
 * ## والضغطةُ تُنشَرُ `200` ولو رُفِضَت
 *
 * «انتهت نافذتُكَ» جوابٌ صحيحٌ عن سؤالٍ صحيحٍ، ورمزُ حالةٍ `4xx` يدفعُ العميلَ
 * إلى إعادةِ المحاولةِ بصيغةٍ أخرى — **في لحظةِ خوفٍ**. وأمّا الجلسةُ الساقطةُ
 * والمخزنُ المعطَّلُ فعطبُ طلبٍ أو بيئةٍ، ورمزُ الحالةِ فيها هوَ الجوابُ.
 *
 * ## وما لا يفعلُه هذان المساران عن قصدٍ
 *
 *   ــ **لا يُرجِعانِ نصّاً معروضاً**: رموزٌ وأعدادٌ، والترجمةُ في الواجهةِ.
 *   ــ **لا يُرجِعانِ موقعاً ولا هويّةَ سائقٍ**: البلاغُ يُرسَلُ إلى فريقِ
 *      السلامةِ لا إلى الشاشةِ، والإفصاحُ يقولُ ماذا يُرسَلُ لا يعرضُه.
 *   ــ **لا يتّصلانِ بأحدٍ ولا يفتحانِ `tel:` ولا واتساب** — والمنصّةُ تُفصِحُ
 *      بذلكَ رمزاً (`SOS_NO_PHONE_CALL`) ولا تصمتُ عنه.
 *   ــ **لا يعرفانِ مالاً** (`ADR 0039` §٤ · `م13-7` · `DEC-11`).
 */

import { type Context, Hono } from "hono";
import {
  type ReadSosSurfaceDeps,
  type RequestMiniAppSosDeps,
  readSosSurface,
  requestMiniAppSos,
  type SosSurfacePublicErrorCode,
} from "../../../../packages/application/safety/sos-surface.ts";
import { bearerTokenFrom } from "./me.ts";

export interface SafetyRouteDependencies {
  /** قارئُ الحكمِ — أو `undefined` متى غابَ سرُّ الجلسةِ فيُقرأُ `503`. */
  readonly surface?: ReadSosSurfaceDeps;
  /**
   * قارئُ حكمِ السائقِ (`PD-020` · الشقُّ `ج`) — **حاكمٌ واحدٌ بدورٍ مُركَّبٍ**:
   * `sos_surface_state` تَحُلُّ للدورِ `driver` مَهمّتَهُ الجاريةَ أو الأخيرة، فلا
   * يُكتبُ جوابٌ ثانٍ للسؤالِ نفسِه ولا يُقرأُ الدورُ من الطلبِ.
   */
  readonly driverSurface?: ReadSosSurfaceDeps;
  /** آمرُ الضغطةِ — **كائنٌ آخرُ**: القارئُ لا يملكُ حقَّ تقييدِ حادثٍ. */
  readonly trigger?: RequestMiniAppSosDeps;
  readonly log?: (event: string, fields: Record<string, unknown>) => void;
}

/** خريطةُ الحالاتِ — **شاملةٌ حرفاً** لاتّحادِ رموزِ السطحِ. */
const STATUS_BY_ERROR: Readonly<Record<SosSurfacePublicErrorCode, 401 | 404 | 503>> = {
  SESSION_REQUIRED: 401,
  SESSION_EXPIRED: 401,
  SESSION_INVALID: 401,
  SESSION_NOT_AVAILABLE: 503,
  ACCOUNT_NOT_FOUND: 404,
  SAFETY_STORE_NOT_AVAILABLE: 503,
};

function rejected(c: Context, error: SosSurfacePublicErrorCode) {
  return c.json({ ok: false, error }, STATUS_BY_ERROR[error]);
}

export function createSafetyRoutes(deps: SafetyRouteDependencies): Hono {
  const app = new Hono();

  /**
   * حكمُ السطحِ قبلَ العرضِ. **قراءةٌ واحدةٌ** تحملُ الجوازَ وسببَه والبلاغَ
   * القائمَ وعُمرَه والإفصاحَ — فلا تُرسَمُ الشاشةُ من ثلاثِ لحظاتٍ مختلفةٍ.
   */
  app.get("/v1/safety/sos", async (c) => {
    if (deps.surface === undefined) {
      deps.log?.("safety.sos_read_disabled", {});
      return rejected(c, "SAFETY_STORE_NOT_AVAILABLE");
    }

    const result = await readSosSurface(deps.surface, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
    });
    if (!result.ok) return rejected(c, result.error);

    const read = result.value;
    if (!read.found) return c.json({ ok: true, found: false as const, refusal: read.refusal });

    const s = read.state;
    const incident =
      s.incident === null
        ? null
        : {
            id: s.incident.incidentId,
            status: s.incident.status,
            // `PD-020` — «استُقبِلَ» قبلَ «اطَّلعَ»: حالُ التسليمِ يُنشرُ معَ الحالةِ،
            // فالسردُ المفصولُ يُشتَقُّ في الواجهةِ من الحقلَينِ معاً لا من حالةٍ واحدةٍ
            // تقولُ ما لا تعرفُهُ.
            teamDeliveryStatus: s.incident.teamDeliveryStatus,
            // بساعةِ القاعدةِ حرفاً: ساعةُ الجهازِ تُضبَطُ يدوياً وقد تُخالِفُ.
            ageSeconds: s.incident.ageSeconds,
          };

    if (!s.eligible) {
      return c.json({
        ok: true,
        found: true as const,
        eligible: false as const,
        reason: s.reason,
        incident,
        disclosure: s.disclosure,
      });
    }
    // `F12-03` — بلاغٌ بلا رحلةٍ: **حقولُ النافذةِ تُحجَبُ ولا تُنشَرُ أصفاراً**،
    // فرقمٌ منشورٌ في حالٍ لا تحكمُها نافذةٌ يُقرأُ وعداً مضبوطاً وهوَ حَشوٌ.
    if (s.origin === "NO_ORDER") {
      return c.json({
        ok: true,
        found: true as const,
        eligible: true as const,
        orderId: null,
        origin: s.origin,
        incident,
        disclosure: s.disclosure,
      });
    }
    return c.json({
      ok: true,
      found: true as const,
      eligible: true as const,
      orderId: s.orderId,
      origin: s.origin,
      postRideWindowMinutes: s.postRideWindowMinutes,
      // مصدرُ القيمةِ باسمِه: رقمٌ بلا مصدرٍ يُقرأُ وعداً مضبوطاً وهوَ افتراضٌ.
      postRideWindowSource: s.postRideWindowSource,
      incident,
      disclosure: s.disclosure,
    });
  });

  /**
   * حكمُ السطحِ **بدورِ السائقِ** (`PD-020` · الشقُّ `ج`) — نفسُ الحاكمِ ونفسُ
   * شكلِ الجوابِ، والدورُ **مُركَّبٌ** لا مقروءٌ من الطلبِ: «أنا سائقٌ» لو
   * قُرِئَ من الجسمِ لَصارَ مُدخَلاً يُزوَّرُ. يَحُلُّ للسائقِ مَهمّتَهُ الجاريةَ
   * — التي عندها يُقرأُ سردُ بلاغِ «تعذّرَ الإكمالُ» في شاشةِ المَهمّةِ — أو
   * آخرَ مَهمّةٍ انتهَت ضمنَ نافذتِها.
   */
  app.get("/v1/driver/safety/sos", async (c) => {
    if (deps.driverSurface === undefined) {
      deps.log?.("safety.driver_sos_read_disabled", {});
      return rejected(c, "SAFETY_STORE_NOT_AVAILABLE");
    }

    const result = await readSosSurface(deps.driverSurface, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
    });
    if (!result.ok) return rejected(c, result.error);

    const read = result.value;
    if (!read.found) return c.json({ ok: true, found: false as const, refusal: read.refusal });

    const s = read.state;
    const incident =
      s.incident === null
        ? null
        : {
            id: s.incident.incidentId,
            status: s.incident.status,
            teamDeliveryStatus: s.incident.teamDeliveryStatus,
            ageSeconds: s.incident.ageSeconds,
          };

    if (!s.eligible) {
      return c.json({
        ok: true,
        found: true as const,
        eligible: false as const,
        reason: s.reason,
        incident,
        disclosure: s.disclosure,
      });
    }
    if (s.origin === "NO_ORDER") {
      return c.json({
        ok: true,
        found: true as const,
        eligible: true as const,
        orderId: null,
        origin: s.origin,
        incident,
        disclosure: s.disclosure,
      });
    }
    return c.json({
      ok: true,
      found: true as const,
      eligible: true as const,
      orderId: s.orderId,
      origin: s.origin,
      postRideWindowMinutes: s.postRideWindowMinutes,
      postRideWindowSource: s.postRideWindowSource,
      incident,
      disclosure: s.disclosure,
    });
  });

  /**
   * الضغطةُ. **لا جسمَ لها ولا مُعرِّفَ**: الطلبُ يُحَلُّ في القاعدةِ تحتَ
   * القفلِ (`ADR 0077`). و`created:false` تعني «بلاغُكَ الأوّلُ ما يزالُ قائماً»
   * لا «لم يحدثْ شيءٌ» — والفرقُ يراهُ الضاغطُ فلا يُعيدُ الضغطَ ظنّاً أنّه ضاعَ.
   */
  app.post("/v1/safety/sos", async (c) => {
    if (deps.trigger === undefined) {
      deps.log?.("safety.sos_trigger_disabled", {});
      return rejected(c, "SAFETY_STORE_NOT_AVAILABLE");
    }

    const result = await requestMiniAppSos(deps.trigger, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
    });
    if (!result.ok) return rejected(c, result.error);

    const outcome = result.value;
    if (!outcome.accepted) {
      return c.json({ ok: true, accepted: false as const, refusal: outcome.refusal });
    }
    return c.json({
      ok: true,
      accepted: true as const,
      incidentId: outcome.incidentId,
      created: outcome.created,
    });
  });

  return app;
}
