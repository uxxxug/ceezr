/**
 * الغرض: مسارُ `GET /v1/policy` — يُعيد سياسة العمولة من `platform_settings`
 *   بمدينة الجلسة، مرئيةً للسائق والراكب. البند `F12-17`.
 * الحالة: منفّذ فعلياً — البند `F12-17`.
 * ينتمي إلى: apps/gateway/src/routes
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway/src/server.ts` عبر تركيبٍ اختياريٍّ،
 *   وشاشةُ الحسابِ في `apps/miniapp`.
 *
 * ## لماذا يُقرَأ من القاعدة لا من الكود
 *
 * القاعدة 0.3: كلُّ قيمةٍ تجاريّةٍ في `platform_settings`. نسبةُ العمولةِ وآليّةُ
 * تحصيلِها قيمتانِ تجاريّتانِ تُقرآنِ من القاعدةِ، فلا تُكتبانِ ثابتاً في الشيفرة.
 *
 * ## وما لا يفعله هذا المسارُ عن قصدٍ (`ح-5`)
 *
 *   ــ لا يدَّعي أنَّ السعرَ النهائيَّ محسومٌ: DEC-11/F12-16 يحجبُ ذلك.
 *   ــ لا يدَّعي أنَّ محرّكَ التسعيرِ مبنيٌّ أو أنَّ مزوّدَ الدفعِ محسومٌ.
 *   ــ لا يدَّعي أنَّ العمولةَ معدومةٌ للأبد: بل لـv1/نموذج الاشتراك فقط.
 *   ــ لا يكتبُ قيمةً في القاعدة: قراءةٌ فقط (ADR 0035).
 */

import { type Context, Hono } from "hono";
import type { Sql } from "../../../../packages/infrastructure/db/client.ts";
import type { RateLimiter } from "../rate-limit/fixed-window.ts";
import { clientAddress, rateLimitRejection } from "../rate-limit/guard.ts";

export interface PolicyRouteDependencies {
  /** غيابُها يُعطِّل المسارَ بـ503 ولا يجعلُه يُجيبُ بلا تحقّقٍ. */
  readonly sql?: Sql;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
  /** حدُّ المعدَّلِ للمسارِ العلنيِّ — يُركَّبُ في `index.ts`. */
  readonly perAddress?: RateLimiter;
}

interface PolicySettingRow {
  readonly key: string;
  readonly value: unknown;
  readonly value_type: string;
}

const UNAVAILABLE_STATUS = 503 as const;
const NOT_FOUND_STATUS = 404 as const;

function rejected(c: Context, error: string, status: 400 | 404 | 429 | 503) {
  return c.json({ ok: false, error }, status);
}

export function createPolicyRoutes(deps: PolicyRouteDependencies): Hono {
  const app = new Hono();

  app.get("/v1/policy", async (c) => {
    if (deps.perAddress !== undefined) {
      const decision = await deps.perAddress.hit(
        `policy:${clientAddress(c.req.header("x-forwarded-for"))}`,
      );
      const exceeded = rateLimitRejection(c, decision);
      if (exceeded !== null) return exceeded;
    }
    if (deps.sql === undefined) {
      deps.log?.("policy.route_disabled", {});
      return rejected(c, "POLICY_NOT_AVAILABLE", UNAVAILABLE_STATUS);
    }

    // مدينة الجلسة من query parameter — هذا مسارٌ علنيٌّ لا يتطلّبُ جلسةً
    const cityId = c.req.query("city_id");
    if (cityId === undefined || cityId === "") {
      return rejected(c, "CITY_REQUIRED", 400);
    }

    const rows = await deps.sql<PolicySettingRow[]>`
      select key, value, value_type
        from platform_settings
       where city_id = ${cityId}
         and key in ('commission_rate', 'commission_collection_mechanism')
       order by key
    `;

    if (rows.length === 0) {
      return rejected(c, "CITY_NOT_FOUND", NOT_FOUND_STATUS);
    }

    const settings = new Map<string, unknown>();
    for (const row of rows) {
      settings.set(row.key, row.value);
    }

    const commissionRate = settings.get("commission_rate");
    const collectionMechanism = settings.get("commission_collection_mechanism");

    return c.json({
      ok: true,
      policy: {
        commission_rate: commissionRate !== undefined ? Number(commissionRate) : null,
        commission_collection_mechanism: collectionMechanism ?? null,
        currency: "SAR",
      },
    });
  });

  return app;
}
