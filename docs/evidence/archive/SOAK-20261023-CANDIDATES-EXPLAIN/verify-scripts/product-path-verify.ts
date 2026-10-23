// التحقق الكامل بمسار المنتج: النص الحقيقي من المحوّل عبر postgres.js unsafe
// + فحص pg_prepared_statements (لا عبارة مسمّاة) + EXPLAIN الخطة.
import postgres from "/home/user/workspace/ceezr/node_modules/.bun/postgres@3.4.9/node_modules/postgres/src/index.js";

// استخراج النصّين الحرفيين من ملف المحوّل نفسه (لا نسخ يدوي)
const src = await Bun.file("/home/user/workspace/ceezr/packages/infrastructure/dispatch/dispatch-adapters.ts").text();
function extractConst(name: string): string {
  const m = src.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`));
  if (!m) throw new Error(`${name} not found`);
  return m[1];
}
const SQL_PLAIN = extractConst("CANDIDATES_NEARBY_SQL");
const SQL_MAX_AGE = extractConst("CANDIDATES_NEARBY_SQL_WITH_MAX_AGE");

const sql = postgres("postgres://postgres@localhost:55432/ceezr", { prepare: false, max: 1 });
const city = await sql`select id from cities where code = 'JED'`;
const cityId = city[0].id as string;
const now = new Date();

const paramsPlain = [cityId, 39.19, 21.55, 10000, 39.19, 21.55, 50];
const paramsAge = [cityId, 39.19, 21.55, 10000, now, 120, 39.19, 21.55, 50];

// ١) نفّذ النصين 10 مرات عبر المسار غير المُعَدّ (التسخين وتجاوز أي عتبة)
for (let i = 0; i < 10; i++) {
  await sql.unsafe(SQL_PLAIN, paramsPlain);
  await sql.unsafe(SQL_MAX_AGE, paramsAge);
}

// ٢) لا عبارة مسمّاة لهذا الاستعلام (المسار غير المُعد)
const prepared = await sql`select name, generic_plans, custom_plans from pg_prepared_statements where statement like '%driver_availability%'`;
console.log("عبارات مسمّاة تلمس driver_availability:", prepared.length);

// ٣) خطة النص الحقيقي بالوسائط الحقيقية (EXPLAIN عبر المسار نفسه)
const plan1 = await sql.unsafe(`explain (analyze off) ${SQL_PLAIN}`, paramsPlain);
console.log("=== خطة النص الحقيقي (بلا قِدَمٍ) ===");
for (const r of plan1 as unknown[]) {
  const t = (r as { "QUERY PLAN": string })["QUERY PLAN"];
  if (/Index Scan|Index Only|Seq Scan|Sort|Limit|CTE/.test(t)) console.log(t);
}
const plan2 = await sql.unsafe(`explain (analyze off) ${SQL_MAX_AGE}`, paramsAge);
console.log("=== خطة النص الحقيقي (مع قِدَمِ الموقع) ===");
for (const r of plan2 as unknown[]) {
  const t = (r as { "QUERY PLAN": string })["QUERY PLAN"];
  if (/Index Scan|Index Only|Seq Scan|Sort|Limit|CTE/.test(t)) console.log(t);
}
await sql.end({ timeout: 5 });
