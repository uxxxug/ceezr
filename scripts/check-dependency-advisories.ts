#!/usr/bin/env bun
/**
 * الغرض: بوّابةُ CI لفحصِ ثغراتِ التبعيّاتِ — تُشغِّلُ `bun audit --json` وتحكمُ
 *   على مُخرَجِه بسِجلٍّ مغلقٍ، **وتسقطُ مغلقةً** متى تعذَّرَ القياسُ.
 * الحالة: منفَّذٌ فعليّاً — أُضيفَ في 2026-09-20 (الشقُّ المملوكُ للمستودَعِ من `SEC-15`).
 * ينتمي إلى: scripts
 * الحاكم: ADR 0150 · `ح-7`
 *
 * **ولِمَ لا يكتفي بـ`Dependabot`**: `Dependabot` (`D-09`) يفتحُ طلبَ دمجٍ ينتظرُ
 * مراجعةً — أي **يُخبِرُ** ولا **يمنعُ**. وطلبٌ مفتوحٌ أسبوعَينِ بلا مراجعٍ لا
 * يمنعُ دمجَ شيءٍ، فالبناءُ يبقى أخضرَ على تبعيّةٍ مُصابةٍ. وهذا الحاجزُ يُسقِطُ
 * البناءَ — وذاكَ فرقُ إخطارٍ عن إنفاذٍ.
 *
 * **وقسمةُ المدخلاتِ مقصودةٌ**: `staticInputs()` تقرأُ القرصَ وحدَه، و`measureAudit()`
 * تُشغِّلُ العمليّةَ. فتُبرهَنُ سوالبُ الحاجزِ على **الحاجزِ عينِه** بحقائقَ مبذورةٍ
 * بلا شبكةٍ في حزمةِ الوحدةِ، ويبقى الطرفُ الموجَبُ مقروءاً من القرصِ الحقيقيِّ.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ACKNOWLEDGEMENTS,
  type AuditFacts,
  describeAdvisoryViolation,
  FAILING_SEVERITY,
  type JudgeRuleName,
  judgeAdvisories,
  parseAuditOutput,
  summarizeAdvisories,
} from "./lib/dependency-advisory-registry.ts";

const repoRoot = resolve(import.meta.dir, "..");

/** مسارُ هذا الحاجزِ كما يجبُ أن يُقرأَ في سلسلةِ `ci`. */
export const GUARD_SCRIPT_PATH = "scripts/check-dependency-advisories.ts";

export const GUARD_RULE_NAMES = [
  "chain.guard-in-ci",
  "chain.dependabot-present",
  "chain.dependabot-covers-npm",
] as const;

export type GuardRuleName = (typeof GUARD_RULE_NAMES)[number];

export interface GuardViolation {
  readonly rule: GuardRuleName | JudgeRuleName;
  readonly detail: string;
}

/** ما يُقرأُ من القرصِ — بلا عمليّةٍ ولا شبكةٍ. */
export interface StaticInputs {
  /** سلسلةُ `ci` من `package.json` كما تُقرأُ نصّاً. */
  readonly ciChain: string;
  /** نصُّ `.github/dependabot.yml`، أو `null` إن لم يكن على القرصِ. */
  readonly dependabotText: string | null;
}

export interface GuardInputs extends StaticInputs {
  readonly facts: AuditFacts;
  /** اللحظةُ التي يُقاسُ بها انتهاءُ الإقراراتِ — مُمرَّرةٌ لا مقروءةٌ ضمناً. */
  readonly now: Date;
}

export const staticInputs = (): StaticInputs => {
  const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const dependabotPath = resolve(repoRoot, ".github/dependabot.yml");
  return {
    ciChain: packageJson.scripts?.ci ?? "",
    dependabotText: existsSync(dependabotPath) ? readFileSync(dependabotPath, "utf8") : null,
  };
};

/** يُشغِّلُ الفحصَ الحقيقيَّ. وتعذُّرُه **حقيقةٌ سلبيّةٌ** لا استثناءٌ يُبتلَعُ. */
export const measureAudit = (): AuditFacts => {
  const run = spawnSync("bun", ["audit", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 180_000,
  });
  if (run.error !== undefined) {
    return {
      measured: false,
      advisories: [],
      failure: `تعذَّرَ تشغيلُ bun audit: ${run.error.message}`,
    };
  }
  if (typeof run.status !== "number" || run.status > 1) {
    return {
      measured: false,
      advisories: [],
      failure: `bun audit خرجَ بالرمزِ ${String(run.status)}: ${(run.stderr ?? "").trim().slice(0, 400)}`,
    };
  }
  const raw = (run.stdout ?? "").trim();
  if (raw === "" || raw === "{}") {
    return { measured: true, advisories: [], failure: null };
  }
  try {
    return { measured: true, advisories: parseAuditOutput(raw), failure: null };
  } catch (error) {
    return {
      measured: false,
      advisories: [],
      failure: `مُخرَجُ bun audit غيرُ مقروءٍ: ${(error as Error).message}`,
    };
  }
};

export const auditDependencyAdvisories = (inputs: GuardInputs): readonly GuardViolation[] => {
  const violations: GuardViolation[] = [];

  if (!inputs.ciChain.includes(GUARD_SCRIPT_PATH)) {
    violations.push({
      rule: "chain.guard-in-ci",
      detail: `${GUARD_SCRIPT_PATH} ليسَ في سلسلةِ ci — وحاجزٌ لا يجري ليسَ حاجزاً.`,
    });
  }

  if (inputs.dependabotText === null) {
    violations.push({
      rule: "chain.dependabot-present",
      detail:
        ".github/dependabot.yml غيرُ موجودٍ — وهذا الحاجزُ يكشفُ المُصابَ ولا يرفعُ نسخةً، " +
        "فحذفُ مُحدِّثِ النُسَخِ يُبقي الكشفَ بلا علاجٍ.",
    });
  } else if (!/package-ecosystem:\s*npm/.test(inputs.dependabotText)) {
    violations.push({
      rule: "chain.dependabot-covers-npm",
      detail: "dependabot.yml لا يُغطّي مُعجَمَ npm — وهوَ عينُ ما يقيسُه هذا الحاجزُ.",
    });
  }

  for (const violation of judgeAdvisories({
    facts: inputs.facts,
    acknowledgements: ACKNOWLEDGEMENTS,
    threshold: FAILING_SEVERITY,
    now: inputs.now,
  })) {
    violations.push(violation);
  }

  return violations;
};

if (import.meta.main) {
  const facts = measureAudit();
  const violations = auditDependencyAdvisories({ ...staticInputs(), facts, now: new Date() });
  if (violations.length > 0) {
    console.error(`✗ فحصُ ثغراتِ التبعيّاتِ (SEC-15): ${violations.length} خرقاً.`);
    for (const violation of violations) {
      console.error(describeAdvisoryViolation(violation));
    }
    process.exit(1);
  }
  console.log(
    `✓ فحصُ ثغراتِ التبعيّاتِ (SEC-15): ${summarizeAdvisories(facts, FAILING_SEVERITY)}` +
      ` · ${ACKNOWLEDGEMENTS.length} إقراراً في السِجلِّ.`,
  );
  console.log("  ولا يُدَّعى أمنُ التبعيّاتِ: المقيسُ «لا نشرةَ معروفةً فوقَ الحدِّ اليومَ» لا «لا ثغرةَ».");
}
