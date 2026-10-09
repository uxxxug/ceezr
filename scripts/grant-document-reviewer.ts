#!/usr/bin/env bun
/**
 * # منحُ «مراجِعِ وثائقِ السائقين» أو سحبُه — سكربتُ تشغيلٍ لا مسارُ ويب (PD-042 · ADR 0256)
 *
 * **الغرض:** صفةُ `admin` وحدَها لا تفتحُ وثيقةً ولا تحكمُ عليها؛ يلزمُ منحٌ صريحٌ لكلِّ
 * (مسؤولٍ · مدينة) في `driver_document_reviewers`. والمنحُ **لا يُمنَحُ من اللوحة** عن قصد:
 * فلا مسؤولَ يوسّعُ دائرةَ المراجِعينَ أو يمنحُ نفسَه من المتصفّح. يُنادى هذا السكربتُ بصلاحيّةِ
 * الخدمة (`DATABASE_URL`) — وهي صلاحيّةٌ يملكُها المالكُ أصلاً — وكلُّ منحٍ وسحبٍ يُكتَبُ
 * في `audit_log` (`admin.document_reviewer_granted|revoked`) داخلَ الدالّةِ الذرّيّة.
 *
 * **الاستعمال:**
 *   DATABASE_URL=… bun run scripts/grant-document-reviewer.ts \
 *     --actor-telegram <معرّفُ المسؤولِ المانح> --target-telegram <معرّفُ المستفيد> \
 *     --city <رمزُ المدينة | all-active> [--revoke]
 *
 * **ما لا يفعلُه:** لا يطبعُ اسماً ولا هاتفاً ولا رابطَ قاعدة؛ يطبعُ رمزَ المدينةِ والنتيجةَ فقط.
 */

import { createSql } from "../packages/infrastructure/db/client.ts";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const databaseUrl = process.env.DATABASE_URL;
const actorTelegram = arg("actor-telegram");
const targetTelegram = arg("target-telegram");
const cityArg = arg("city");
const enabled = !process.argv.includes("--revoke");

if (databaseUrl === undefined || !actorTelegram || !targetTelegram || !cityArg) {
  console.error(
    "الاستعمال: DATABASE_URL=… bun run scripts/grant-document-reviewer.ts --actor-telegram N --target-telegram N --city CODE|all-active [--revoke]",
  );
  process.exit(2);
}
if (!/^\d+$/.test(actorTelegram) || !/^\d+$/.test(targetTelegram)) {
  console.error("معرّفُ تيليجرام أرقامٌ فقط.");
  process.exit(2);
}

const sql = createSql({ connectionString: databaseUrl, max: 1 });
try {
  const users = await sql<{ id: string; telegram_id: string }[]>`
    select id, telegram_id::text as telegram_id from users
     where telegram_id in (${actorTelegram}::bigint, ${targetTelegram}::bigint)
  `;
  const actor = users.find((u) => u.telegram_id === actorTelegram);
  const target = users.find((u) => u.telegram_id === targetTelegram);
  if (actor === undefined || target === undefined) {
    console.error("لا مستخدمَ بأحدِ المعرّفَين.");
    process.exit(1);
  }

  const cities =
    cityArg === "all-active"
      ? await sql<{ id: string; code: string }[]>`
          select id, code from cities where is_active order by code`
      : await sql<{ id: string; code: string }[]>`
          select id, code from cities where code = ${cityArg}`;
  if (cities.length === 0) {
    console.error("لا مدينةَ مطابقة.");
    process.exit(1);
  }

  let failed = false;
  for (const city of cities) {
    const [row] = await sql<{ result: { ok: boolean; changed?: boolean; error?: string } }[]>`
      select admin_set_document_reviewer(${actor.id}::uuid, ${target.id}::uuid, ${city.id}::uuid, ${enabled}) as result
    `;
    const result = row?.result;
    console.log(
      `${city.code}: ${enabled ? "منح" : "سحب"} → ${
        result?.ok ? (result.changed ? "تمّ" : "لا تغيير") : `رُفِض (${result?.error ?? "?"})`
      }`,
    );
    if (!result?.ok) failed = true;
  }
  process.exit(failed ? 1 : 0);
} finally {
  await sql.end();
}
