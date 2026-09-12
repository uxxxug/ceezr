/**
 * الغرض: قياسُ اشتقاقِ سجلِّ التحوُّلِ والاسترجاعِ ورفضِ التمرينِ (`W-9` · ADR
 *   0088). **وأغلبُ الحالاتِ سالبةٌ**: مِسبارٌ يكتبُ، وطورٌ غيرُ مُعلَنٍ، وحاجزٌ
 *   مجهولٌ، وزعمُ تمامٍ.
 * الحالة: منفّذ فعلياً — `W-9` (زيادةٌ داخلَ حدودِ `B-5`).
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: كلُّ تعديلٍ على مصفوفةِ الهجرةِ أو على حواجزِ
 *   التمرينِ.
 * ملاحظات مستقبلية: لا شيءَ ههنا يُثبِّتُ عددَ الخطواتِ برقمٍ، فالعددُ يتبعُ
 *   المصفوفةَ ويتغيَّرُ بها.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { type Blocker, parseBlockers } from "../../scripts/lib/wasla-blockers.ts";
import {
  CUTOVER_PHASES,
  CutoverDerivationError,
  deriveCutoverPlan,
  isReadOnlyStatement,
  isRehearsalRefused,
  openRehearsalGates,
  REHEARSAL_GATE_BLOCKERS,
  rehearseReadOnly,
  rollbackOrder,
} from "../../scripts/lib/wasla-cutover-plan.ts";
import type { MatrixEntry } from "../../scripts/lib/wasla-migration-matrix.ts";

const REAL_BLOCKERS = parseBlockers(readFileSync("ROADMAP.md", "utf8"));

function entry(overrides: Partial<MatrixEntry> = {}): MatrixEntry {
  return {
    table: "orders",
    mechanism: "SPLIT_TABLE",
    wave: 6,
    prerequisites: ["`O-1`"],
    rollback: "الكتابةُ الثانيةُ تُسقَطُ والمصدرُ يبقى محليّاً.",
    verification: "يُقرأُ تامّاً بمطابقةٍ صفّاً بصفٍّ بينَ الشطرَينِ.",
    executed: false,
    ...overrides,
  } as MatrixEntry;
}

/** سجلٌّ اصطناعيٌّ تُغلَقُ فيه حواجزُ التمرينِ كلُّها — لقياسِ الطرفِ الآخرِ. */
function closedGates(): readonly Blocker[] {
  return REHEARSAL_GATE_BLOCKERS.map((id) => ({
    id,
    kind: "PROGRAMME_BLOCKER" as const,
    status: "CLOSED" as const,
    statement: `حاجزٌ اصطناعيٌّ مُغلَقٌ لقياسِ الطرفِ الآخرِ: ${id}`,
    blocks: "لا شيءَ — سجلٌّ اصطناعيٌّ في اختبارٍ",
  }));
}

describe("الاشتقاقُ من المصفوفةِ لا من كتابةٍ يدويّةٍ", () => {
  const steps = deriveCutoverPlan();

  it("يُشتَقُّ سجلٌّ غيرُ فارغٍ، والموجةُ 0 مستثناةٌ لأنَّها لا تلمسُ صفّاً", () => {
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((step) => step.wave > 0)).toBe(true);
  });

  it("والرتبةُ كلّيّةٌ متصاعدةٌ بلا فراغٍ ولا تكرارٍ", () => {
    expect(steps.map((step) => step.order)).toEqual(steps.map((_, index) => index + 1));
    expect(new Set(steps.map((step) => step.id)).size).toBe(steps.length);
  });

  it("والموجاتُ لا تتراجعُ: لا موجةٌ متأخِّرةٌ قبلَ أسبقَ منها", () => {
    for (const [index, step] of steps.entries()) {
      if (index === 0) continue;
      const previous = steps[index - 1];
      expect(previous?.wave ?? 0).toBeLessThanOrEqual(step.wave);
    }
  });

  it("ولكلِّ خطوةٍ عكسٌ يُشيرُ إليها وحدَها، وطورٌ من القائمةِ المغلقةِ", () => {
    for (const step of steps) {
      expect(step.rollback.inverseOf).toBe(step.id);
      expect(step.rollback.action.trim().length).toBeGreaterThan(0);
      expect(CUTOVER_PHASES).toContain(step.phase);
    }
  });

  it("وترتيبُ الاسترجاعِ **عكسُ** ترتيبِ التحوُّلِ حرفاً بحرفٍ", () => {
    expect(rollbackOrder(steps).map((item) => item.inverseOf)).toEqual(
      steps
        .slice()
        .reverse()
        .map((step) => step.id),
    );
  });

  it("واستعادةُ البياناتِ تُعلَنُ في طورِ التقليصِ وحدَه — مُشتَقّةً لا مكتوبةً", () => {
    for (const step of steps) {
      expect(step.rollback.requiresDataRestore).toBe(step.phase === "contract");
    }
  });

  it("وكلُّ مِسبارٍ للقراءةِ وحدَها، ويسمّي جدولَه", () => {
    for (const step of steps) {
      expect(isReadOnlyStatement(step.probe.statement)).toBe(true);
      expect(step.probe.statement).toContain(step.table);
    }
  });
});

