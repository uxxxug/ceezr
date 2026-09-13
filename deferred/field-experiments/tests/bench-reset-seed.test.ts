/**
 * الغرض: إثباتُ أنّ reset+seed حتميّان وأنّ حروسَ المحو تُغلَق على الفشل، مقابل
 *   قاعدةٍ حقيقيّة لا محاكاة.
 * الحالة: اختبار فعلي — يُتخطّى بإعلانٍ صريحٍ إن لم تُضبَط BENCH_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI بعد أن تتوفّر قاعدةُ قياسٍ فيه (لم يحدث بعد).
 * ملاحظات مستقبلية: يُضاف حرسٌ يمنع التخطّي الصامتَ حين تصير القاعدة متاحةً في CI.
 *
 * ولماذا معلَّقٌ على متغيّرٍ بدل أن يُنشئ قاعدته؟ لأن إنشاءَ قاعدةٍ وتطبيقَ ٥٧
 * ترحيلاً داخل اختبارٍ يجعل فشلَ الترحيلات يظهر كفشلِ حرس، فيُشخَّص العطبُ في
 * المكان الخطأ. والتهيئةُ عملٌ مُعلَنٌ منفصل، والاختبارُ يفحص ما بعدها.
 * والتخطّي مُعلَنٌ في السجلّ لا صامت: اختبارٌ لم يجرِ ليس اختباراً نجح.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../../packages/infrastructure/db/client.ts";
import { assertIsolation, checkIsolation } from "../bench/isolation.ts";
import { provision } from "../bench/provision.ts";
import { inspectBeforeReset, resetToMigratedState } from "../bench/reset.ts";
import { verifyMigrationOwned } from "../bench/schema.ts";
import { DEFAULT_SEED_PLAN, seed } from "../bench/seed.ts";
import { captureState, compareStates } from "../bench/state.ts";

const databaseUrl = process.env.BENCH_DATABASE_URL;
const nodeEnv = "test";
const available = checkIsolation({ databaseUrl, nodeEnv }).ok;

if (!available) {
  console.log(
    "[bench-reset-seed] تُخطّي: BENCH_DATABASE_URL غير مضبوطة أو لا تجتاز حرس العزل. لم يُثبَت شيء.",
  );
}

describe.if(available)("منصّة القياس: العزل والحتميّة مقابل قاعدةٍ حقيقيّة", () => {
  let sql: Sql;

  beforeAll(async () => {
    assertIsolation({ databaseUrl, nodeEnv });
    sql = createSql({ connectionString: databaseUrl as string, max: 4 });
    await resetToMigratedState(sql, { databaseUrl, nodeEnv });
    await provision(sql);
  });

  afterAll(async () => {
    if (sql !== undefined) {
      await resetToMigratedState(sql, { databaseUrl, nodeEnv });
      await sql.end({ timeout: 5 });
    }
  });

  it("الاتّصالُ قائمٌ على قاعدة القياس فعلاً لا على ما تقوله الوجهة", async () => {
    const before = await inspectBeforeReset(sql);
    expect(before.database).toBe("waslah_bench");
    expect(before.operationalTables.length).toBeGreaterThan(30);
  });

  it("قائمةُ الجداول التي تملكها الترحيلاتُ مطابقةٌ لما تبذره فعلاً", async () => {
    const owned = await verifyMigrationOwned(sql);
    expect(owned.declaredButEmpty).toEqual([]);
    expect(owned.seededButNotDeclared).toEqual([]);
    expect(owned.ok).toBe(true);
  });

  it("reset يُفرّغ كلَّ جدولٍ تشغيليٍّ ويُبقي ما تملكه الترحيلات", async () => {
    await seed(sql, DEFAULT_SEED_PLAN);
    await resetToMigratedState(sql, { databaseUrl, nodeEnv });
    const state = await captureState(sql);
    expect(state.totalRows).toBe(0);
    const cities = state.preserved.find((t) => t.table === "cities");
    expect(cities?.rows).toBe(5);
  });

  /** السؤالُ الفاصل: هل يُعطي reset+seed مرّتين الحالةَ المنطقيّةَ نفسَها؟ */
  it("reset ← seed ← reset ← seed يُنتج الحالةَ المنطقيّةَ نفسَها", async () => {
    await resetToMigratedState(sql, { databaseUrl, nodeEnv });
    const first = await seed(sql, DEFAULT_SEED_PLAN);
    const firstState = await captureState(sql);

    await resetToMigratedState(sql, { databaseUrl, nodeEnv });
    const second = await seed(sql, DEFAULT_SEED_PLAN);
    const secondState = await captureState(sql);

    expect(second.fingerprint).toBe(first.fingerprint);
    expect(secondState.totalRows).toBe(firstState.totalRows);
    const comparison = compareStates(firstState, secondState);
    expect(comparison.differences).toEqual([]);
    expect(comparison.identical).toBe(true);
  });

  it("إعادةُ البذر لا تُضخّم: العددُ ثابتٌ بعد ثلاث دورات", async () => {
    const counts: number[] = [];
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await resetToMigratedState(sql, { databaseUrl, nodeEnv });
      await seed(sql, DEFAULT_SEED_PLAN);
      const state = await captureState(sql);
      counts.push(state.totalRows);
    }
    expect(new Set(counts).size).toBe(1);
    expect(counts[0]).toBeGreaterThan(0);
  });

  it("بذرٌ فوق بذرٍ يفشل ولا يُنتج حالةً مزدوجة — لا `on conflict` يُخفي التصادم", async () => {
    await resetToMigratedState(sql, { databaseUrl, nodeEnv });
    await seed(sql, DEFAULT_SEED_PLAN);
    const stateBefore = await captureState(sql);

    let threw = false;
    try {
      await seed(sql, DEFAULT_SEED_PLAN);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    // المعاملةُ الفاشلة لا تُبقي أثراً: الحالةُ كما كانت تماماً.
    const stateAfter = await captureState(sql);
    expect(compareStates(stateBefore, stateAfter).identical).toBe(true);
  });

  /**
   * سلكُ التعطيل: صفٌّ لا يملكه القياس يجب أن يوقف المحوَ ولا يحذف شيئاً.
   * والفحصُ يُثبت الأمرين: أنّ الاستثناءَ رُفع، **وأنّ الصفوفَ باقية**. لأن حرساً
   * يشتكي بعد أن يمحو ليس حرساً.
   */
  it("هويّةٌ دخيلةٌ ⇒ FOREIGN_ROWS ولا يُحذف صفٌّ واحد", async () => {
    await resetToMigratedState(sql, { databaseUrl, nodeEnv });
    await seed(sql, DEFAULT_SEED_PLAN);
    const stateBefore = await captureState(sql);

    const [city] = await sql<{ id: string }[]>`
      select id from public.cities where is_active = true order by code limit 1
    `;
    await sql`
      insert into public.users (city_id, telegram_id, full_name, language_code, role)
      values (${city?.id ?? null}, 4321, 'هويّة ليست من القياس', 'ar', 'rider')
    `;

    await expect(resetToMigratedState(sql, { databaseUrl, nodeEnv })).rejects.toThrow(
      /FOREIGN_ROWS/,
    );

    await sql`delete from public.users where telegram_id = 4321`;
    const stateAfter = await captureState(sql);
    expect(compareStates(stateBefore, stateAfter).identical).toBe(true);
  });

  it("صفوفٌ تشغيليّةٌ بلا هويّةِ قياسٍ ⇒ UNEXPLAINED_ROWS لا محوٌ أعمى", async () => {
    await resetToMigratedState(sql, { databaseUrl, nodeEnv });
    const [city] = await sql<{ id: string }[]>`
      select id from public.cities where is_active = true order by code limit 1
    `;
    // صفٌّ في جدولٍ تشغيليٍّ بلا أيّ مستخدمٍ في القاعدة: حالةٌ لا يُفسّرها القياس،
    // فلا يستطيع حرسُ الهويّة أن يحكم عليها، فيجب أن يرفض المحوَ لا أن يُخمّن.
    await sql`
      insert into public.audit_log (city_id, action, entity_type)
      values (${city?.id ?? null}, 'external.change', 'unknown')
    `;

    await expect(resetToMigratedState(sql, { databaseUrl, nodeEnv })).rejects.toThrow(
      /UNEXPLAINED_ROWS/,
    );

    // التنظيفُ يدويٌّ لأن الحرسَ — بحقّ — يمنع الأداةَ من تنظيف ما لا تملكه.
    await sql`delete from public.audit_log where action = 'external.change'`;
  });

  it("وجهةٌ غيرُ مسموحةٍ تُرفض قبل أيّ اتّصال", () => {
    expect(() =>
      assertIsolation({
        databaseUrl: "postgres://u:p@localhost:5432/waslah",
        nodeEnv,
      }),
    ).toThrow(/DATABASE_NOT_ALLOWED/);
  });
});
