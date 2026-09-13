/**
 * الغرض: إثباتُ أساس منصّة القياس بتشغيلٍ واحدٍ قابلٍ لإعادة الإنتاج: العزل،
 *   ثم الترحيلات، ثم حتميّةُ البذر، ثم أنّ reset+seed مرّتين يُعطيان الحالةَ نفسَها.
 * الحالة: منفّذ فعلياً — المرحلة 2 وحدة 2-4. مخرَجُه دليلٌ يُحفظ في docs/evidence.
 * ينتمي إلى: bench
 * يُتوقع أن يستخدمه لاحقاً: كلُّ من أراد أن يتحقّق من الأساس قبل قياسٍ جديد
 * ملاحظات مستقبلية: لا يُشغَّل في CI قبل أن تتوفّر قاعدةُ قياسٍ في CI.
 *
 * التشغيل: BENCH_DATABASE_URL=postgres://…/waslah_bench bun bench/verify-foundation.ts
 *
 * ## لماذا سلسلةٌ واحدةٌ بترتيبٍ ثابت
 *
 * لأن كلَّ حلقةٍ فيها تعتمد على ما قبلها: بذرٌ حتميٌّ على قاعدةٍ ناقصةِ الترحيلات
 * لا معنى له، وreset موثوقٌ على قاعدةٍ غير معزولةٍ خطرٌ لا إنجاز. فالترتيبُ جزءٌ
 * من الدليل، وكسرُه يُبطله. وأيُّ فحصٍ يفشل يوقف السلسلة: نتيجةُ فحصٍ بُنيت على
 * فحصٍ فاشلٍ قبله ليست نتيجة.
 */

import { createSql } from "../../../packages/infrastructure/db/client.ts";
import { checkIsolation } from "./isolation.ts";
import { provision } from "./provision.ts";
import { inspectBeforeReset, resetToMigratedState } from "./reset.ts";
import { verifyMigrationOwned } from "./schema.ts";
import { DEFAULT_SEED_PLAN, seed } from "./seed.ts";
import { captureState, compareStates, formatComparison } from "./state.ts";

const databaseUrl = process.env.BENCH_DATABASE_URL;
const nodeEnv = process.env.NODE_ENV;

