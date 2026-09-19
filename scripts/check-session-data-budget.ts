#!/usr/bin/env bun
/**
 * # الحاجزُ الساكنُ: حدُّ بياناتِ جلسةِ الراكبِ مقيسٌ ومصدرُه واحدٌ — `F1-09`
 *
 * **الغرض:** أن يستحيلَ أن يُحذَفَ قياسُ استهلاكِ بياناتِ جلسةِ الراكبِ أو
 * يُفرَّغَ أو يُكرَّرَ رقمُه، **قبلَ** أن تُشغَّلَ القاعدةُ. والصفُّ السابعُ من
 * القسمِ 9.9 كانَ عهداً مكتوباً لا يفحصُه شيءٌ منذُ كُتِبَ؛ وهذا الحاجزُ يحرسُ
 * **بقاءَ القياسِ** لا صحّةَ نتيجتِه: النتيجةُ تُقاسُ في `PostgreSQL` حقيقيٍّ.
 *
 * **الحالة:** `F1-09` — مُنفَّذ · مُختبَر · مبرهَنُ السقوطِ (`ح-7`).
 *
 * **ينتمي إلى:** البند `F1-09` · القسمُ 9.9 الصفُّ السابعُ.
 *
 * **يُستخدَمُ من:** سلسلةُ `bun run ci` · خطوةٌ مُسمّاةٌ في `.github/workflows/ci.yml`.
 *
 * **يحرسُه:** `tests/unit/check-session-data-budget.test.ts` — سالبةٌ مبذورةٌ لكلِّ قاعدةٍ.
 *
 * **الحاكم:** `docs/adr/0149-a-session-data-budget-is-measured-not-declared.md`
 *
 * **ما لا يفعلُه هذا الحاجزُ عن قصدٍ:**
 * - **لا يُثبِتُ أنَّ الجلسةَ ضمنَ الحدِّ.** ذاكَ قياسٌ على بوّابةٍ وقاعدةٍ وقناةٍ
 *   حقيقيّةٍ في `tests/integration/rider-session-data-budget.test.ts`، ووجودُ هذا
 *   الحاجزِ **ليسَ** دليلَ التزامٍ.
 * - **لا يقيسُ الصفوفَ الخمسةَ الأُخرى** من القسمِ 9.9 (`FCP`/`LCP`/`TTI`/رسمُ
 *   الخريطةِ): لا متصفِّحَ ههنا، وصمتُه عنها مُعلَنٌ لا مُدَّعىً.
 * - **لا يقرأُ قاعدةً ولا شبكةً.** ساكنٌ عن قصدٍ.
 */

import { existsSync, readFileSync } from "node:fs";
import { BUDGET } from "./lib/performance-budget.ts";
import {
  CONTRACT_ROW_MARKER,
  RIDER_SESSION_PROFILE,
  SESSION_DATA_BUDGET_BYTES,
  SESSION_DATA_TEST_FILE,
  SESSION_RULE_NAMES,
  SESSION_WINDOW_MS,
} from "./lib/session-data-budget.ts";

/** وثيقةُ العقدِ: الصفُّ السابعُ مكتوبٌ فيها، والحاجزُ يُطابِقُ الرقمَينِ. */
const CONTRACT_FILE = "docs/ROADMAP-MASTER.md";
/** سلسلةُ `ci` — منها يُقرأُ بقاءُ حاجزِ منعِ الاستقصاءِ الذي يسندُ شكلَ النافذةِ. */
const PACKAGE_FILE = "package.json";
/** مصدرُ مهلةِ المُرحِّلِ الدنيا — تُستورَدُ ولا تُكتَبُ رقماً في الاختبارِ. */
const RELAY_MODULE = "customer-live-relay";

/** أسماءُ قواعدِ الحاجزِ — مُصدَّرةٌ كي تُبذَرَ سالبةٌ لكلِّ واحدةٍ (`ح-7`). */
export const GUARD_RULE_NAMES = [
  "guard.test-present",
  "guard.imported",
  "guard.budget-asserted",
  "guard.single-source",
  "guard.contract-row",
  "guard.relay-imported",
  "guard.first-load-imported",
  "guard.facts-asserted",
  "guard.no-polling-guard",
  "guard.profile-reasoned",
  "guard.budget-sane",
] as const;

