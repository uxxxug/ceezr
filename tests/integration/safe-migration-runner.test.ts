/**
 * الغرض: `F7-07` / `CAP-007` — قياسُ المُطبِّقِ الآمنِ على PostgreSQL حقيقيّةٍ.
 *   والادّعاءاتُ المقيسةُ ههنا ما **لا تُثبتُه** قراءةُ كودٍ ولا حاجزٌ نصّيٌّ:
 *
 *   (١) أنَّ سلسلةَ الهجراتِ كلَّها تُطبَّقُ بالمُطبِّقِ الجديدِ على قاعدةٍ
 *       خادشةٍ فارغةٍ بلا خطأٍ — فالبديلُ عن حلقةِ `psql` ليسَ وعداً.
 *   (٢) أنَّ **إعادةَ تطبيقِ السلسلةِ كلِّها مرّةً ثانيةً تنجحُ**، وأنَّ عددَ
 *       صفوفِ البذرِ لا يتضاعفُ. وهذا هوَ الشرطُ الذي اختِيرَ بدلَ سجلِّ هجراتٍ
 *       في القاعدةِ (القاعدةُ السياديّةُ 0.4 · ADR 0068) — فإن لم يُقَسْ فهوَ
 *       ادّعاءٌ لا ضابطٌ.
 *   (٣) أنَّ المعاملةَ يملكُها المُطبِّقُ فعلاً: ملفٌّ عبارتُه الثانيةُ تسقطُ
 *       **لا يُخلِّفُ** أثرَ عبارتِه الأولى — لا مخطَّطَ نصفَ مُطبَّقٍ.
 *   (٤) أنَّ طورَ `index` يُطبَّقُ **بلا معاملةٍ** فعلاً: `create index
 *       concurrently` تنجحُ، وهيَ تسقطُ حتماً داخلَ معاملةٍ — فنجاحُها برهانُ
 *       الطريقِ لا وصفُه.
 *   (٥) أنَّ `lock_timeout` **مضبوطةٌ فعلاً**: هجرةٌ تُصادِفُ قفلاً حاجزاً
 *       قائماً تسقطُ برمزِ `55P03` في حدودِ المهلةِ، ولا تنتظرُ إلى الأبدِ.
 *       وذلكَ عينُ العائقِ `CAP-007`.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { planFor } from "../../scripts/lib/migration-safety.ts";
import { applyMigration, type MigrationFile, readMigrations } from "../../scripts/migrate.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

const TIMEOUTS = { lockTimeout: "1s", statementTimeout: "2min" } as const;

/** ملفٌّ صناعيٌّ يُبنى في الاختبارِ لا يُكتَبُ على القرصِ — النصُّ هوَ المُدخَلُ. */
function synthetic(name: string, sql: string): MigrationFile {
  const plan = planFor(sql);
  return {
    name,
    sql,
    phase: /migration-phase:\s*(\S+)/.exec(sql)?.[1] ?? null,
    transactional: plan.transactional,
    statements: plan.statements,
  };
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL يملك مستخدمُها إنشاءَ قاعدةٍ.",
  );
}

