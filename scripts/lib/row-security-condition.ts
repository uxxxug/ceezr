/**
 * الغرض: `SEC-10` — تدقيقٌ ساكنٌ **يُنفِذُ الشرطَ الحاكمَ في `ADR 0006`**: لا
 *   مفتاحَ `anon` ولا دورَ `authenticated` ولا `public` يمسُّ القاعدةَ قبلَ
 *   سياساتٍ فعليّةٍ و`force row level security` واختبارِ تكاملٍ بدورٍ غيرِ مالكٍ.
 *   والدالّةُ نقيّةٌ: تأخذُ نصَّ الهجراتِ ونصَّ المصدرِ وتُعيدُ مشكلاتٍ مُصنَّفةً،
 *   فتُزرَعُ لها سالبةٌ لكلِّ قاعدةٍ (`ح-7`) بلا لمسِ قرصٍ.
 * الحالة: مُستخدَمٌ من `scripts/check-row-security-condition.ts` ومن اختبارِ وحدةٍ.
 * ينتمي إلى: scripts/lib
 * يُستخدَمُ من: البوابةُ في CI · `tests/unit/check-row-security-condition.test.ts`
 * يحرسُه: نفسُه (`GUARD_FILE`) — حاجزٌ لا يحرسُ وجودَ دليلِه حاجزٌ يُنسَخُ بحذفِ ملفٍ.
 * الحاكم: `docs/adr/0140-an-enabled-row-policy-with-no-measured-effect-is-a-schema-decoration.md`
 *   · `docs/adr/0006-rls-bypassed-by-direct-connection.md`
 *
 * ## لِمَ ساكنٌ لا مقيسٌ ههنا
 *
 * أثرُ `RLS` يُقاسُ على قاعدةٍ حقيقيّةٍ في `tests/integration/row-security-effect.test.ts`.
 * وهذا الملفُّ يحرسُ ما **لا تراهُ قاعدةٌ**: لحظةَ يكتبُ أحدُهم سياسةً لِـ`anon` أو
 * يُدخِلُ مفتاحاً عامّاً في مصدرٍ، فتنقلبُ القاعدةُ من «منعٍ شاملٍ مُعلَنٍ» إلى
 * «بابٍ مفتوحٍ بلا ضابطٍ» **بسطرٍ واحدٍ يمرُّ في مراجعةٍ**. و`ADR 0006` نفسُهُ
 * يقولُ إنَّهُ وُجِدَ ليمنعَ لحظةَ النسيانِ تلكَ — ونصٌّ يُقرأُ بالنيّةِ لا يمنعُها.
 *
 * ## وما لا يفعلُه عن قصدٍ
 *
 * - **لا يمنعُ كتابةَ سياساتٍ حقيقيّةٍ إلى الأبدِ**: يمنعُها **بلا** الشرطِ
 *   الثلاثيِّ. ومَن استوفاهُ سجَّلَ في `POLICY_EXCEPTIONS` بسببٍ ودليلٍ ومرَّ.
 * - **لا يفحصُ صحّةَ سياسةٍ منطقيّاً**: أنَّ `using` تُطابِقُ الملكيّةَ حكمٌ
 *   لا يُقرَأُ من نصٍّ؛ ذلكَ عملُ اختبارِ الدورِ غيرِ المالكِ لا عملُ مُطابِقٍ.
 * - **لا يفحصُ قاعدةً جاريةً**: مخطَّطُ الإنتاجِ يُقاسُ في اختبارِ التكاملِ.
 */

/** ملفُّ القياسِ الذي بلا وجودِه يصيرُ هذا الحاجزُ دعوى بلا سندٍ. */
export const EFFECT_TEST_FILE = "tests/integration/row-security-effect.test.ts";
/** ملفُّ الحاجزِ نفسُه — يُذكَرُ ليُقرأَ في الرسالةِ لا ليُفحَصَ. */
export const GUARD_FILE = "scripts/check-row-security-condition.ts";

/** الأدوارُ التي لا يُسمَحُ لسياسةٍ أن تُخوِّلَها قبلَ الشرطِ الثلاثيِّ. */
export const FORBIDDEN_POLICY_ROLES = ["anon", "authenticated", "public"] as const;

/**
 * أسماءُ متغيّراتٍ ومساراتٍ تعني «القاعدةُ تُمَسُّ بمفتاحٍ عامٍّ لا بمالكٍ».
 * والقائمةُ **مُغلَقةٌ**: ما لم يُذكَر ههنا لا يُفحَصُ — وذلكَ حدُّها المُعلَنُ.
 */
export const PUBLIC_KEY_MARKERS = [
  "SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "sb_publishable_",
  "/rest/v1/",
] as const;

/** أصنافُ المشكلاتِ — مغلقةٌ، وكلٌّ منها لها سالبةٌ مزروعةٌ في اختبارِ الوحدةِ. */
export type RowSecurityProblemKind =
  | "POLICY_FOR_FORBIDDEN_ROLE"
  | "FORCE_WITHOUT_CONDITION"
  | "RLS_DISABLED"
  | "PUBLIC_KEY_IN_SOURCE"
  | "EFFECT_TEST_MISSING";