export type GuardRuleName = (typeof GUARD_RULE_NAMES)[number];

export interface Problem {
  readonly rule: GuardRuleName;
  readonly problem: string;
}

/**
 * مدخلاتُ التدقيقِ **محقونةٌ لا مقروءةٌ من القرصِ داخلَ المنطقِ**. والسببُ قاعدةُ
 * `ح-7`: سالبةٌ مبذورةٌ يجبُ أن تُشغِّلَ **هذا الحاجزَ عينَه** لا نسخةً منه في
 * ملفِّ اختبارٍ — ولو أُعيدَ بناءُ المنطقِ في الاختبارِ لبرهنَ الاختبارُ على
 * نفسِه لا على الحاجزِ. فالقراءةُ من القرصِ في `defaultInputs()` وحدَها.
 */
export interface AuditInputs {
  readonly testSource: string | null;
  readonly contract: string | null;
  readonly packageJson: string | null;
  readonly budgetBytes: number;
  readonly windowMs: number;
  readonly judgeRuleCount: number;
  readonly eagerGzipBytes: number;
  readonly profile: readonly {
    readonly label: string;
    readonly callsInWindow: number;
    readonly reason: string;
  }[];
}

/** المدخلاتُ الحقيقيّةُ: القرصُ ومكتباتُ الحدِّ — الموضعُ الوحيدُ الذي يقرأُ. */
export function defaultInputs(): AuditInputs {
  return {
    testSource: read(SESSION_DATA_TEST_FILE),
    contract: read(CONTRACT_FILE),
    packageJson: read(PACKAGE_FILE),
    budgetBytes: SESSION_DATA_BUDGET_BYTES,
    windowMs: SESSION_WINDOW_MS,
    judgeRuleCount: SESSION_RULE_NAMES.length,
    eagerGzipBytes: BUDGET.eagerGzipBytes,
    profile: RIDER_SESSION_PROFILE,
  };
}

