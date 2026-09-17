/**
 * الغرض: **قياسُ الحاجزِ نفسِه** (`F8-06`) بسالبٍ مبذورٍ لكلِّ قاعدةٍ (`ح-7`):
 *   حاجزٌ لم يُرَ ساقطاً لا يُعرَفُ أنَّهُ يقيسُ شيئاً.
 * الحالة: منفَّذٌ فعليّاً — البند `F8-06`.
 * ينتمي إلى: tests/unit
 * يُستخدَمُ من: package.json (`bun run test`)
 * الحاكم: ADR 0135 · ADR 0133 · البند `F8-06`
 *
 * ## القاعدةُ ههنا: **لكلِّ قاعدةٍ سالبٌ يُسقِطُها باسمِها**
 *
 * لا يكفي أن تخرجَ قائمةُ المخالفاتِ غيرَ فارغةٍ: تُطابَقُ **بمُعرِّفِ القاعدةِ**،
 * وإلّا مرَّ سالبٌ يُسقِطُ قاعدةً أخرى وحُسِبَ نجاحاً.
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { discoverLifecycleWriters } from "../../scripts/check-payment-lifecycle-matrix.ts";
import {
  declaredPaymentStatuses,
  functionBodies,
  type LifecycleCase,
  type MatrixInputs,
  PAYMENT_LIFECYCLE_CASES,
  paymentLifecycleViolations,
  readF8_06ClassesFromItemText,
  UNMEASURED_STATUSES,
  writesPaymentLifecycle,
} from "../../scripts/lib/payment-lifecycle-matrix.ts";

const CLASSES = "نجاح، فشل، معلّق، مكرّر، استرجاع، تناقض";
const ROADMAP_ROW = `| F8-06 | مصفوفة اختبار دورة حياة الدفع (${CLASSES}) | \`[ ]\` | عالية |\n`;
const STATUSES = ["active", "pending", "past_due", "failed", "canceled", "expired", "refunded"];
/**
 * كُتّابُ الأرضيّةِ: **واحدٌ فقط** لأنَّ القاعدةَ التاسعةَ تُلزِمُ أن يُمارَسَ كلُّ
 * كاتبٍ مُكتشَفٍ. فأرضيّةٌ تذكرُ خمسةً وتُمارِسُ واحداً **ليست نظيفةً**، وتنظيفُها
 * بتخفيفِ القاعدةِ لا بتصحيحِ الأرضيّةِ هوَ عينُ ما يُمنَعُ.
 */
const WRITERS = ["confirm_payment"];

/** حالةٌ سليمةٌ واحدةٌ لكلِّ صنفٍ — أرضيّةُ البذرِ. */
const sound: LifecycleCase[] = [
  ...(["نجاح", "فشل", "معلّق", "مكرّر", "استرجاع", "تناقض"] as const).map((cls, i) => ({
    id: `S-0${i + 1}`,
    lifecycleClass: cls,
    writer: "confirm_payment",
    resultingStatus: null,
    testFile: "tests/integration/payment-lifecycle-matrix.test.ts",
    testName: `حالةٌ سليمةٌ ${i + 1}`,
    measuredEffect: "أثرٌ مقروءٌ مكتوبٌ بطولٍ يكفي القاعدةَ السادسةَ ولا يُقتضَبُ",
  })),
];

function inputs(overrides: Partial<MatrixInputs> = {}): MatrixInputs {
  return {
    roadmapText: ROADMAP_ROW,
    discoveredWriters: WRITERS,
    declaredStatuses: STATUSES,
    pathExists: () => true,
    readTestFile: () => sound.map((c) => c.testName).join("\n"),
    cases: sound,
    unmeasured: STATUSES.map((status) => ({
      status,
      reason: "سببٌ مكتوبٌ بطولٍ يكفي القاعدةَ الحادية عشرةَ فلا يُقرأُ اقتضاباً",
    })),
    ...overrides,
  };
}

const rules = (v: { rule: string }[]): string[] => [...new Set(v.map((x) => x.rule))];

