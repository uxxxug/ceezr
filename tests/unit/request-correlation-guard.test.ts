/**
 * الغرض: **السلبيّاتُ المبذورةُ** لحاجزِ `F8-01` (`ح-7`): لكلِّ قاعدةٍ في
 *    `auditRequestCorrelation` حالةُ خرقٍ مُصنَّعةٌ تُثبتُ أنّها تُخفِقُ فعلاً —
 *    فقاعدةٌ بلا سلبيٍّ مبذورٍ ليست منفَذةً، وإنّما مكتوبةً.
 * الحالة: منفّذ فعلياً — اختبارُ حاجزٍ.
 * ينتمي إلى: tests/unit
 * الحاكم: ADR 0129 · البند `F8-01`
 * ملاحظات مستقبلية: كلُّ قاعدةٍ تُضافُ إلى العقدِ تلزمُها حالتانِ ههنا: خرقٌ
 *    يُرى، ونظيفٌ لا يُصرَخُ عليه بالغلطِ.
 */

import { describe, expect, test } from "bun:test";
import {
  auditRequestCorrelation,
  CORRELATED_CALL_SITES,
  CORRELATED_TABLES,
  CORRELATION_MIGRATION,
  type CorrelationSources,
  DB_CONTEXT_FILE,
  EDGE_ENTRY_FILE,
  LOG_EMITTER_FILE,
  REQUEST_ID_SETTING,
  WORKER_RUNNER_FILE,
} from "../../scripts/lib/request-correlation-contract.ts";

function migrationText(): string {
  const parts: string[] = [
    `create function public.current_request_id() ... current_setting('${REQUEST_ID_SETTING}', true)`,
  ];
  for (const table of CORRELATED_TABLES) {
    parts.push(`alter table public.${table} add column if not exists request_id text;`);
    parts.push(
      `alter table public.${table} add constraint ${table}_request_id_shape check (true) not valid;`,
    );
    parts.push(
      `create trigger ${table}_set_request_id before insert on public.${table} for each row execute function public.set_request_id();`,
    );
  }
  return parts.join("\n");
}

function validateText(): string {
  return CORRELATED_TABLES.map(
    (table) => `alter table public.${table} validate constraint ${table}_request_id_shape;`,
  ).join("\n");
}

function cleanSources(): CorrelationSources {
  const sources: Record<string, string> = {
    [EDGE_ENTRY_FILE]: "runWithCorrelation(correlation, () => next());",
    [LOG_EMITTER_FILE]: "const id = currentRequestId(); line.request_id = id;",
    [WORKER_RUNNER_FILE]: "return runWithCorrelationId({ requestId: id, entry: 'worker' }, run);",
    [DB_CONTEXT_FILE]: `export async function withRequestContext(sql, run) { '${REQUEST_ID_SETTING}' }`,
  };
  for (const site of CORRELATED_CALL_SITES) {
    sources[site.file] = `withRequestContext(sql, (tx) => tx\`select ${site.rpc}()\`)`;
  }
  return {
    migration: migrationText(),
    validateMigration: validateText(),
    allMigrations: { [CORRELATION_MIGRATION]: migrationText() },
    sources,
  };
}

function rules(input: CorrelationSources): readonly string[] {
  return auditRequestCorrelation(input).map((finding) => finding.rule);
}

