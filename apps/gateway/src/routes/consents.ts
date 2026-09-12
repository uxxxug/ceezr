/**
 * الغرض: مسارا الموافقاتِ — `GET /v1/consents` يقولُ الوثائقَ الجاريةَ وحالةَ
 *   صاحبِ الجلسةِ منها، و`POST /v1/consents` يُسجِّلُ موافقةً واحدةً بختمِ الخادمِ
 *   (البند `F2-01` · SR-01 · القسم 9.12).
 * الحالة: منفّذ فعلياً — البند `F2-01`.
 * ينتمي إلى: apps/gateway/src/routes
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway/src/server.ts` عبرَ تركيبٍ اختياريٍّ،
 *   وشاشةُ الترحيبِ في `apps/miniapp`.
 * ملاحظات مستقبلية: حدُّ المعدَّلِ لكلِّ مستخدمٍ ومسارٍ (القسم 10) بلا أرقامٍ في
 *   العقدِ فلا يُخترَعُ ههنا؛ و`request-id` في كلِّ ردٍّ بندُ `F1-08` وهوَ قائمٌ
 *   في الوسيطِ لا في هذا الملفِّ.
 *
 * ## لماذا لا يُطلَبُ `Idempotency-Key` على هذا الأمرِ
 *
 * القسم 9.8 يقولُ «كلُّ أمرٍ تجاريٍّ يحملُ `Idempotency-Key`»، والغرضُ منه أن لا
 * يُنشِئَ نداءٌ مُعاداً أثراً ثانياً. وتماثُلُ هذا الأمرِ **بنيويٌّ** لا بترويسةٍ:
 * المفتاحُ الفريدُ `(user_id, kind, version)` في القاعدةِ يجعلُ النداءَ الثانيَ لا
 * يُنشِئُ صفّاً ولا يُحرِّكُ ختمَ الأوّلِ، ويُعيدُ `already_recorded` صريحاً.
 * فترويسةٌ تُطلَبُ ثمَّ لا تُستشارُ **حراسةٌ صوريّةٌ**، وترويسةٌ تُستشارُ تُضيفُ
 * جدولَ مفاتيحٍ ثانياً يمكنُ أن يختلفَ حكمُه عن حكمِ الفريدِ. فلا تُطلَبُ ولا
 * تُقرأُ، وهذا مكتوبٌ ههنا لا مسكوتٌ عنه (ADR 0092).
 *
 * ## وما لا يفعلُه هذانِ المسارانِ عن قصدٍ
 *
 *   ــ **لا يقرأانِ هويّةً من الطلبِ**: لا معرّفَ مستخدمٍ ولا مدينةً ولا دوراً.
 *   ــ لا يقبلانِ ختماً زمنيّاً من العميلِ: الختمُ من الخادمِ (`F2-01` «مسجَّلٌ»).
 *   ــ لا يُعيدانِ نصَّ وثيقةٍ: مفاتيحُ نصٍّ وحدَها (9.11)، والترجمةُ عندَ العميلِ.
 *   ــ لا يُسجِّلانِ إذنَ موقعٍ ولا يطلبانِه (9.12 · ADR 0093).
 *   ــ لا يُعيدانِ جسماً فارغاً عندَ غيابِ التبعياتِ: `503` لا `200`.
 */

import { type Context, Hono } from "hono";
import {
  type ConsentDeps,
  type ConsentPublicErrorCode,
  readConsentStatus,
  recordConsent,
} from "../../../../packages/application/consent/record-consent.ts";
import { bearerTokenFrom } from "./me.ts";
import { readBounded } from "./telegram-webhook.ts";