describe("حاجزُ مصفوفةِ دورةِ حياةِ الدفعِ — سالبٌ لكلِّ قاعدةٍ", () => {
  it("الأرضيّةُ نظيفةٌ: لا مخالفةَ بلا بذرٍ", () => {
    expect(paymentLifecycleViolations(inputs())).toEqual([]);
  });

  it("classes.readable-from-item-text: صفُّ البندِ غيرُ مقروءٍ", () => {
    const v = paymentLifecycleViolations(inputs({ roadmapText: "لا صفَّ ههنا" }));
    expect(rules(v)).toContain("classes.readable-from-item-text");
  });

  it("classes.every-one-covered: صنفٌ في النصِّ بلا حالةٍ", () => {
    const v = paymentLifecycleViolations(inputs({ cases: sound.slice(0, 5) }));
    expect(rules(v)).toContain("classes.every-one-covered");
  });

  it("classes.no-invented-class: صنفٌ في المصفوفةِ ليسَ في النصِّ", () => {
    const v = paymentLifecycleViolations(
      inputs({
        roadmapText: `| F8-06 | مصفوفة اختبار دورة حياة الدفع (نجاح، فشل، معلّق، مكرّر، استرجاع) | \`[ ]\` | عالية |\n`,
      }),
    );
    expect(rules(v)).toContain("classes.no-invented-class");
  });

  it("id.unique: معرِّفٌ مكرَّرٌ", () => {
    const first = sound[0];
    if (first === undefined) throw new Error("fixture");
    const v = paymentLifecycleViolations(inputs({ cases: [...sound, { ...first }] }));
    expect(rules(v)).toContain("id.unique");
  });

  it("writer.exists-in-migrations: كاتبٌ لا وجودَ لهُ في الهجراتِ", () => {
    const first = sound[0];
    if (first === undefined) throw new Error("fixture");
    const v = paymentLifecycleViolations(
      inputs({ cases: [{ ...first, writer: "pay_from_nowhere" }, ...sound.slice(1)] }),
    );
    expect(rules(v)).toContain("writer.exists-in-migrations");
  });

  it("status.declared-in-constraint: حالٌ ناتجٌ ليسَ في القيدِ", () => {
    const first = sound[0];
    if (first === undefined) throw new Error("fixture");
    const v = paymentLifecycleViolations(
      inputs({ cases: [{ ...first, resultingStatus: "paid" }, ...sound.slice(1)] }),
    );
    expect(rules(v)).toContain("status.declared-in-constraint");
  });

  it("test.file-exists: إحالةٌ إلى ملفٍّ غيرِ موجودٍ", () => {
    const v = paymentLifecycleViolations(inputs({ pathExists: () => false }));
    expect(rules(v)).toContain("test.file-exists");
  });

  it("test.name-present-verbatim: الملفُّ موجودٌ والاسمُ ليسَ فيهِ", () => {
    const v = paymentLifecycleViolations(inputs({ readTestFile: () => "ملفٌّ بلا أسماءٍ" }));
    expect(rules(v)).toContain("test.name-present-verbatim");
  });

  it("effect.written: أثرٌ مقتضبٌ لا يُقبَلُ", () => {
    const first = sound[0];
    if (first === undefined) throw new Error("fixture");
    const v = paymentLifecycleViolations(
      inputs({ cases: [{ ...first, measuredEffect: "يعملُ" }, ...sound.slice(1)] }),
    );
    expect(rules(v)).toContain("effect.written");
  });

  it("status.measured-or-declared: حالٌ في القيدِ بلا قياسٍ ولا إعلانِ دَينٍ", () => {
    const v = paymentLifecycleViolations(inputs({ unmeasured: [] }));
    expect(rules(v)).toContain("status.measured-or-declared");
  });

  it("status.debt-reason-written: دَينٌ بسببٍ مقتضبٍ", () => {
    const v = paymentLifecycleViolations(
      inputs({ unmeasured: STATUSES.map((status) => ({ status, reason: "لاحقاً" })) }),
    );
    expect(rules(v)).toContain("status.debt-reason-written");
  });

  it("debt.not-already-measured: دَينٌ مُعلَنٌ لحالٍ مقيسةٍ فعلاً", () => {
    const first = sound[0];
    if (first === undefined) throw new Error("fixture");
    const v = paymentLifecycleViolations(
      inputs({
        cases: [{ ...first, resultingStatus: "active" }, ...sound.slice(1)],
      }),
    );
    expect(rules(v)).toContain("debt.not-already-measured");
  });

  it("debt.status-in-constraint: دَينٌ لحالٍ ليسَ في القيدِ", () => {
    const v = paymentLifecycleViolations(
      inputs({
        unmeasured: [
          {
            status: "paid",
            reason: "سببٌ مكتوبٌ بطولٍ يكفي القاعدةَ ولا يُقرأُ اقتضاباً ألبتَّةَ",
          },
        ],
      }),
    );
    expect(rules(v)).toContain("debt.status-in-constraint");
  });

  it("writer.exercised-by-a-case: كاتبٌ مُكتشَفٌ لا تُمارِسُه حالةٌ", () => {
    const v = paymentLifecycleViolations(
      inputs({ discoveredWriters: [...WRITERS, "sneaky_payment_writer"] }),
    );
    expect(rules(v)).toContain("writer.exercised-by-a-case");
  });

  it("القاعدةُ التاسعةُ تُسقِطُ أرضيّةً تذكرُ كاتبَ الإنتاجِ ولا تُمارِسُه", () => {
    const v = paymentLifecycleViolations(
      inputs({ discoveredWriters: [...WRITERS, "refund_subscription_payment"] }),
    );
    expect(rules(v)).toContain("writer.exercised-by-a-case");
  });
});

