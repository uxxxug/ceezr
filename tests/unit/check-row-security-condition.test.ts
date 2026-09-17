/**
 * الغرض: `ح-7` لحاجزِ `SEC-10` — سالبةٌ مزروعةٌ **لكلِّ صنفِ مشكلةٍ** في
 *   `auditRowSecurityCondition`، ومُوجَبةٌ تُثبِتُ أنَّ الحاجزَ لا يسقطُ بلا سببٍ.
 *   وقاعدةٌ بلا سالبةٍ قاعدةٌ لا يُعرَفُ أنَّها تعملُ.
 * الحالة: اختبارُ وحدةٍ — بلا قرصٍ ولا قاعدةٍ.
 * ينتمي إلى: tests/unit
 * يُستخدَمُ من: سلسلةُ `bun test tests/unit` في CI.
 * يحرسُه: `scripts/check-no-skipped-tests.ts` (لا تخطّيَ ههنا).
 * الحاكم: `docs/adr/0140-an-enabled-row-policy-with-no-measured-effect-is-a-schema-decoration.md`
 * ما لا يفعلُه عن قصدٍ:
 *   - لا يقيسُ أثرَ `RLS`؛ ذلكَ قياسٌ على قاعدةٍ حقيقيّةٍ في
 *     `tests/integration/row-security-effect.test.ts`.
 *   - لا يفحصُ المستودعَ الحقيقيَّ؛ يفحصُ الدالّةَ النقيّةَ بنصوصٍ مزروعةٍ. وتطبيقُها
 *     على المستودعِ هوَ عملُ الحاجزِ في CI.
 */

import { describe, expect, it } from "bun:test";
import {
  auditRowSecurityCondition,
  EFFECT_TEST_FILE,
  FORBIDDEN_POLICY_ROLES,
  POLICY_EXCEPTIONS,
  PUBLIC_KEY_MARKERS,
  type RowSecurityProblemKind,
} from "../../scripts/lib/row-security-condition.ts";

/** مدخلٌ سليمٌ: سياسةٌ لدورِ الخدمةِ وحدَها، وملفُّ القياسِ موجودٌ. */
const CLEAN = {
  migrations: [
    {
      path: "supabase/migrations/0001_x.sql",
      sql: `alter table orders enable row level security;
            create policy orders_service_all on public.orders for all to service_role using (true);`,
    },
  ],
  sources: [
    { path: "apps/gateway/src/index.ts", source: "const x = createSql(config.databaseUrl);" },
  ],
  effectTestPresent: true,
} as const;

function kinds(problems: readonly { kind: RowSecurityProblemKind }[]): RowSecurityProblemKind[] {
  return problems.map((problem) => problem.kind);
}

describe("SEC-10 — حاجزُ شرطِ ADR 0006: سالبةٌ مزروعةٌ لكلِّ قاعدةٍ", () => {
  it("مُوجَبةٌ: مدخلٌ سليمٌ لا يُسقِطُ البناءَ", () => {
    expect(auditRowSecurityCondition(CLEAN)).toEqual([]);
  });

  for (const role of FORBIDDEN_POLICY_ROLES) {
    it(`سالبةٌ: سياسةٌ تُخوِّلُ «${role}» تُسقِطُ البناءَ`, () => {
      const problems = auditRowSecurityCondition({
        ...CLEAN,
        migrations: [
          {
            path: "supabase/migrations/9999_open.sql",
            sql: `create policy orders_open on public.orders for select to ${role} using (true);`,
          },
        ],
      });
      expect(kinds(problems)).toContain("POLICY_FOR_FORBIDDEN_ROLE");
      expect(problems[0]?.where).toContain("orders");
    });
  }

  it("سالبةٌ: سياسةٌ بلا `to` تُقرأُ public — والصمتُ ليسَ إذناً", () => {
    const problems = auditRowSecurityCondition({
      ...CLEAN,
      migrations: [
        {
          path: "supabase/migrations/9999_implicit.sql",
          sql: "create policy orders_open on orders for select using (true);",
        },
      ],
    });
    expect(kinds(problems)).toContain("POLICY_FOR_FORBIDDEN_ROLE");
  });

  it("سالبةٌ: التعليقُ لا يُخفي سياسةً — التجريدُ قبلَ المُطابَقةِ", () => {
    const problems = auditRowSecurityCondition({
      ...CLEAN,
      migrations: [
        {
          path: "supabase/migrations/9999_comment.sql",
          sql: `-- سياسةٌ تُكتَبُ لاحقاً
                /* شرحٌ */ CREATE   POLICY   orders_open
                  ON   public."orders"   FOR ALL   TO   anon   USING ( true );`,
        },
      ],
    });
    expect(kinds(problems)).toContain("POLICY_FOR_FORBIDDEN_ROLE");
  });

  it("سالبةٌ: `force row level security` بلا استثناءٍ مُسجَّلٍ تُسقِطُ البناءَ", () => {
    const problems = auditRowSecurityCondition({
      ...CLEAN,
      migrations: [
        {
          path: "supabase/migrations/9999_force.sql",
          sql: "alter table orders force row level security;",
        },
      ],
    });
    expect(kinds(problems)).toContain("FORCE_WITHOUT_CONDITION");
  });

  it("سالبةٌ: تعطيلُ RLS أو رفعُ force يُسقِطُ البناءَ", () => {
    for (const sql of [
      "alter table orders disable row level security;",
      "alter table orders no force row level security;",
    ]) {
      const problems = auditRowSecurityCondition({
        ...CLEAN,
        migrations: [{ path: "supabase/migrations/9999_off.sql", sql }],
      });
      expect(kinds(problems)).toContain("RLS_DISABLED");
    }
  });

  for (const marker of PUBLIC_KEY_MARKERS) {
    it(`سالبةٌ: علامةُ مفتاحٍ عامٍّ «${marker}» في المصدرِ تُسقِطُ البناءَ`, () => {
      const problems = auditRowSecurityCondition({
        ...CLEAN,
        sources: [{ path: "apps/miniapp/src/db.ts", source: `const url = "${marker}";` }],
      });
      expect(kinds(problems)).toContain("PUBLIC_KEY_IN_SOURCE");
    });
  }

  it("سالبةٌ: غيابُ ملفِّ قياسِ الأثرِ يُسقِطُ البناءَ — حاجزٌ بلا قياسٍ دعوى", () => {
    const problems = auditRowSecurityCondition({ ...CLEAN, effectTestPresent: false });
    expect(kinds(problems)).toContain("EFFECT_TEST_MISSING");
    expect(problems[0]?.where).toBe(EFFECT_TEST_FILE);
  });

  it("سِجلُّ الاستثناءاتِ فارغٌ اليومَ — وفراغُهُ هوَ حالُ SEC-10 مقروءاً", () => {
    expect(POLICY_EXCEPTIONS).toEqual([]);
  });
});
