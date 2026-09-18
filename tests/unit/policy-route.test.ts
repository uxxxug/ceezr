/**
 * الغرض: اختباراتُ وحدةٍ لمسارِ السياسةِ `GET /v1/policy` (البند `F12-17`).
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 *
 * ## ما يُختبرُ
 *
 *   ١) يعيد السياسةَ بمدينةٍ موجودةٍ: `commission_rate = 0` و`mechanism = "none"`.
 *   ٢) `400` عندَ غيابِ `city_id`.
 *   ٣) `404` عندَ مدينةٍ غيرِ موجودةٍ.
 *   ٤) `503` عندَ غيابِ تبعياتِ القاعدة.
 *
 * ## ما لا يُدَّعى (`ح-5`)
 *
 *   ــ لا يُختبرُ محرّكُ التسعيرِ — DEC-11/F12-16 يحجبُ ذلك.
 *   ــ لا يُختبرُ السعرُ النهائيُّ — ليسَ مبنيّاً بعدُ.
 */

import { describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { createPolicyRoutes } from "../../apps/gateway/src/routes/policy.ts";

type SqlRow = Record<string, unknown>;

function createMockSql(rowsByQuery: Record<string, SqlRow[]>): unknown {
  return mock(async (strings: TemplateStringsArray) => {
    const query = strings.join("?");
    // match by a distinctive fragment
    for (const [fragment, rows] of Object.entries(rowsByQuery)) {
      if (query.includes(fragment)) {
        return rows;
      }
    }
    return [];
  });
}

describe("F12-17 — GET /v1/policy", () => {
  it("يعيد سياسة العمولة بمدينةٍ موجودةٍ", async () => {
    const sql = createMockSql({
      platform_settings: [
        { key: "commission_rate", value: 0, value_type: "number" },
        { key: "commission_collection_mechanism", value: "none", value_type: "string" },
      ],
    });
    const app = new Hono();
    app.route("/", createPolicyRoutes({ sql: sql as never }));

    const res = await app.request("/v1/policy?city_id=123e4567-e89b-12d3-a456-426614174000");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      error: string;
      policy: { commission_rate: number; commission_collection_mechanism: string };
    };
    expect(body.ok).toBe(true);
    expect(body.policy.commission_rate).toBe(0);
    expect(body.policy.commission_collection_mechanism).toBe("none");
  });

  it("يرفض 400 عند غياب city_id", async () => {
    const sql = createMockSql({});
    const app = new Hono();
    app.route("/", createPolicyRoutes({ sql: sql as never }));

    const res = await app.request("/v1/policy");
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      ok: boolean;
      error: string;
      policy: { commission_rate: number; commission_collection_mechanism: string };
    };
    expect(body.error).toBe("CITY_REQUIRED");
  });

  it("يعيد 404 لمدينةٍ غير موجودةٍ", async () => {
    const sql = createMockSql({ platform_settings: [] });
    const app = new Hono();
    app.route("/", createPolicyRoutes({ sql: sql as never }));

    const res = await app.request("/v1/policy?city_id=nonexistent");
    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      ok: boolean;
      error: string;
      policy: { commission_rate: number; commission_collection_mechanism: string };
    };
    expect(body.error).toBe("CITY_NOT_FOUND");
  });

  it("يعيد 503 عند غياب تبعيات القاعدة", async () => {
    const app = new Hono();
    app.route("/", createPolicyRoutes({}));

    const res = await app.request("/v1/policy?city_id=123e4567-e89b-12d3-a456-426614174000");
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      ok: boolean;
      error: string;
      policy: { commission_rate: number; commission_collection_mechanism: string };
    };
    expect(body.error).toBe("POLICY_NOT_AVAILABLE");
  });
});
