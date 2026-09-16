/**
 * الغرض: قياسُ **وصولِ** معرِّفِ وحدةِ العملِ إلى القاعدةِ على PostgreSQL حقيقيٍّ
 *   (`F8-01` · `OPS-002` · `ADR 0129`) — وهوَ ما **لا يقدرُ عليه حاجزٌ ساكنٌ ولا
 *   محرِّكٌ مُصنَّعٌ**: المُزيَّفُ يُثبتُ أنَّ `set_config` أُرسِلَ، والقاعدةُ وحدَها
 *   تُثبتُ أنَّ الصفَّ حملَه. ويُقاسُ ههنا:
 *     ــ أنَّ معرِّفَ السياقِ يصلُ **صفَّ `audit_log`** المكتوبَ في المعاملةِ نفسِها.
 *     ــ أنَّ **غيابَ السياقِ يبقى `NULL`** ولا يُلفَّقُ معرِّفٌ في القاعدةِ.
 *     ــ أنَّ المعرِّفَ **محدودُ المعاملةِ**: معاملةٌ تالِيةٌ بلا ضبطٍ لا تُورِّثُ
 *        معرِّفَ سابقتِها — وهذا شرطُ الصحّةِ تحتَ تجمُّعِ المعاملاتِ (pooler).
 *     ــ أنَّ **قيدَ الشكلِ يرفضُ** قيمةً فاسدةً يُدرِجُها مُدرِجٌ صريحٌ.
 *     ــ أنَّ المُشغِّلَ **لا يطمِسُ** قيمةً صريحةً صحيحةً جاءت من المُدرِجِ.
 *     ــ أنَّ القيودَ الثلاثةَ **مُتحقَّقةٌ** (`convalidated`) مقروءةً من فهرسِ
 *        النظامِ لا من نصِّ الهجرةِ — فوجودُ الهجرةِ ليسَ إثباتَ تطبيقِها.
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * يُستخدم من: CI (وظيفةُ «تكامل على PostgreSQL حقيقي»)
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ ═══
 * ــ **لا يُقاسُ أثرُ `RLS`**: الاتصالُ بمالكِ القاعدةِ وهوَ يتخطّاه (سابقةُ
 *    `active-ride.test.ts`).
 * ــ **لا تُقاسُ رحلةُ المعرِّفِ عبرَ HTTP**: ذاكَ سطحُ البوّابةِ ومقيسٌ في الوحدةِ.
 * ــ **لا تُقاسُ رحلةُ صفٍّ حقيقيٍّ في الطابورِ من إدراجِه إلى استعادتِه في
 *    العاملِ**: بذرُ صفِّ طابورٍ يلزمُه أمرٌ وسائقٌ وعرضٌ بمفاتيحَ أجنبيّةٍ، وذاكَ
 *    مقيسٌ في ملفّاتِ الإرسالِ. والمُقاسُ ههنا وجودُ العمودِ والمُشغِّلِ على
 *    `notification_outbox` في القاعدةِ فعلاً، واستعادةُ العاملِ للمعرِّفِ من صفٍّ
 *    مقيسةٌ في `tests/unit/request-correlation-context.test.ts` — فلا يُزعَمُ ههنا
 *    ما لم يُقَسْ (`ح-5`).
 * ــ **لا يُقاسُ ناقلُ OTel ولا جامِعُه** — ليسا في المستودعِ (`DEC-17` · `F9-01`)،
 *    والبندُ يبقى `[~]` لذلك.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  createSql,
  REQUEST_ID_SETTING,
  type Sql,
  withRequestContext,
} from "../../packages/infrastructure/db/client.ts";
import {
  newCorrelationId,
  runWithCorrelationId,
} from "../../packages/infrastructure/observability/correlation.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

let sql: Sql;
let cityId = "";
const auditIds: string[] = [];

/** كلُّ ما يُكتَبُ ههنا يُوسَمُ بهذا الفعلِ فيُنظَّفُ بدقّةٍ ولا يُمَسُّ غيرُه. */
const ACTION = "f8_01_request_correlation_probe";

