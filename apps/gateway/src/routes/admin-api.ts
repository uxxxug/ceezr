/**
 * الغرض: واجهة JSON الداخلية للوحة الإدارة: ما تحتاجه الصفحة بعد رسمها للتحديث
 *   الحيّ (النظرة العامة، الطلبات الحية، الخريطة) والبحث الموحَّد. محميّة بنفس
 *   حارس الجلسة، فلا باب خلفي بلا مصادقة.
 * الحالة: منفّذ فعلياً — المرحلة 2.7 (القسم د.1).
 * ينتمي إلى: apps/gateway/src/routes
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/index.ts، سكربت الواجهة في layout.ts
 * ملاحظات مستقبلية: عند الحاجة إلى دفعٍ لحظي يُستبدل الاستطلاع بـ SSE على نفس
 *   نماذج القراءة بلا تغيير فيها.
 */

import { Hono } from "hono";
import type { Sql } from "../../../../packages/infrastructure/db/client.ts";
import type { AdminAuthPort } from "../admin/auth.ts";
import { type AdminEnv, createAdminGuard } from "../admin/guard.ts";
import {
  cityPulse,
  DAY_WINDOW_HOURS,
  HEATMAP_CELL_FALLBACK_DEGREES,
  healthSignals,
  heatmap,
  listCities,
  listLiveOrders,
  numericSetting,
  overviewCounters,
  recentAudit,
  SEARCH_LIMIT,
  stallSeconds,
  unifiedSearch,
} from "../admin/queries.ts";

export interface AdminApiDependencies {
  readonly sql: Sql;
  readonly auth: AdminAuthPort;
}

const AUDIT_PREVIEW_LIMIT = 10;
const DEFAULT_HEATMAP_HOURS = 6;

function cityParam(value: string | undefined): string | null {
  return value === undefined || value === "" || value === "all" ? null : value;
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function createAdminApiRoutes(deps: AdminApiDependencies): Hono<AdminEnv> {
  const app = new Hono<AdminEnv>();
  app.use("*", createAdminGuard(deps.auth, "api"));

  app.get("/overview", async (c) => {
    const stall = await stallSeconds(deps.sql, null);
    const [counters, pulse, audit, health] = await Promise.all([
      overviewCounters(deps.sql, DAY_WINDOW_HOURS),
      cityPulse(deps.sql),
      recentAudit(deps.sql, AUDIT_PREVIEW_LIMIT),
      healthSignals(deps.sql, stall),
    ]);
    return c.json({
      ok: true,
      now: new Date().toISOString(),
      windowHours: DAY_WINDOW_HOURS,
      counters,
      cities: pulse,
      recentAudit: audit,
      health,
    });
  });

  app.get("/live-orders", async (c) => {
    const cityId = cityParam(c.req.query("city"));
    const [rows, stall] = await Promise.all([
      listLiveOrders(deps.sql, cityId),
      stallSeconds(deps.sql, cityId),
    ]);
    return c.json({ ok: true, now: new Date().toISOString(), stallSeconds: stall, rows });
  });

  app.get("/heatmap", async (c) => {
    const cityId = cityParam(c.req.query("city"));
    if (cityId === null) {
      return c.json({ ok: false, error: "CITY_REQUIRED" }, 400);
    }
    const windowHours = positiveInt(c.req.query("hours"), DEFAULT_HEATMAP_HOURS);
    const cellDegrees = await numericSetting(
      deps.sql,
      "admin_heatmap_cell_degrees",
      cityId,
      HEATMAP_CELL_FALLBACK_DEGREES,
    );
    const result = await heatmap(deps.sql, cityId, windowHours, cellDegrees);
    return c.json({ ok: true, windowHours, cellDegrees, ...result });
  });

  app.get("/search", async (c) => {
    const term = c.req.query("q") ?? "";
    if (term.trim() === "") return c.json({ ok: true, groups: [] });
    const groups = await unifiedSearch(deps.sql, term, SEARCH_LIMIT);
    return c.json({ ok: true, groups });
  });

  app.get("/cities", async (c) => c.json({ ok: true, cities: await listCities(deps.sql) }));

  return app;
}