export type RowSecurityProblem = {
  readonly kind: RowSecurityProblemKind;
  readonly where: string;
  readonly problem: string;
};

export type SqlFile = { readonly path: string; readonly sql: string };
export type SourceFile = { readonly path: string; readonly source: string };

export type AuditInput = {
  readonly migrations: readonly SqlFile[];
  readonly sources: readonly SourceFile[];
  /** هل ملفُّ قياسِ الأثرِ موجودٌ فعلاً على القرصِ. */
  readonly effectTestPresent: boolean;
};

/**
 * استثناءٌ مُسجَّلٌ: دورٌ صارَ مسموحاً لأنَّ الشرطَ الثلاثيَّ استُوفيَ ودُلَّ عليهِ.
 * فارغٌ اليومَ — وفراغُهُ **هوَ** حالُ `SEC-10` مقروءاً في سطرٍ واحدٍ.
 */
export const POLICY_EXCEPTIONS: readonly {
  readonly role: string;
  readonly table: string;
  readonly reason: string;
  readonly evidence: string;
}[] = [];

/** يُجرَّدُ التعليقُ ويُوحَّدُ البياضُ وتُصغَّرُ الحروفُ — فلا يُخفي تنسيقٌ سطراً. */
function normalizeSql(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** اسمُ الجدولِ في `create policy … on <table>` مُجرَّداً من المخطَّطِ والعلامةِ. */
function policyTable(statement: string): string {
  const match = /\bon\s+("?[\w.]+"?)/.exec(statement);
  const raw = match?.[1] ?? "?";
  return raw.replace(/"/g, "").split(".").pop() ?? "?";
}

function isExcepted(role: string, table: string): boolean {
  return POLICY_EXCEPTIONS.some(
    (entry) => entry.role === role && (entry.table === table || entry.table === "*"),
  );
}

/** تدقيقٌ نقيٌّ: لا قرصَ ولا شبكةَ ولا وقتَ — نصٌّ داخلٌ ومشكلاتٌ خارجةٌ. */
export function auditRowSecurityCondition(input: AuditInput): RowSecurityProblem[] {
  const problems: RowSecurityProblem[] = [];

  if (!input.effectTestPresent) {
    problems.push({
      kind: "EFFECT_TEST_MISSING",
      where: EFFECT_TEST_FILE,
      problem: "ملفُّ قياسِ أثرِ RLS غائبٌ — فالحاجزُ الساكنُ يحرسُ شرطاً بلا قياسٍ يسنده",
    });
  }

  for (const file of input.migrations) {
    const sql = normalizeSql(file.sql);

    for (const statement of sql.match(/create\s+policy[^;]*/g) ?? []) {
      const table = policyTable(statement);
      const toClause = /\bto\s+([\w\s,"]+?)(?:\s+using|\s+with\s+check|$)/.exec(statement);
      const roles = (toClause?.[1] ?? "public")
        .split(",")
        .map((role) => role.trim().replace(/"/g, ""))
        .filter((role) => role.length > 0);
      for (const role of roles) {
        if (!FORBIDDEN_POLICY_ROLES.includes(role as (typeof FORBIDDEN_POLICY_ROLES)[number])) {
          continue;
        }
        if (isExcepted(role, table)) continue;
        problems.push({
          kind: "POLICY_FOR_FORBIDDEN_ROLE",
          where: `${file.path} · ${table}`,
          problem: `سياسةٌ تُخوِّلُ «${role}» بلا الشرطِ الثلاثيِّ في ADR 0006 (سياساتٌ فعليّةٌ + force + اختبارُ دورٍ غيرِ مالكٍ)`,
        });
      }
    }

    if (/\bforce\s+row\s+level\s+security\b/.test(sql) && POLICY_EXCEPTIONS.length === 0) {
      problems.push({
        kind: "FORCE_WITHOUT_CONDITION",
        where: file.path,
        problem: "force row level security بلا سياساتٍ مُسجَّلةٍ — يوقِفُ الخدمةَ فوراً لأنَّها تتّصلُ بالمالكِ",
      });
    }

    if (/\b(disable\s+row\s+level\s+security|no\s+force\s+row\s+level\s+security)\b/.test(sql)) {
      problems.push({
        kind: "RLS_DISABLED",
        where: file.path,
        problem: "تعطيلُ RLS أو رفعُ force — إشارةُ المخطَّطِ تُخفَضُ بلا بديلٍ مُعلَنٍ",
      });
    }
  }

  for (const file of input.sources) {
    for (const marker of PUBLIC_KEY_MARKERS) {
      if (!file.source.includes(marker)) continue;
      problems.push({
        kind: "PUBLIC_KEY_IN_SOURCE",
        where: `${file.path} · ${marker}`,
        problem:
          "مساسٌ بالقاعدةِ بمفتاحٍ عامٍّ (anon/PostgREST) والسياساتُ اليومَ منعٌ شاملٌ — فالنتيجةُ عطبٌ صامتٌ أو بابٌ بلا ضابطٍ",
      });
    }
  }

  return problems;
}