describeIf("ارتباطُ الطلبِ يصلُ القاعدةَ — F8-01", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const [city] = await sql<{ id: string }[]>`select id from cities order by id limit 1`;
    if (city === undefined) throw new Error("لا مدينةَ في القاعدةِ — الهجراتُ والبذرُ شرطٌ");
    cityId = city.id;
  });

  afterAll(async () => {
    if (cityId !== "") {
      // تنظيفٌ بالوسمِ وحدَه: لا يُمَسُّ صفٌّ لم يكتبْه هذا الملفُّ.
      await sql`delete from audit_log where action = ${ACTION}`;
    }
    await sql.end({ timeout: 5 });
  });

  it("معرِّفُ السياقِ يصلُ صفَّ `audit_log` المكتوبَ في المعاملةِ نفسِها", async () => {
    const requestId = newCorrelationId();
    const inserted = await runWithCorrelationId({ requestId, entry: "gateway" }, () =>
      withRequestContext(sql, async (tx) => {
        const [row] = await tx<{ id: string }[]>`
          insert into audit_log (city_id, action, entity_type, payload)
          values (${cityId}::uuid, ${ACTION}, 'probe', '{}'::jsonb)
          returning id
        `;
        return row?.id ?? "";
      }),
    );
    expect(inserted).not.toBe("");
    auditIds.push(inserted);

    const [stored] = await sql<{ request_id: string | null }[]>`
      select request_id from audit_log where id = ${inserted}::uuid
    `;
    expect(stored?.request_id).toBe(requestId);
  });

  it("بلا سياقٍ: العمودُ `NULL` ولا معرِّفَ يُلفَّقُ في القاعدةِ", async () => {
    const [row] = await withRequestContext(
      sql,
      (tx) => tx<{ id: string }[]>`
      insert into audit_log (city_id, action, entity_type, payload)
      values (${cityId}::uuid, ${ACTION}, 'probe', '{}'::jsonb)
      returning id
    `,
    );
    const id = row?.id ?? "";
    expect(id).not.toBe("");
    auditIds.push(id);

    const [stored] = await sql<{ request_id: string | null }[]>`
      select request_id from audit_log where id = ${id}::uuid
    `;
    expect(stored?.request_id).toBeNull();
  });

  it("المعرِّفُ محدودُ المعاملةِ فلا تُورِّثُه معاملةٌ لتالِيَتِها", async () => {
    const requestId = newCorrelationId();
    await runWithCorrelationId({ requestId, entry: "gateway" }, () =>
      withRequestContext(sql, (tx) => tx`select 1`),
    );

    // معاملةٌ تالِيةٌ **على المُجمَّعِ نفسِه** بلا ضبطٍ: لو كانَ الضبطُ جلسيّاً
    // لَقرأَت المعرِّفَ السابقَ — وهذا هوَ عطبُ التجمُّعِ الذي بُنيَ التصميمُ لمنعِه.
    const [read] = await sql<{ value: string | null }[]>`
      select current_setting(${REQUEST_ID_SETTING}, true) as value
    `;
    expect(read?.value === null || read?.value === "").toBe(true);
  });

  it("قيدُ الشكلِ يرفضُ قيمةً فاسدةً من مُدرِجٍ صريحٍ", async () => {
    let rejected = false;
    try {
      await sql`
        insert into audit_log (city_id, action, entity_type, payload, request_id)
        values (${cityId}::uuid, ${ACTION}, 'probe', '{}'::jsonb, 'bad id!')
      `;
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  it("المُشغِّلُ لا يطمِسُ قيمةً صريحةً صحيحةً", async () => {
    const explicit = "explicit-request-id-1";
    const ambient = newCorrelationId();
    const inserted = await runWithCorrelationId({ requestId: ambient, entry: "gateway" }, () =>
      withRequestContext(sql, async (tx) => {
        const [row] = await tx<{ id: string }[]>`
          insert into audit_log (city_id, action, entity_type, payload, request_id)
          values (${cityId}::uuid, ${ACTION}, 'probe', '{}'::jsonb, ${explicit})
          returning id
        `;
        return row?.id ?? "";
      }),
    );
    auditIds.push(inserted);
    const [stored] = await sql<{ request_id: string | null }[]>`
      select request_id from audit_log where id = ${inserted}::uuid
    `;
    expect(stored?.request_id).toBe(explicit);
  });

  it("القيودُ الثلاثةُ مُتحقَّقةٌ فعلاً — مقروءةً من فهرسِ النظامِ", async () => {
    const rows = await sql<{ conname: string; convalidated: boolean }[]>`
      select conname, convalidated
        from pg_constraint
       where conname in (
         'audit_log_request_id_shape',
         'notification_outbox_request_id_shape',
         'ledger_entries_request_id_shape'
       )
    `;
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.convalidated).toBe(true);
    }
  });

  it("المُشغِّلاتُ الثلاثةُ قائمةٌ على الجداولِ الثلاثةِ — من فهرسِ النظامِ", async () => {
    const rows = await sql<{ tgname: string; relname: string; tgenabled: string }[]>`
      select t.tgname, c.relname, t.tgenabled::text as tgenabled
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
       where not t.tgisinternal
         and t.tgname in (
           'audit_log_set_request_id',
           'notification_outbox_set_request_id',
           'ledger_entries_set_request_id'
         )
       order by t.tgname
    `;
    expect(rows).toHaveLength(3);
    // `O` = مُفعَّلٌ في الوضعِ الأصليِّ. ومُشغِّلٌ مُعطَّلٌ حاضرٌ أسوأُ من غائبٍ:
    // يُقرأُ في الهجرةِ فيُظَنُّ عاملاً وهوَ لا يكتبُ شيئاً.
    for (const row of rows) expect(row.tgenabled).toBe("O");
  });

  it("العمودُ موجودٌ في الجداولِ الثلاثةِ بنوعِه المُعلَنِ", async () => {
    const rows = await sql<{ table_name: string; data_type: string }[]>`
      select table_name, data_type
        from information_schema.columns
       where table_schema = 'public'
         and column_name = 'request_id'
         and table_name in ('audit_log', 'notification_outbox', 'ledger_entries')
       order by table_name
    `;
    expect(rows.map((row) => row.table_name)).toEqual([
      "audit_log",
      "ledger_entries",
      "notification_outbox",
    ]);
    for (const row of rows) expect(row.data_type).toBe("text");
  });

  it("`current_request_id()` تردُّ `NULL` بلا ضبطٍ ولا ترمي", async () => {
    const [row] = await sql<{ value: string | null }[]>`select current_request_id() as value`;
    expect(row?.value).toBeNull();
  });
});
