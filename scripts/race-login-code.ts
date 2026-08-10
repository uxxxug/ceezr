/**
 * الغرض: إثبات (أو نفي) سباق حدّ إصدار رموز دخول لوحة الإدارة إثباتاً مباشراً
 *   لا عرَضياً. اختبار التزامن داخل حزمة الاختبارات ظهر مرّة وغاب مرّات، وهذا
 *   بالضبط سلوك السباق: يتوقّف على التوقيت لا على الكود وحده. فالحكم عليه
 *   يحتاج تكراراً كثيفاً لا محاولة واحدة.
 * الحالة: أداة تشخيص — تُشغَّل يدوياً، ليست جزءاً من حزمة الاختبارات.
 * ينتمي إلى: scripts
 * الاستعمال:
 *   TEST_DATABASE_URL=... bun scripts/race-login-code.ts [عدد_الجولات] [التزامن]
 */

import { ADMIN_CODE_MAX_PER_WINDOW, createAdminAuthPort } from "../apps/gateway/src/admin/auth.ts";
import { createSql } from "../packages/infrastructure/db/client.ts";

const connectionString = process.env.TEST_DATABASE_URL;
if (connectionString === undefined) {
  console.error("عيّن TEST_DATABASE_URL");
  process.exit(1);
}

const rounds = Number(process.argv[2] ?? 40);
const concurrency = Number(process.argv[3] ?? 30);

const sql = createSql({ connectionString });
const auth = createAdminAuthPort(sql);

const cities = await sql<{ id: string }[]>`select id from cities where code = 'MKK'`;
const cityId = cities[0]?.id;
if (cityId === undefined) throw new Error("لا توجد مدينة MKK");

let violations = 0;
let worst = 0;

for (let round = 0; round < rounds; round += 1) {
  // حالة نظيفة تماماً لكل جولة: لا رموز سابقة تُحسب في النافذة
  await sql`delete from admin_login_codes`;
  // audit_log يشير إلى المستخدم، فيُحذف قبله وإلا منع قيد المفتاح الأجنبي الحذف
  await sql`delete from audit_log where action = 'admin.login_code_issued'`;
  await sql`delete from users where telegram_id = 995001::bigint`;
  await sql`
    insert into users (city_id, telegram_id, full_name, phone, language_code, role)
    values (${cityId}, 995001::bigint, 'مسؤول السباق', '+966500005001', 'ar', 'admin')
  `;

  const results = await Promise.all(
    Array.from({ length: concurrency }, (_, index) =>
      auth.issueCode("995001", `${round}-${index}`.padEnd(64, "0")),
    ),
  );

  const granted = results.filter((r) => r.ok && r.value.ok).length;
  // العدّ الحقيقي في القاعدة، لا المُعلَن في الردّ وحده
  const stored = await sql<{ count: string }[]>`
    select count(*)::text as count from admin_login_codes
  `;
  const rows = Number(stored[0]?.count ?? 0);

  if (granted > worst) worst = granted;
  if (granted > ADMIN_CODE_MAX_PER_WINDOW || rows > ADMIN_CODE_MAX_PER_WINDOW) {
    violations += 1;
    console.log(
      `جولة ${round}: تجاوز — مُنِح ${granted}، صفوف ${rows}، الحدّ ${ADMIN_CODE_MAX_PER_WINDOW}`,
    );
  }
}

await sql`delete from admin_login_codes`;
await sql`delete from audit_log where action = 'admin.login_code_issued'`;
await sql`delete from users where telegram_id = 995001::bigint`;
await sql.end({ timeout: 5 });

console.log(`\nالجولات: ${rounds} · التزامن: ${concurrency} · الحدّ: ${ADMIN_CODE_MAX_PER_WINDOW}`);
console.log(`أقصى عدد مُنِح في جولة: ${worst}`);
console.log(violations === 0 ? "لا تجاوز: الحدّ صامد" : `تجاوزات: ${violations}`);
process.exit(violations === 0 ? 0 : 1);