interface Check {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

const checks: Check[] = [];
let failed = false;

function record(name: string, passed: boolean, detail: string): void {
  checks.push({ name, passed, detail });
  console.log(`${passed ? "✅" : "❌"} ${name}\n   ${detail}`);
  if (!passed) failed = true;
}

function halt(reason: string): never {
  console.error(`\n⛔ توقّفت السلسلة: ${reason}`);
  process.exit(1);
}

console.log("=== إثبات أساس منصّة القياس (وحدة 2-4) ===\n");

// ─── 1. العزل: الرفضُ قبل القبول ───────────────────────────────────────────────
const rejections: readonly { label: string; input: Parameters<typeof checkIsolation>[0] }[] = [
  {
    label: "بيئة إنتاج",
    input: { databaseUrl: "postgres://u:p@localhost:5432/waslah_bench", nodeEnv: "production" },
  },
  {
    label: "مضيف Supabase مُدار",
    input: { databaseUrl: "postgres://u:p@db.abc.supabase.co:5432/postgres", nodeEnv: "test" },
  },
  {
    label: "مضيف شبكيّ بعيد",
    input: { databaseUrl: "postgres://u:p@10.0.0.5:5432/waslah_bench", nodeEnv: "test" },
  },
  {
    label: "قاعدة خارج قائمة السماح (waslah)",
    input: { databaseUrl: "postgres://u:p@localhost:5432/waslah", nodeEnv: "test" },
  },
  {
    label: "قاعدة الإنتاج المعتادة (postgres)",
    input: { databaseUrl: "postgres://u:p@localhost:5432/postgres", nodeEnv: "test" },
  },
  { label: "وجهة غائبة", input: { databaseUrl: undefined, nodeEnv: "test" } },
];

const rejected = rejections.map((c) => ({ ...c, verdict: checkIsolation(c.input) }));
const leaked = rejected.filter((r) => r.verdict.ok);
record(
  "1. حرس العزل يرفض كلّ وجهةٍ غير مشروعة",
  leaked.length === 0,
  leaked.length === 0
    ? rejected.map((r) => `${r.label} → ${r.verdict.ok ? "قُبل!" : r.verdict.code}`).join("; ")
    : `نفذت وجهاتٌ كان يجب رفضها: ${leaked.map((l) => l.label).join(", ")}`,
);
if (failed) halt("حرس العزل غير موثوق، فلا يجوز أن تلمس الأداة قاعدةً.");

const verdict = checkIsolation({ databaseUrl, nodeEnv });
record(
  "2. الوجهة المُمرَّرة مقبولة",
  verdict.ok,
  verdict.ok ? `${verdict.host}/${verdict.database}` : `${verdict.code}: ${verdict.message}`,
);
if (!verdict.ok) halt(verdict.message);

const sql = createSql({ connectionString: databaseUrl as string, max: 4 });

try {
  // ─── 2. الترحيلات وملكيّة الجداول ────────────────────────────────────────────
  const before = await inspectBeforeReset(sql);
  record(
    "3. الاتّصال قائمٌ على قاعدة القياس نفسِها لا على نيّتها",
    true,
    `current_database() = ${before.database}؛ جداول تشغيل: ${before.operationalTables.length}`,
  );

  const [{ count: migrationCount } = { count: "0" }] = await sql<{ count: string }[]>`
    select count(*)::text as count from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  `;
  record(
    "4. المخطّط مبنيٌّ بالترحيلات",
    Number(migrationCount) >= 36,
    `${migrationCount} جدولاً في public`,
  );

  // القاعدةُ تُنظَّف أوّلاً حتى يصحّ فحصُ ملكيّة الترحيلات.
  const firstReset = await resetToMigratedState(sql, { databaseUrl, nodeEnv });
  record(
    "5. reset ابتدائيّ نجح",
    true,
    `مُحي ${firstReset.rowsRemoved} صفّاً من ${firstReset.truncatedTables.length} جدولاً في ${firstReset.durationMs.toFixed(1)}ms`,
  );

  /**
   * التهيئة بعد المحو وقبل البذر: المدنُ تُبذَر غير مُفعَّلة، وتفعيلُها عملٌ
   * تشغيليّ لا حالةٌ افتراضيّة. وهي في جدولٍ محفوظٍ لا يمحوه `reset`، فتُنفَّذ
   * مرّةً في التهيئة لا في كلّ دورة بذر.
   */
  const provisioned = await provision(sql);
  record(
    "6. التهيئة: مدنُ القياس مُفعَّلةٌ بقروبها الثلاثة في عبارةٍ واحدة",
    provisioned.activatedCities === provisioned.totalCities && provisioned.totalCities > 0,
    `${provisioned.activatedCities}/${provisioned.totalCities} مدينة مُفعَّلة: ${provisioned.cityCodes.join(", ")}`,
  );

  const owned = await verifyMigrationOwned(sql);
  record(
    "7. قائمةُ ما تملكه الترحيلاتُ مطابقةٌ للواقع",
    owned.ok,
    owned.ok
      ? "الجداولُ المُستثناة من المحو هي بالضبط ما تبذره الترحيلات"
      : `مُعلَنٌ وفارغ: ${owned.declaredButEmpty.join(", ") || "—"} | مبذورٌ وغيرُ مُعلَن: ${owned.seededButNotDeclared.map((t) => `${t.table}=${t.rows}`).join(", ") || "—"}`,
  );

  // ─── 3. البذر الأوّل ─────────────────────────────────────────────────────────
  const firstSeed = await seed(sql, DEFAULT_SEED_PLAN);
  const firstState = await captureState(sql);
  record(
    "8. البذر الأوّل",
    firstState.totalRows > 0,
    `بصمة المدخلات ${firstSeed.fingerprint}؛ ${firstState.totalRows} صفّاً في ${firstState.tables.length} جدولاً (${firstSeed.durationMs.toFixed(1)}ms)`,
  );

  const expected = Object.entries(firstSeed.insertedRows).sort(([a], [b]) => a.localeCompare(b));
  const actual = firstState.tables.map((t) => [t.table, t.rows] as const);
  record(
    "9. الحالةُ بعد البذر هي المُتوقَّعة بالعدد",
    JSON.stringify(expected) === JSON.stringify(actual.map(([t, r]) => [t, r])),
    `متوقَّع: ${expected.map(([t, r]) => `${t}=${r}`).join(", ")} | فعليّ: ${actual.map(([t, r]) => `${t}=${r}`).join(", ")}`,
  );

  // ─── 4. سلكُ التعطيل: هويّةٌ دخيلةٌ توقف المحو ─────────────────────────────────
  const intruderCity = firstSeed.cities[0]?.id;
  if (intruderCity === undefined) halt("لا مدينة لاختبار سلك التعطيل.");
  await sql`
    insert into public.users (city_id, telegram_id, full_name, language_code, role)
    values (${intruderCity}, 12345, 'مستخدم ليس من القياس', 'ar', 'rider')
  `;
  let tripwireFired = false;
  let tripwireMessage = "";
  try {
    await resetToMigratedState(sql, { databaseUrl, nodeEnv });
  } catch (error) {
    tripwireFired = true;
    tripwireMessage = error instanceof Error ? error.message : String(error);
  }
  const survived = await sql<
    { count: string }[]
  >`select count(*)::text as count from public.drivers`;
  record(
    "10. صفٌّ لا يملكه القياس ⇒ رفضٌ لا حذف",
    tripwireFired && Number(survived[0]?.count ?? "0") === DEFAULT_SEED_PLAN.drivers,
    tripwireFired
      ? `رُفض المحو، وبقي ${survived[0]?.count} سائقاً كما هم. ${tripwireMessage.slice(0, 130)}`
      : "المحو نفذ رغم وجود صفٍّ دخيل — الحرس لا يعمل.",
  );
  await sql`delete from public.users where telegram_id = 12345`;

  // ─── 5. reset ← seed مرّةً ثانية، والمقارنة ─────────────────────────────────
  const secondReset = await resetToMigratedState(sql, { databaseUrl, nodeEnv });
  const emptyState = await captureState(sql);
  record(
    "11. reset يُعيد القاعدة إلى الفراغ التشغيليّ الكامل",
    emptyState.totalRows === 0,
    `مُحي ${secondReset.rowsRemoved} صفّاً؛ الباقي ${emptyState.totalRows} صفّاً (${secondReset.durationMs.toFixed(1)}ms)`,
  );

  const secondSeed = await seed(sql, DEFAULT_SEED_PLAN);
  const secondState = await captureState(sql);
  record(
    "12. لا تضخّم في إعادة البذر",
    secondState.totalRows === firstState.totalRows,
    `${firstState.totalRows} ← ${secondState.totalRows} صفّاً`,
  );
  record(
    "13. بصمةُ مدخلات البذر ثابتة",
    secondSeed.fingerprint === firstSeed.fingerprint,
    `${firstSeed.fingerprint} ← ${secondSeed.fingerprint}`,
  );

  const comparison = compareStates(firstState, secondState);
  record(
    "14. الحالةُ بعد reset+seed مطابقةٌ للحالة الأولى منطقيّاً",
    comparison.identical,
    formatComparison(comparison),
  );

  // دورةٌ ثالثة: تطابقُ مرّتين قد يكون مصادفة؛ الاستقرارُ يُثبت بتكرارٍ ثالث.
  await resetToMigratedState(sql, { databaseUrl, nodeEnv });
  await seed(sql, DEFAULT_SEED_PLAN);
  const thirdState = await captureState(sql);
  const thirdComparison = compareStates(firstState, thirdState);
  record(
    "15. الدورة الثالثة تُطابق الأولى كذلك",
    thirdComparison.identical,
    formatComparison(thirdComparison),
  );

  /**
   * تُطبع البصمتان معاً ولا تُختصر إلى واحدة: الخامُ (`local`) تقارن داخل
   * القاعدة نفسِها وتكشف أيّة إعادةِ بذرٍ للجداول المملوكة للترحيلات،
   * والمنقولةُ (`portable`) وحدها هي التي تصلح للمقارنة مع بيئةٍ أخرى. وخلطُ
   * الاثنتين هو ما أوقع في الوهم أوّلَ مرّة.
   */
  console.log("\n=== بصمةُ الحالة المرجعيّة (local داخل القاعدة | portable بين القواعد) ===");
  for (const table of [...firstState.tables, ...firstState.preserved]) {
    console.log(
      `${table.table.padEnd(22)} ${String(table.rows).padStart(5)}  ${table.digest}  ${table.portableDigest}`,
    );
  }

  /**
   * حفظُ اللقطة اختياريٌّ لأنّ السلسلة تُثبِت نفسَها بلا ملف؛ وإنما يُلزم الملفُ
   * للمقارنة بين قاعدتين أو بين مضيفين، وهي مقارنةٌ لا تجري في عمليةٍ واحدة.
   */
  const snapshotPath = process.env.BENCH_STATE_JSON;
  if (snapshotPath !== undefined && snapshotPath !== "") {
    await Bun.write(snapshotPath, `${JSON.stringify(firstState, null, 2)}\n`);
    console.log(`\nلقطةُ الحالة محفوظةٌ في: ${snapshotPath}`);
  }
} finally {
  await sql.end({ timeout: 5 });
}

console.log(
  `\n${failed ? "❌ فشل" : "✅ نجح"}: ${checks.filter((c) => c.passed).length}/${checks.length} فحصاً`,
);
process.exit(failed ? 1 : 0);