describe("الاشتقاقُ يرفضُ مُدخلاً معطوباً ولا يُكمِلُ ناقصاً", () => {
  it("مُدخلٌ بلا مسارِ عودةٍ ⇒ يرمي", () => {
    expect(() => deriveCutoverPlan([entry({ rollback: "   " })])).toThrow(CutoverDerivationError);
  });

  it("ومُدخلٌ بلا قياسٍ ⇒ يرمي", () => {
    expect(() => deriveCutoverPlan([entry({ verification: "" })])).toThrow(CutoverDerivationError);
  });

  it("واسمُ جدولٍ لا يُقبَلُ معرِّفاً ⇒ يرمي ولا يُركَّبُ نصُّ مِسبارٍ منهُ", () => {
    expect(() => deriveCutoverPlan([entry({ table: "orders; drop table x" })])).toThrow(
      CutoverDerivationError,
    );
  });

  it("وآليّةٌ غيرُ مُعرَّفةٍ ⇒ يرمي ولا تُصنَّفُ طوراً افتراضيّاً", () => {
    expect(() =>
      deriveCutoverPlan([entry({ mechanism: "SOMETHING_NEW" as MatrixEntry["mechanism"] })]),
    ).toThrow(CutoverDerivationError);
  });

  it("وموجةٌ غيرُ مُعلَنةٍ في المصفوفةِ ⇒ يرمي", () => {
    expect(() => deriveCutoverPlan([entry({ wave: 99 })])).toThrow(CutoverDerivationError);
  });

  it("ومصفوفةٌ بلا صفٍّ مُهاجِرٍ ⇒ يرمي ولا يُرَدُّ سجلٌّ فارغٌ يُقرأُ «لا عملَ»", () => {
    expect(() => deriveCutoverPlan([entry({ wave: 0, mechanism: "NONE" })])).toThrow(
      CutoverDerivationError,
    );
  });
});

describe("مُتحقِّقُ القراءةِ وحدَها يُقاسُ بطرفَيهِ", () => {
  const readable = [
    "select 1",
    "explain select 1",
    "select count(*) from public.telegram_update_jobs",
  ];
  const rejected = [
    "",
    "   ",
    "update orders set x = 1",
    "select 1; drop table t",
    "with a as (delete from t returning 1) select 1",
    "select 1 -- تعليقٌ يُلحَقُ به شيءٌ",
    "select 1 /* تعليقٌ */",
    "select * from orders for update",
    "select * from orders for no key update",
    "select pg_sleep(9)",
    "select setval('s', 1)",
    "set transaction read write",
    "select lo_export(1, '/tmp/x')",
  ];

  it("يقبلُ القراءةَ، ومنها اسمُ جدولٍ يحملُ كلمةَ كتابةٍ داخلَه", () => {
    for (const statement of readable) expect(isReadOnlyStatement(statement)).toBe(true);
  });

  it("ويردُّ كلَّ ما ليسَ قراءةً — والفشلُ مغلقٌ على الفارغِ أيضاً", () => {
    for (const statement of rejected) expect(isReadOnlyStatement(statement)).toBe(false);
  });
});

describe("الرفضُ بالإنشاءِ على الخارطةِ الحقيقيّةِ", () => {
  const steps = deriveCutoverPlan();

  it("حواجزُ التمرينِ الأربعةُ مفتوحةٌ اليومَ، فالنتيجةُ `REFUSED`", () => {
    const outcome = rehearseReadOnly(steps, REAL_BLOCKERS);
    expect(isRehearsalRefused(outcome)).toBe(true);
    if (!isRehearsalRefused(outcome)) return;
    expect(outcome.openGates.length).toBeGreaterThan(0);
    expect(outcome.reason).toContain("مرفوضٌ بالإنشاءِ");
  });

  it("ومعرّفٌ غيرُ مُعلَنٍ في السجلِّ يُقرأُ **مفتوحاً** لا مُغلَقاً — الجهلُ ليسَ إذناً", () => {
    expect(openRehearsalGates([])).toEqual([...REHEARSAL_GATE_BLOCKERS]);
  });

  it("وبسجلٍّ اصطناعيٍّ مُغلَقٍ لا يُقالُ «تمَّ التحوُّلُ» — أقصاهُ مِسبارُ قراءةٍ", () => {
    const outcome = rehearseReadOnly(steps, closedGates());
    expect(isRehearsalRefused(outcome)).toBe(false);
    if (isRehearsalRefused(outcome)) return;
    expect(outcome.outcome).toBe("READ_ONLY_PROBED");
    expect(outcome.rehearsalCompleted).toBe(false);
    expect(outcome.probed).toBe(steps.length);
  });

  it("وحتّى بحواجزَ مُغلَقةٍ، مِسبارٌ يكتبُ ⇒ رفضٌ لا مرورٌ", () => {
    const forged = steps.map((step, index) =>
      index === 0
        ? { ...step, probe: { ...step.probe, statement: "update orders set x = 1" } }
        : step,
    );
    const outcome = rehearseReadOnly(forged, closedGates());
    expect(isRehearsalRefused(outcome)).toBe(true);
    if (!isRehearsalRefused(outcome)) return;
    expect(outcome.reason).toContain("ليسَ للقراءةِ وحدَها");
    expect(outcome.openGates).toEqual([]);
  });

  it("ولا حالةَ في النوعِ تُمثِّلُ «تحوُّلاً تامّاً» ألبتّةَ", () => {
    const outcome = rehearseReadOnly(steps, closedGates());
    const outcomes = new Set([outcome.outcome, "REFUSED"]);
    expect(
      [...outcomes].every((value) => value === "REFUSED" || value === "READ_ONLY_PROBED"),
    ).toBe(true);
  });
});
