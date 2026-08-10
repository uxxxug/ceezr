/**
 * الغرض: إثبات (أو نفي) سباق حدّ تكرار فتح تذاكر الدعم إثباتاً مباشراً لا عرَضياً.
 *   `open_support_ticket` تقرأ آخر تذكرة، تقارنها بمهلة التهدئة، ثم تُدخل — بلا
 *   قفل بينهما. النافذة بين القراءة والكتابة هي ما تفتحه هذه الأداة عمداً.
 * الحالة: أداة تشخيص — تُشغَّل يدوياً، ليست جزءاً من حزمة الاختبارات.
 * ينتمي إلى: scripts
 * الاستعمال:
 *   TEST_DATABASE_URL=... bun scripts/race-support-ticket.ts [عدد_الجولات] [التزامن]
 *
 * المتوقّع بعد الإصلاح: تذكرة واحدة لكل جولة مهما بلغ التزامن.
 */

import { createSql } from "../packages/infrastructure/db/client.ts";

const connectionString = process.env.TEST_DATABASE_URL;
if (connectionString === undefined) {
  console.error("عيّن TEST_DATABASE_URL");
  process.exit(1);
}

const rounds = Number(process.argv[2] ?? 40);
const concurrency = Number(process.argv[3] ?? 30);

/** التهدئة تكفي لتغطية الجولة كلّها، فأي تذكرة ثانية فيها خرقٌ لا تباعد مشروع. */
const COOLDOWN_SECONDS = 3600;
const TELEGRAM_ID = 996_001;

const sql = createSql({ connectionString });

const cities = await sql<{ id: string }[]>`select id from cities where code = 'MKK'`;
const cityId = cities[0]?.id;
if (cityId === undefined) throw new Error("لا توجد مدينة MKK");

await sql`
  update cities
     set telegram_support_group_id = -1001
   where id = ${cityId}
`;

// مهلة التهدئة إعداد لكل مدينة (الافتراضي المبذور 300ث). تُرفع هنا لتغطّي
// الجولة كلّها، فأي تذكرة ثانية خرقٌ لا تباعد مشروع.
await sql`
  insert into platform_settings (city_id, key, value, value_type, description_ar)
  values (
    ${cityId}, 'support_ticket_cooldown_seconds',
    ${String(COOLDOWN_SECONDS)}::jsonb, 'number', 'مهلة تهدئة التذاكر — أداة سباق'
  )
  on conflict (city_id, key) do update set value = excluded.value
`;

let violations = 0;
let worst = 0;

for (let round = 0; round < rounds; round += 1) {
  // حالة نظيفة لكل جولة: لا تذكرة سابقة تُحسب في نافذة التهدئة
  await sql`delete from support_tickets`;
  await sql`delete from audit_log where action = 'support.ticket_opened'`;
  await sql`delete from riders where user_id in (
    select id from users where telegram_id = ${TELEGRAM_ID}::bigint
  )`;
  await sql`delete from users where telegram_id = ${TELEGRAM_ID}::bigint`;

  const inserted = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, language_code, role)
    values (${cityId}, ${TELEGRAM_ID}::bigint, 'راكب السباق', '+966500006001', 'ar', 'rider')
    returning id
  `;
  const userId = inserted[0]?.id;
  if (userId === undefined) throw new Error("تعذّر إنشاء المستخدم");
  await sql`insert into riders (city_id, user_id) values (${cityId}, ${userId})`;

  const results = await Promise.all(
    Array.from(
      { length: concurrency },
      (_, index) => sql<{ result: { ok: boolean } }[]>`
        select open_support_ticket(
          ${TELEGRAM_ID}::bigint,
          'ride_dispute'::support_ticket_type,
          ${`رسالة سباق رقم ${round}-${index} تكفي طولاً للتحقّق`}::text,
          null::text,
          null::uuid
        ) as result
      `,
    ),
  );

  const granted = results.filter((r) => r[0]?.result.ok === true).length;
  // العدّ الحقيقي في القاعدة، لا المُعلَن في الردّ وحده
  const stored = await sql<{ count: string }[]>`
    select count(*)::text as count from support_tickets
  `;
  const rows = Number(stored[0]?.count ?? 0);

  if (granted > worst) worst = granted;
  if (granted > 1 || rows > 1) {
    violations += 1;
    console.error(`الجولة ${round}: قُبلت ${granted} · في القاعدة ${rows} · الحدّ 1`);
  }
}

console.log(
  `\nالجولات ${rounds} × التزامن ${concurrency}\n` +
    `خروقات: ${violations}\n` +
    `أعلى عدد تذاكر في جولة واحدة: ${worst} (الحدّ 1)`,
);

await sql.end({ timeout: 5 });
process.exit(violations === 0 ? 0 : 1);
