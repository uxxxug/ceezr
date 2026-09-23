/**
 * الغرض: إثبات أنّ كل مسارٍ مسجَّلٍ في موجّهات اللوحة يرفض الطلب بلا جلسة —
 *   مُستخرَجاً من الموجّه نفسه لا من قائمةٍ مكتوبةٍ باليد.
 * الحالة: منفّذ فعلياً — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: كل إضافة صفحةٍ أو نداءٍ إلى اللوحة.
 * ملاحظات مستقبلية: يقرأ فقط، ولا يكتب في القاعدة.
 *
 * ## لماذا هذا الاختبار موجود
 *
 * الحماية في اللوحة وسيطٌ واحد: `app.use("*", createAdminGuard(...))`. وHono
 * يُطابق المُعالِجات بترتيب تسجيلها، فمسارٌ يُسجَّل **قبل** سطر الوسيط يُجيب
 * بنفسه ولا يبلغه الحارسُ أصلاً. اليومَ لا يسبقه إلا مسارات الدخول الثلاثة —
 * وهي المستثناة بالقصد — لكنّ حرفاً واحداً في مكان الإضافة يفتح مساراً إدارياً
 * للعالم بلا أن يُخفق اختبارٌ واحد.
 *
 * والاختبار القائم في `admin-dashboard.test.ts` يفحص مساراً واحداً من كلّ
 * موجّه: يُثبت أنّ الحارس يعمل، لا أنّه يغطّي كلّ ما سُجِّل. فهنا تُستخرج
 * قائمةُ المسارات من `app.routes` بعد التركيب، فتنمو القائمةُ مع الموجّه
 * تلقائياً ولا يمكن أن يُضاف مسارٌ يفوته الفحص.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { type AdminAuthPort, createAdminAuthPort } from "../../apps/gateway/src/admin/auth.ts";
import { createAdminApiRoutes } from "../../apps/gateway/src/routes/admin-api.ts";
import { createAdminLiveRoutes } from "../../apps/gateway/src/routes/admin-live.ts";
import { createAdminUiRoutes } from "../../apps/gateway/src/routes/admin-ui.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createTrackingEventBus } from "../../packages/infrastructure/tracking/event-bus.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIf = databaseUrl === undefined ? describe.skip : describe;

const SEE_OTHER = 303;
const UNAUTHORIZED = 401;

/**
 * مسارات الدخول: تُستثنى بالقصد لأنّ الحارس لا يجوز أن يحميَها — من لا جلسةَ له
 * يحتاجها ليدخل. تُذكر صريحةً باسمها لا بنمطٍ عام، فمسارٌ جديد اسمُه يبدأ
 * بـ`/login` لن يُستثنى تلقائياً بل يُضاف هنا بقرارٍ مكتوب.
 */
// `POST /admin/login/break-glass` أُضيف بقرارٍ مكتوبٍ (`SEC-21` · ADR 0176):
// البابُ الموازيَّ يُطرَقُ بلا جلسةٍ بحكمِ تعريفِهِ — والرفضُ الموحَّدُ (422)
// حكمُ القلبِ لا تسريبًا، والإقفالُ والعدُّ في القاعدةِ لا في الذاكرةِ.
const PUBLIC_PATHS = new Set([
  "/admin/login",
  "/admin/login/code",
  "/admin/login/verify",
  "/admin/login/break-glass",
]);

let sql: Sql;
let auth: AdminAuthPort;
let app: Hono;

interface Route {
  readonly method: string;
  readonly path: string;
}

/** مسارات حقيقية فقط: الوسائط مسجَّلةٌ في نفس المصفوفة بمسار `/*` أو `*`. */
function realRoutes(instance: Hono): readonly Route[] {
  const seen = new Set<string>();
  const routes: Route[] = [];
  for (const entry of instance.routes) {
    const method = entry.method.toUpperCase();
    if (method === "ALL") continue;
    if (entry.path.includes("*")) continue;
    const key = `${method} ${entry.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({ method, path: entry.path });
  }
  return routes;
}

/** يستبدل الوسائط بقيمٍ لا تُطابق شيئاً: الرفض يجب أن يسبق أي بحثٍ في القاعدة. */
function concrete(path: string): string {
  return path.replace(/:[^/]+/g, "00000000-0000-0000-0000-000000000000");
}

beforeAll(() => {
  if (databaseUrl === undefined) return;
  sql = createSql({ connectionString: databaseUrl });
  auth = createAdminAuthPort(sql);
  app = new Hono();
  // نفس ترتيب `index.ts`: الأخصّ أولاً — /admin/api/live قبل /admin/api قبل /admin.
  app.route("/admin/api/live", createAdminLiveRoutes({ sql, auth, bus: createTrackingEventBus() }));
  app.route("/admin/api", createAdminApiRoutes({ sql, auth }));
  app.route(
    "/admin",
    createAdminUiRoutes({
      sql,
      auth,
      mapOrigins: [],
      codeSender: { send: async () => true },
    }),
  );
});

afterAll(async () => {
  if (databaseUrl !== undefined) await sql.end({ timeout: 5 });
});

describeIf("حارس اللوحة يغطّي كل مسار مسجَّل", () => {
  it("الموجّهات سجّلت مساراتٍ فعلاً — لا نجاحَ على قائمةٍ فارغة", () => {
    // بلا هذا الشرط يمرّ الاختبار التالي بلا أن يفحص شيئاً لو تغيّر شكل
    // `app.routes` في إصدارٍ لاحق من Hono فصارت القائمةُ فارغة.
    expect(realRoutes(app).length).toBeGreaterThan(20);
  });

  it("كل مسارٍ غير مسارات الدخول يُرفض بلا كعكة جلسة", async () => {
    const leaks: string[] = [];
    for (const route of realRoutes(app)) {
      if (PUBLIC_PATHS.has(route.path)) continue;
      const response = await app.fetch(
        new Request(`http://localhost${concrete(route.path)}`, {
          method: route.method,
          headers: { "user-agent": "integration-test" },
          redirect: "manual",
        }),
      );
      // الصفحات تُحوَّل إلى الدخول، والنداءات تُجيب 401. وما عداهما تسريب:
      // 200 معناه جوابٌ بلا مصادقة، و500 معناه أنّ المُعالِج اشتغل قبل الحارس.
      const rejected = response.status === SEE_OTHER || response.status === UNAUTHORIZED;
      if (!rejected) leaks.push(`${route.method} ${route.path} → ${response.status}`);
    }
    expect(leaks).toEqual([]);
  });

  it("مسارات الدخول تبقى مفتوحةً لمن لا جلسةَ له", async () => {
    const response = await app.fetch(
      new Request("http://localhost/admin/login", {
        headers: { "user-agent": "integration-test" },
        redirect: "manual",
      }),
    );
    expect(response.status).toBe(200);
  });
});