describeIf("F7-07 — المُطبِّقُ الآمنُ على قاعدةٍ حقيقيّةٍ", () => {
  const scratch = `migrate_probe_${process.pid}`;
  let admin: postgres.Sql;
  let target: postgres.Sql;

  beforeAll(async () => {
    admin = postgres(DATABASE_URL as string, { max: 1, onnotice: () => {} });
    await admin.unsafe(`drop database if exists ${scratch}`);
    await admin.unsafe(`create database ${scratch}`);
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${scratch}`;
    target = postgres(url.toString(), { max: 3, onnotice: () => {} });
  });

  afterAll(async () => {
    await target?.end({ timeout: 5 });
    try {
      await admin.unsafe(`drop database if exists ${scratch}`);
    } finally {
      await admin?.end({ timeout: 5 });
    }
  });

  it("١ — السلسلةُ كلُّها تُطبَّقُ على قاعدةٍ فارغةٍ بالمُطبِّقِ الجديدِ", async () => {
    const files = readMigrations();
    expect(files.length).toBeGreaterThan(70);
    for (const file of files) {
      const durationMs = await applyMigration(target, file, TIMEOUTS);
      expect(durationMs).toBeGreaterThanOrEqual(0);
    }
    const tables = await target<{ count: string }[]>`
      select count(*)::text as count
        from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
    `;
    expect(Number(tables[0]?.count ?? "0")).toBeGreaterThan(15);
  }, 300_000);

  it("٢ — إعادةُ تطبيقِ السلسلةِ كلِّها تنجحُ ولا يتضاعفُ البذرُ", async () => {
    const before = await target<{ count: string }[]>`select count(*)::text as count from cities`;
    for (const file of readMigrations()) await applyMigration(target, file, TIMEOUTS);
    const after = await target<{ count: string }[]>`select count(*)::text as count from cities`;
    expect(after[0]?.count).toBe(before[0]?.count);
    expect(Number(before[0]?.count ?? "0")).toBeGreaterThan(0);
  }, 300_000);

  it("٣ — عبارةٌ ساقطةٌ في ملفٍّ معاملاتيٍّ لا تُخلِّفُ أثرَ ما قبلَها", async () => {
    const file = synthetic(
      "99999999999999_probe_half_applied.sql",
      `-- migration-phase: expand
create table if not exists probe_half_applied (id int primary key);
select 1 / 0;`,
    );
    expect(file.transactional).toBe(true);
    await expect(applyMigration(target, file, TIMEOUTS)).rejects.toThrow();
    const rows = await target<{ present: boolean }[]>`
      select exists (
        select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'probe_half_applied'
      ) as present
    `;
    expect(rows[0]?.present).toBe(false);
  }, 60_000);

  it("٤ — طورُ `index` يُطبَّقُ بلا معاملةٍ: الفهرسُ المتزامنُ ينجحُ", async () => {
    await target.unsafe(
      "create table if not exists probe_index_target (id int primary key, v int)",
    );
    const file = synthetic(
      "99999999999998_probe_concurrent_index.sql",
      `-- migration-phase: index
create index concurrently if not exists probe_index_target_v_idx on probe_index_target (v);`,
    );
    expect(file.transactional).toBe(false);
    await applyMigration(target, file, TIMEOUTS);
    const rows = await target<{ present: boolean }[]>`
      select exists (
        select 1 from pg_indexes
         where schemaname = 'public' and indexname = 'probe_index_target_v_idx'
      ) as present
    `;
    expect(rows[0]?.present).toBe(true);
  }, 60_000);

  it("٥ — `lock_timeout` مضبوطةٌ فعلاً: القفلُ الحاجزُ يُسقِطُ الهجرةَ ولا يُجمِّدُها", async () => {
    await target.unsafe("create table if not exists probe_locked (id int primary key)");
    const holder = postgres(
      (() => {
        const url = new URL(DATABASE_URL as string);
        url.pathname = `/${scratch}`;
        return url.toString();
      })(),
      { max: 1, onnotice: () => {} },
    );

    // معاملةٌ تُمسِكُ قفلاً حاجزاً على الجدولِ وتُبقيه حتّى يُقاسَ الأثرُ.
    const gate: { release: () => void } = { release: () => {} };
    const held = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    const holding = holder.begin(async (tx) => {
      await tx.unsafe("lock table probe_locked in access exclusive mode");
      await held;
    });
    // مهلةٌ قصيرةٌ ليُؤخَذَ القفلُ قبلَ محاولةِ الهجرةِ.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const file = synthetic(
      "99999999999997_probe_lock_timeout.sql",
      `-- migration-phase: expand
alter table probe_locked add column if not exists v int;`,
    );
    const startedAt = Date.now();
    let code: string | null = null;
    try {
      await applyMigration(target, file, TIMEOUTS);
    } catch (error) {
      code = (error as { code?: string }).code ?? null;
    }
    const elapsed = Date.now() - startedAt;
    gate.release();
    await holding;
    await holder.end({ timeout: 5 });

    // `55P03` = lock_not_available: المهلةُ انقضَت فسقطَت الهجرةُ بخطأٍ مقروءٍ.
    expect(code).toBe("55P03");
    // مهلةُ الاختبارِ ثانيةٌ واحدةٌ؛ والسقفُ عشرٌ احتياطاً لعدّاءٍ بطيءٍ لا تسامحاً.
    expect(elapsed).toBeLessThan(10_000);
  }, 60_000);
});