describe("حاجزُ سلسلةِ ارتباطِ الطلبِ — F8-01", () => {
  test("النصوصُ السليمةُ تمرُّ بلا خرقٍ واحدٍ", () => {
    expect(auditRequestCorrelation(cleanSources())).toEqual([]);
  });

  test("عمودٌ ناقصٌ في جدولٍ موصولٍ يُرى", () => {
    const input = cleanSources();
    const broken = {
      ...input,
      migration: input.migration.replace(
        `alter table public.${CORRELATED_TABLES[0]} add column if not exists request_id text;`,
        "",
      ),
    };
    expect(rules(broken)).toContain("table.column");
  });

  test("قيدُ شكلٍ ناقصٌ يُرى", () => {
    const input = cleanSources();
    const broken = {
      ...input,
      migration: input.migration.replaceAll(`${CORRELATED_TABLES[1]}_request_id_shape`, "x_shape"),
      validateMigration: input.validateMigration.replaceAll(
        `${CORRELATED_TABLES[1]}_request_id_shape`,
        "x_shape",
      ),
    };
    expect(rules(broken)).toContain("table.check");
  });

  test("مُشغِّلٌ ناقصٌ يُرى", () => {
    const input = cleanSources();
    const broken = {
      ...input,
      migration: input.migration.replaceAll(`${CORRELATED_TABLES[2]}_set_request_id`, "x_trigger"),
    };
    expect(rules(broken)).toContain("table.trigger");
  });

  test("قيدٌ لم يُتحقَّقْ في طورِ validate يُرى", () => {
    const input = cleanSources();
    expect(rules({ ...input, validateMigration: "-- لا شيءَ" })).toContain("table.validate");
  });

  test("هجرةٌ تُدرِجُ `request_id` صريحاً تُرَدُّ", () => {
    const input = cleanSources();
    const broken = {
      ...input,
      allMigrations: {
        ...input.allMigrations,
        "supabase/migrations/9999_bad.sql": `insert into audit_log (id, city_id, action, request_id) values (1, 'JED', 'x', 'forged');`,
      },
    };
    expect(rules(broken)).toContain("insert.explicit");
  });

  test("إدراجٌ لا يذكرُ العمودَ لا يُصرَخُ عليه", () => {
    const input = cleanSources();
    const fine = {
      ...input,
      allMigrations: {
        ...input.allMigrations,
        "supabase/migrations/9999_ok.sql": `insert into audit_log (id, city_id, action) values (1, 'JED', 'x');`,
      },
    };
    expect(rules(fine)).toEqual([]);
  });

  test("اسمُ المتغيّرِ الجلسيِّ في ملفٍّ غيرِ مُعلَنٍ يُرى", () => {
    const input = cleanSources();
    const broken = {
      ...input,
      sources: {
        ...input.sources,
        "packages/infrastructure/other/leak.ts": `select set_config('${REQUEST_ID_SETTING}', id, true)`,
      },
    };
    expect(rules(broken)).toContain("setting.leak");
  });

  test("قراءةُ ترويسةِ الطلبِ الوارِدةِ في سطحِ الخادمِ تُرَدُّ (ADR 0043)", () => {
    const input = cleanSources();
    const broken = {
      ...input,
      sources: {
        ...input.sources,
        "apps/gateway/src/routes/bad.ts": `const id = request.headers.get("x-request-id");`,
      },
    };
    expect(rules(broken)).toContain("header.incoming");
  });

  test("قراءةُ الترويسةِ في الواجهةِ من **ردِّنا** لا تُرَدُّ (F1-08)", () => {
    const input = cleanSources();
    const fine = {
      ...input,
      sources: {
        ...input.sources,
        "apps/miniapp/src/api/client.ts": `const id = res.headers.get("x-request-id");`,
      },
    };
    expect(rules(fine)).toEqual([]);
  });

  test("حافةٌ لا تلفُّ الطلبَ بسياقٍ تُرَدُّ", () => {
    const input = cleanSources();
    const broken = {
      ...input,
      sources: { ...input.sources, [EDGE_ENTRY_FILE]: "const id = newCorrelationId();" },
    };
    expect(rules(broken)).toContain("edge.context");
  });

  test("سجلٌّ لا يُلحِقُ المعرِّفَ يُرَدُّ", () => {
    const input = cleanSources();
    const broken = {
      ...input,
      sources: { ...input.sources, [LOG_EMITTER_FILE]: "emit(line);" },
    };
    expect(rules(broken)).toContain("log.attach");
  });

  test("شوطُ مهمّةٍ بلا سياقٍ يُرَدُّ", () => {
    const input = cleanSources();
    const broken = {
      ...input,
      sources: { ...input.sources, [WORKER_RUNNER_FILE]: "await job.run();" },
    };
    expect(rules(broken)).toContain("worker.context");
  });

  test("موضعٌ موصولٌ مُعلَنٌ بلا لفٍّ يُرَدُّ", () => {
    const input = cleanSources();
    const site = CORRELATED_CALL_SITES[0];
    if (site === undefined) throw new Error("سجلُّ المواضعِ فارغٌ");
    const broken = {
      ...input,
      sources: { ...input.sources, [site.file]: `sql\`select ${site.rpc}()\`` },
    };
    expect(rules(broken)).toContain("callsite.unwrapped");
  });

  test("سجلٌّ يذكرُ دالّةً لا وجودَ لها في الملفِّ يُرَدُّ — لا يُترَكُ قديماً", () => {
    const input = cleanSources();
    const site = CORRELATED_CALL_SITES[1];
    if (site === undefined) throw new Error("سجلُّ المواضعِ فارغٌ");
    const broken = {
      ...input,
      sources: { ...input.sources, [site.file]: "withRequestContext(sql, (tx) => tx`select 1`)" },
    };
    expect(rules(broken)).toContain("callsite.rpc");
  });

  test("تعريفٌ ثانٍ لـ`withRequestContext` يُرَدُّ — موضعُ الضبطِ واحدٌ", () => {
    const input = cleanSources();
    const broken = {
      ...input,
      sources: {
        ...input.sources,
        "packages/infrastructure/other/second.ts":
          "export async function withRequestContext(sql, run) { return run(sql); }",
      },
    };
    expect(rules(broken)).toContain("context.duplicate");
  });

  test("توليدُ معرِّفٍ في طبقةِ القاعدةِ يُرَدُّ — الغيابُ يبقى غياباً", () => {
    const input = cleanSources();
    const broken = {
      ...input,
      sources: {
        ...input.sources,
        [DB_CONTEXT_FILE]: `export async function withRequestContext(sql, run) { const id = newCorrelationId(); '${REQUEST_ID_SETTING}' }`,
      },
    };
    expect(rules(broken)).toContain("db.fabricate");
  });

  test("ملفٌّ مفقودٌ يُرى عطباً لا يُمرَّرُ صامتاً", () => {
    const input = cleanSources();
    const sources = { ...input.sources };
    delete sources[EDGE_ENTRY_FILE];
    delete sources[LOG_EMITTER_FILE];
    delete sources[WORKER_RUNNER_FILE];
    delete sources[DB_CONTEXT_FILE];
    const found = rules({ ...input, sources });
    expect(found).toContain("edge.missing");
    expect(found).toContain("log.missing");
    expect(found).toContain("worker.missing");
    expect(found).toContain("db.missing");
  });
});
