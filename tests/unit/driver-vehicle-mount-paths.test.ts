/**
 * الغرض: قياسُ **ما يُخدَمُ فعلاً** من موجِّهِ مركبةِ السائقِ — أنَّ
 *   `/v1/driver/vehicle` و`/v1/driver/vehicle/assets` تُصيبُ معالِجاً، وأنَّ الجِذرَ
 *   `/` و`/assets` **لا يُصيبانِ شيئاً** (`F3-07` · `SEC-07`).
 * الحالة: منفّذ فعلياً — 2026-09-17.
 * ينتمي إلى: tests/unit
 * يُستخدَمُ من: `bun test tests/unit` في `verify`.
 * يحرسُه: نفسُه.
 * الحاكم: `docs/adr/0139-an-unlisted-exposed-route-is-an-unlimited-route.md`
 *
 * ## لِمَ وُجِدَ هذا الملفُّ
 *
 * لأنَّ الموجِّهَ كانَ يُسجِّلُ `"/"` و`"/assets"` ويُركَّبُ على `"/"`، فكانَ المخدومُ
 * `GET /` بينما الوثيقةُ والشاشةُ والحاجزُ الساكنُ `check-driver-vehicle-contract`
 * كلُّها تقولُ `/v1/driver/vehicle` — **وكلُّها كانَت صادقةً في نصِّها كاذبةً في
 * أثرِها**، إذ لم يُنادِ أحدٌ الموجِّهَ في اختبارٍ قطُّ. وحاجزٌ يقرأُ النصَّ لا يرى
 * ما يفعلُه `app.route`؛ فالقياسُ ههنا **على الردِّ**.
 *
 * ## وما لا يقيسُه هذا الملفُّ عن قصدٍ
 *
 * - **لا يقيسُ منطقَ المركبةِ**: التبعيّةُ غائبةٌ فالجوابُ `503` — والمقيسُ
 *   **إصابةُ المعالِجِ** لا نتيجتُه. و`503` ههنا دليلٌ أقوى من `200`: يُثبِتُ أنَّ
 *   المسارَ مُسجَّلٌ وأنَّ الفشلَ مُغلَقٌ عندَ غيابِ التبعيّةِ.
 * - **لا يُركِّبُ `server.ts`**: التركيبُ على `"/"` ثمَّ، ومسارُ الموجِّهِ مطلقٌ ههنا،
 *   فقياسُ الموجِّهِ وحدَه يُطابِقُ ما يُخدَمُ.
 */

import { describe, expect, test } from "bun:test";
import {
  createDriverVehicleRoutes,
  VEHICLE_ASSETS_PATH,
  VEHICLE_BASE_PATH,
} from "../../apps/gateway/src/routes/driver-vehicle.ts";

const app = createDriverVehicleRoutes({});

function call(method: string, path: string): Response | Promise<Response> {
  return app.fetch(
    new Request(`http://gate.test${path}`, {
      method,
      headers: { authorization: "Bearer x", "content-type": "application/json" },
      ...(method === "GET" ? {} : { body: "{}" }),
    }),
  );
}

describe("مساراتُ مركبةِ السائقِ تُخدَمُ حيثُ توصفُ (F3-07)", () => {
  test("المساراتُ المُعلَنةُ هيَ ما توصفُه الوثيقةُ وتُناديه الشاشةُ", () => {
    expect(VEHICLE_BASE_PATH).toBe("/v1/driver/vehicle");
    expect(VEHICLE_ASSETS_PATH).toBe("/v1/driver/vehicle/assets");
  });

  test("GET و PATCH على /v1/driver/vehicle يُصيبانِ معالِجاً (503 لا 404)", async () => {
    expect((await call("GET", VEHICLE_BASE_PATH)).status).toBe(503);
    expect((await call("PATCH", VEHICLE_BASE_PATH)).status).toBe(503);
  });

  test("POST على /v1/driver/vehicle/assets يُصيبُ معالِجاً (503 لا 404)", async () => {
    expect((await call("POST", VEHICLE_ASSETS_PATH)).status).toBe(503);
  });

  test("الجِذرُ لا يُخدَمُ — وهذا هوَ العيبُ الذي كانَ قائماً", async () => {
    expect((await call("GET", "/")).status).toBe(404);
    expect((await call("PATCH", "/")).status).toBe(404);
    expect((await call("POST", "/assets")).status).toBe(404);
  });
});