export interface ConsentRouteDependencies {
  /** غيابُها يُعطِّلُ المسارَينِ بـ503 ولا يجعلُهما يُجيبانِ بلا تحقّقٍ. */
  readonly consent?: ConsentDeps;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/**
 * جسمُ الطلبِ ثلاثةُ حقولٍ قصيرةٍ. الحدُّ مُعلَنٌ ههنا لأنَّه حدُّ نقلٍ لا قيمةٌ
 * تجاريّةٌ (القاعدة 0.3): لا مدينةَ تُغيِّرُه ولا مالكَ يُساوِمُ عليه.
 */
export const CONSENT_MAX_BYTES = 1024;

const STATUS_BY_ERROR: Readonly<Record<ConsentPublicErrorCode, 400 | 401 | 404 | 503>> = {
  SESSION_REQUIRED: 401,
  SESSION_INVALID: 401,
  SESSION_EXPIRED: 401,
  SESSION_NOT_AVAILABLE: 503,
  // طلبٌ سليمُ الشكلِ يصفُ وثيقةً لا نعرفُها أو إصداراً ليسَ الجاريَ: خطأُ طلبٍ
  // لا خطأُ خادمٍ، و`409` لا يُستعمَلُ — لا تعارضَ حالةٍ ههنا بل مدخلٌ مرفوضٌ.
  UNKNOWN_DOCUMENT: 400,
  VERSION_NOT_CURRENT: 400,
  NOT_ACCEPTED: 400,
  MALFORMED: 400,
  // الجلسةُ صحيحةٌ ولا صفَّ مستخدمٍ: `404` لا `401` — الرمزُ ليسَ هوَ المُشكِلَ،
  // ولا `403` فلا منعَ ههنا. ولا يُنشَأُ الصفُّ (ADR 0035).
  ACCOUNT_NOT_FOUND: 404,
  CONSENT_STORE_NOT_AVAILABLE: 503,
};

function rejected(c: Context, error: ConsentPublicErrorCode) {
  return c.json({ ok: false, error }, STATUS_BY_ERROR[error]);
}

export function createConsentRoutes(deps: ConsentRouteDependencies): Hono {
  const app = new Hono();

  app.get("/v1/consents", async (c) => {
    if (deps.consent === undefined) {
      deps.log?.("consent.route_disabled", {});
      return rejected(c, "CONSENT_STORE_NOT_AVAILABLE");
    }

    const accessToken = bearerTokenFrom(c.req.header("authorization"));
    const result = await readConsentStatus(deps.consent, { accessToken });
    if (!result.ok) return rejected(c, result.error);

    return c.json({
      ok: true,
      documents: result.value.documents,
      onboarding: result.value.onboarding,
    });
  });

  app.post("/v1/consents", async (c) => {
    if (deps.consent === undefined) {
      deps.log?.("consent.route_disabled", {});
      return rejected(c, "CONSENT_STORE_NOT_AVAILABLE");
    }

    const declaredLength = Number(c.req.header("content-length") ?? Number.NaN);
    if (Number.isFinite(declaredLength) && declaredLength > CONSENT_MAX_BYTES) {
      return c.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);
    }
    const raw = await readBounded(c.req.raw.body, CONSENT_MAX_BYTES);
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

    // الحقولُ تُمرَّرُ كما وصلَت (`unknown`) ولا تُخشَّنُ ههنا: القبولُ قرارُ
    // النطاقِ، فلو حُوِّلَ `accepted` إلى `Boolean(...)` ههنا لصارَ `"false"`
    // موافقةً. والتخشينُ في الحدِّ هوَ كيفَ تُسجَّلُ موافقةٌ لم تُقَلْ.
    const record = body as Record<string, unknown>;
    const result = await recordConsent(deps.consent, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      submission: {
        kind: typeof record.kind === "string" ? record.kind : "",
        version: typeof record.version === "string" ? record.version : "",
        accepted: record.accepted,
      },
    });
    if (!result.ok) return rejected(c, result.error);

    return c.json({
      ok: true,
      status: result.value.status,
      acceptedAt: new Date(result.value.acceptedAtMs).toISOString(),
      onboarding: result.value.onboarding,
    });
  });

  return app;
}