describe("الاكتشافُ يقرأُ ما هوَ لا ما يُشتهى", () => {
  it("يقتطعُ الجسمَ بأيِّ وسمِ اقتباسٍ دولاريٍّ لا بـ$$ وحدَها", () => {
    const sql = `create or replace function f_one(p integer) returns void language plpgsql as $fn$
begin update payment_transactions set status='failed'; end $fn$;
create or replace function f_two(p integer) returns void language plpgsql as $$
begin select 1; end $$;`;
    const bodies = functionBodies(sql);
    expect(bodies.map((b) => b.name)).toEqual(["f_one", "f_two"]);
    expect(writesPaymentLifecycle(bodies[0]?.body ?? "")).toBe(true);
    // ولا يُنسَبُ إلى الثانيةِ ما كتبَته الأولى.
    expect(writesPaymentLifecycle(bodies[1]?.body ?? "")).toBe(false);
  });

  it("آخرُ تعريفٍ يغلبُ: كاتبٌ نُزِعَت كتابتُه لا يُعَدُّ كاتباً", () => {
    const early =
      "create or replace function f(p integer) returns void language plpgsql as $$ begin update payment_transactions set status='x'; end $$;";
    const late =
      "create or replace function f(p integer) returns void language plpgsql as $$ begin select 1; end $$;";
    expect(discoverLifecycleWriters([early])).toEqual(["f"]);
    expect(discoverLifecycleWriters([early, late])).toEqual([]);
  });

  it("القيدُ يُقرأُ من الجدولِ عينِه لا من جدولٍ مجاورٍ", () => {
    const sql = `create table other_thing (id uuid, status text check (status in ('a','b')));
create table payment_transactions (id uuid, status text check (status in ('pending','active')));`;
    expect(declaredPaymentStatuses([sql])).toEqual(["pending", "active"]);
  });
});

describe("المستودَعُ الحقيقيُّ يُقرأُ لا يُفترَضُ", () => {
  const files = readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const orderedSql = files.map((f) => readFileSync(join("supabase/migrations", f), "utf8"));

  it("أصنافُ البندِ الستّةُ مقروءةٌ من ROADMAP-MASTER حرفاً", () => {
    const classes = readF8_06ClassesFromItemText(readFileSync("docs/ROADMAP-MASTER.md", "utf8"));
    expect(classes).toEqual(["نجاح", "فشل", "معلّق", "مكرّر", "استرجاع", "تناقض"]);
  });

  it("كلُّ كاتبٍ مُكتشَفٍ في الهجراتِ تُمارِسُه حالةٌ في المصفوفةِ", () => {
    const discovered = discoverLifecycleWriters(orderedSql);
    expect(discovered.length).toBeGreaterThan(0);
    const exercised = new Set(PAYMENT_LIFECYCLE_CASES.map((c) => c.writer));
    expect(discovered.filter((w) => !exercised.has(w))).toEqual([]);
  });

  it("كلُّ حالٍ في قيدِ المخطَّطِ مقيسٌ أو مُعلَنٌ دَيناً", () => {
    const statuses = declaredPaymentStatuses(orderedSql);
    expect(statuses).toContain("refunded");
    const produced = new Set(
      PAYMENT_LIFECYCLE_CASES.map((c) => c.resultingStatus).filter((s) => s !== null),
    );
    const declaredDebt = new Set(UNMEASURED_STATUSES.map((u) => u.status));
    expect(statuses.filter((s) => !produced.has(s) && !declaredDebt.has(s))).toEqual([]);
  });
});
