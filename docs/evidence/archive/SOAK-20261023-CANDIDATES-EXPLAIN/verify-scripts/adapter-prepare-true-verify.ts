import postgres from "/home/user/workspace/ceezr/node_modules/.bun/postgres@3.4.9/node_modules/postgres/src/index.js";
// التحقق الحاسم: المحوّل الفعلي عبر اتصال prepare: true (كما قد يكون في المنتج)
// — هل يظل استعلام المرشحين بلا عبارة مسمّاة؟
// والفرعان معًا، ثم فحص pg_prepared_statements على الاتصال نفسه.
import { createDriverCandidateRepository } from "/home/user/workspace/ceezr/packages/infrastructure/dispatch/dispatch-adapters.ts";

const sql = postgres("postgres://postgres@localhost:55432/ceezr", { prepare: true, max: 1 });
const cityId = (await sql`select id from cities where code = 'JED'`)[0].id as string;
const now = new Date();
const pickup = { latitude: 21.55, longitude: 39.19 };
const repo = createDriverCandidateRepository(sql as never);
const base = { cityId, pickup, searchRadiusKm: 10, limit: 50, now };

// الفرعان عبر المحوّل الفعلي، 10 مرات (تجاوز أي عتبة تحويل خطة)
for (let i = 0; i < 10; i++) {
  const a = await repo.findNearbyAvailableForDispatch({ ...base, driverLocationMaxAgeSeconds: 0 });
  const b = await repo.findNearbyAvailableForDispatch({ ...base, driverLocationMaxAgeSeconds: 120 });
  if (!("ok" in (a as object)) || !("ok" in (b as object))) throw new Error("adapter failed");
}
// استعلام الفحص بلا إعداد كي لا يحسب نفسه (unsafe)
const named = await sql.unsafe(
  "select name, generic_plans, custom_plans from pg_prepared_statements where statement like '%driver_availability%'",
);
console.log("عبارات مسمّاة تلمس driver_availability (اتصال prepare:true عبر المحوّل الفعلي):", named.length);
for (const r of named as unknown[]) console.log("  ", r);
await sql.end({ timeout: 5 });