/** قراءةُ ملفٍّ نصّاً، و`null` إن غابَ — الغيابُ حكمٌ لا استثناءٌ. */
function read(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

export function auditSessionDataBudget(overrides: Partial<AuditInputs> = {}): Problem[] {
  const inputs: AuditInputs = { ...defaultInputs(), ...overrides };
  const problems: Problem[] = [];
  const push = (rule: GuardRuleName, problem: string): void => {
    problems.push({ rule, problem });
  };

  // ١. الحدُّ نفسُه عقلانيٌّ — حاجزٌ بلا رقمٍ لا يحجزُ.
  if (!Number.isFinite(inputs.budgetBytes) || inputs.budgetBytes <= 0) {
    push("guard.budget-sane", `حدُّ الجلسةِ غيرُ صالحٍ: ${String(inputs.budgetBytes)}`);
  }
  if (!Number.isFinite(inputs.windowMs) || inputs.windowMs <= 0) {
    push("guard.budget-sane", `نافذةُ القياسِ غيرُ صالحةٍ: ${String(inputs.windowMs)}`);
  }
  if (inputs.judgeRuleCount === 0) {
    push("guard.budget-sane", "حكمٌ بلا قاعدةٍ واحدةٍ — لا شيءَ يُخالَفُ");
  }

  // ٢. شكلُ النافذةِ: كلُّ نداءٍ بعددٍ صحيحٍ موجبٍ **وسببٍ مكتوبٍ**.
  if (inputs.profile.length === 0) {
    push("guard.profile-reasoned", "شكلُ جلسةِ الراكبِ فارغٌ — نافذةٌ بلا نداءٍ ليست جلسةً");
  }
  for (const entry of inputs.profile) {
    if (!Number.isInteger(entry.callsInWindow) || entry.callsInWindow <= 0) {
      push(
        "guard.profile-reasoned",
        `النداءُ «${entry.label}» بعددٍ غيرِ صالحٍ: ${String(entry.callsInWindow)}`,
      );
    }
    if (entry.reason.trim().length === 0) {
      push(
        "guard.profile-reasoned",
        `النداءُ «${entry.label}» بلا سببٍ مكتوبٍ — عددٌ بلا سببٍ رقمٌ لا يُراجَعُ`,
      );
    }
  }

  // ٣. ملفُّ القياسِ موجودٌ — وغيابُه يُنهي الفحصَ: ما بعدَه يُقاسُ فيه.
  const testSource = inputs.testSource;
  if (testSource === null) {
    push("guard.test-present", `ملفُّ قياسِ الجلسةِ غائبٌ: ${SESSION_DATA_TEST_FILE}`);
    return problems;
  }

  // ٤. الحدُّ يُستورَدُ من مصدرِه الواحدِ ويُوكَّدُ عليه.
  if (!/from\s+["'`][^"'`]*session-data-budget/.test(testSource)) {
    push("guard.imported", "ملفُّ القياسِ لا يستوردُ الحدَّ من `scripts/lib/session-data-budget.ts`");
  }
  for (const symbol of ["SESSION_DATA_BUDGET_BYTES", "judgeSessionData"]) {
    if (!testSource.includes(symbol)) {
      push("guard.budget-asserted", `ملفُّ القياسِ لا يذكرُ \`${symbol}\``);
    }
  }

  // ٥. لا تكرارَ لقيمةِ الحدِّ في ملفِّ القياسِ — مصدرُ حقيقةٍ واحدٌ.
  const budgetLiterals = [
    String(inputs.budgetBytes),
    String(inputs.budgetBytes).replace(/\B(?=(\d{3})+(?!\d))/g, "_"),
  ];
  for (const literal of budgetLiterals) {
    if (testSource.includes(literal)) {
      push("guard.single-source", `قيمةُ الحدِّ (${literal}) مكتوبةٌ في ملفِّ القياسِ بدلَ استيرادِها`);
    }
  }

  // ٦. مهلةُ المُرحِّلِ مستوردةٌ لا مكتوبةً: مَن خفَّفَها يجبُ أن يرى الحدَّ يتحرَّكُ.
  if (!testSource.includes("DEFAULT_RELAY_MIN_INTERVAL_MS")) {
    push("guard.relay-imported", "ملفُّ القياسِ لا يقرأُ `DEFAULT_RELAY_MIN_INTERVAL_MS`");
  }
  if (!new RegExp(`from\\s+["'\`][^"'\`]*${RELAY_MODULE}`).test(testSource)) {
    push(
      "guard.relay-imported",
      `ملفُّ القياسِ لا يستوردُ المهلةَ من \`${RELAY_MODULE}\` — رقمٌ مكتوبٌ يجمِّدُ الحدَّ على ماضٍ`,
    );
  }

  // ٧. الحملُ الأوّلُ يُقرأُ من سقفِه المفروضِ لا من رقمٍ ثانٍ.
  if (!/from\s+["'`][^"'`]*performance-budget/.test(testSource)) {
    push(
      "guard.first-load-imported",
      "ملفُّ القياسِ لا يستوردُ سقفَ الحملِ الأوّلِ من `scripts/lib/performance-budget.ts`",
    );
  }
  for (const literal of [String(inputs.eagerGzipBytes), "180 * KB", "180 * 1024"]) {
    if (testSource.includes(literal)) {
      push(
        "guard.first-load-imported",
        `سقفُ الحملِ الأوّلِ (${literal}) مكتوبٌ في ملفِّ القياسِ بدلَ استيرادِه`,
      );
    }
  }

  // ٨. حقائقُ غيرُ فارغةٍ **قبلَ** الحدِّ: صفرٌ يمرُّ تحتَ كلِّ حدٍّ.
  if (!/toBeGreaterThan\(0\)/.test(testSource)) {
    push(
      "guard.facts-asserted",
      "ملفُّ القياسِ لا يوكِّدُ أنَّ الحقائقَ غيرُ فارغةٍ — أخضرٌ على صفرٍ غيابُ قياسٍ لا التزامٌ",
    );
  }
  if (!testSource.includes("violations")) {
    push("guard.facts-asserted", "ملفُّ القياسِ لا يوكِّدُ خلوَّ الحكمِ من المخالفاتِ");
  }

  // ٩. صفُّ العقدِ في الوثيقةِ يُطابِقُ الرقمَ المُنفَّذَ حرفاً.
  const contract = inputs.contract;
  if (contract === null) {
    push("guard.contract-row", `وثيقةُ العقدِ غائبةٌ: ${CONTRACT_FILE}`);
  } else {
    const row = contract.split("\n").find((line) => line.includes(CONTRACT_ROW_MARKER));
    if (row === undefined) {
      push("guard.contract-row", `صفُّ العقدِ «${CONTRACT_ROW_MARKER}» غائبٌ من ${CONTRACT_FILE}`);
    } else {
      const match = /≤\s*([0-9]+(?:\.[0-9]+)?)\s*MB/.exec(row);
      if (match?.[1] === undefined) {
        push("guard.contract-row", `صفُّ العقدِ بلا رقمٍ بالميغابايتِ يُقرأُ: ${row.trim()}`);
      } else {
        const declared = Number(match[1]) * 1024 * 1024;
        if (declared !== inputs.budgetBytes) {
          push(
            "guard.contract-row",
            `العقدُ يقولُ ${match[1]} MB والمُنفَّذُ ${String(inputs.budgetBytes)} بايتاً — موضعا حقيقةٍ`,
          );
        }
      }
    }
  }

  // ١٠. شكلُ النافذةِ يسندُ ظهرَه إلى منعِ الاستقصاءِ: فإن زالَ الحاجزُ زالَ السندُ.
  const pkg = inputs.packageJson;
  if (pkg === null || !pkg.includes("check-system-screens-policy")) {
    push(
      "guard.no-polling-guard",
      "حاجزُ منعِ الاستقصاءِ الدوريِّ (`check-system-screens-policy`) غائبٌ من سلسلةِ `ci` — وبزوالِه يصيرُ عددُ النداءاتِ المُعلَنُ بلا سندٍ",
    );
  }

  return problems;
}

function main(): void {
  const problems = auditSessionDataBudget();

  if (problems.length > 0) {
    console.error("✗ حدُّ بياناتِ جلسةِ الراكبِ (`F1-09`) مخروقٌ:\n");
    for (const problem of problems) {
      console.error(`  ــ [${problem.rule}] ${problem.problem}`);
    }
    console.error(
      "\nوالعلاجُ في الجِذرِ: يبقى القياسُ في `" +
        SESSION_DATA_TEST_FILE +
        "` مستورِداً حدَّه ومهلتَه وسقفَ حملِه من مصادرِها الواحدةِ، " +
        "ويبقى صفُّ العقدِ مطابِقاً للرقمِ المُنفَّذِ. وإسكاتُ الحاجزِ ليسَ علاجاً.",
    );
    process.exit(1);
  }

  console.log(
    `✓ حدُّ جلسةِ الراكبِ محروسٌ: ${String(SESSION_DATA_BUDGET_BYTES)} بايتاً في ` +
      `${String(SESSION_WINDOW_MS / 60_000)} دقائقَ · ${String(RIDER_SESSION_PROFILE.length)} نداءاتٍ معلَّلةً · ` +
      `${String(SESSION_RULE_NAMES.length)} قواعدَ حكمٍ · ${String(GUARD_RULE_NAMES.length)} قواعدَ حاجزٍ. ` +
      "وهذا **حِفظُ شرطٍ لا قياسُ جلسةٍ**: الجلسةُ تُقاسُ على بوّابةٍ وقاعدةٍ وقناةٍ حقيقيّةٍ.",
  );
}

if (import.meta.main) main();
