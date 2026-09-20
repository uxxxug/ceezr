#!/usr/bin/env bun
/**
 * # الحاجزُ الساكنُ: عددُ نداءاتِ التوجيهِ معدودٌ لا مُقدَّرٌ — `ECO-002`
 *
 * **الغرض:** أن يستحيلَ أن يُحذَفَ قياسُ نداءاتِ مزوّدِ التوجيهِ أو يُفرَّغَ
 * تأكيدُه أو تُنسَخَ عتباتُه أو يُرفَعَ سقفُه بيدٍ — **قبلَ** أن يُشغَّلَ
 * القياسُ. والقسمُ 17 يوجبُ أن يكونَ لكلِّ رحلةٍ عددٌ معلومٌ من نداءاتِ مزوّدٍ
 * مدفوعِ الثمنِ؛ وهذا الحاجزُ يحرسُ **بقاءَ العدِّ** لا نتيجتَه: النتيجةُ تُقاسُ
 * على بوّابةٍ وقاعدةٍ وخادمِ توجيهٍ حقيقيَّةٍ.
 *
 * **الحالة:** `ECO-002` — مُنفَّذ · مُختبَر · مبرهَنُ السقوطِ (`ح-7`).
 *
 * **ينتمي إلى:** البند `ECO-002` · القسمُ 17 (اقتصادُ التشغيلِ).
 *
 * **يُستخدَمُ من:** سلسلةُ `bun run ci` · خطوةٌ مُسمّاةٌ في `.github/workflows/ci.yml`.
 *
 * **يحرسُه:** `tests/unit/check-routing-call-budget.test.ts` — سالبةٌ لكلِّ قاعدةٍ.
 *
 * **الحاكم:** `docs/adr/0151-routing-calls-per-ride-are-counted-not-estimated.md`
 *
 * **ما لا يفعلُه هذا الحاجزُ عن قصدٍ:**
 * - **لا يُثبِتُ أنَّ الرحلةَ ضمنَ السقفِ**: ذاكَ قياسٌ على السِلكِ في
 *   `tests/integration/routing-call-budget.test.ts`، ووجودُ هذا الحاجزِ **ليسَ**
 *   دليلَ التزامٍ.
 * - **لا يعرفُ سعراً ولا يحسبُ فاتورةً**: السعرُ في فاتورةِ مزوّدٍ لا يملكُها
 *   المستودَعُ (`REQ-09` · `[!]`). فالمحروسُ **العددُ** وحدَه.
 * - **لا يقرأُ شبكةً ولا قاعدةً**: ساكنٌ عن قصدٍ.
 */

import { existsSync, readFileSync } from "node:fs";
import { DEFAULT_ROUTE_CACHE_THRESHOLDS } from "../packages/application/tracking/route-cache.ts";
import {
  JUDGE_RULE_NAMES,
  maxAllowedBudget,
  RIDE_ROUTING_PROFILE,
  ROUTE_CACHE_GUARD_FILE,
  ROUTING_CALLS_TEST_FILE,
  routingCallBudget,
} from "./lib/routing-call-budget.ts";

/** سلسلةُ `ci` — منها يُقرأُ بقاءُ الحاجزِ نفسِه وحاجزِ سياسةِ التخزينِ. */
const PACKAGE_FILE = "package.json";
/** ملفُّ حكمٍ ساكنٍ سابقٍ يسندُ هذا القياسَ (`CAP-012`). */
const CACHE_MODULE = "route-cache";

/** أسماءُ قواعدِ الحاجزِ — مُصدَّرةٌ كي تُبذَرَ سالبةٌ لكلِّ واحدةٍ (`ح-7`). */
export const GUARD_RULE_NAMES = [
  "guard.measurement-present",
  "guard.judge-imported",
  "guard.wire-counted",
  "guard.container-wired",
  "guard.phases-measured",
  "guard.assertion-intact",
  "guard.thresholds-imported",
  "guard.cache-policy-guard",
  "guard.self-enforced",
  "guard.budget-sane",
] as const;

export type GuardRuleName = (typeof GUARD_RULE_NAMES)[number];

export interface Problem {
  readonly rule: GuardRuleName;
  readonly problem: string;
}

/**
 * مدخلاتُ التدقيقِ **محقونةٌ لا مقروءةٌ داخلَ المنطقِ**: سالبةٌ مبذورةٌ يجبُ أن
 * تُشغِّلَ هذا الحاجزَ عينَه لا نسخةً منه في ملفِّ اختبارٍ (`ح-7`).
 */
export interface AuditInputs {
  readonly measurementSource: string | null;
  readonly packageJson: string | null;
  readonly budget: number;
  readonly ceiling: number;
  readonly judgeRuleCount: number;
  readonly profile: typeof RIDE_ROUTING_PROFILE;
  readonly thresholds: { readonly minChangeMeters: number; readonly ttlSeconds: number };
}

/** قراءةُ ملفٍّ نصّاً، و`null` إن غابَ — الغيابُ حكمٌ لا استثناءٌ. */
function read(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

/** المدخلاتُ الحقيقيّةُ: القرصُ ومكتبةُ الحَكَمِ — الموضعُ الوحيدُ الذي يقرأُ. */
export function defaultInputs(): AuditInputs {
  return {
    measurementSource: read(ROUTING_CALLS_TEST_FILE),
    packageJson: read(PACKAGE_FILE),
    budget: routingCallBudget(),
    ceiling: maxAllowedBudget(),
    judgeRuleCount: JUDGE_RULE_NAMES.length,
    profile: RIDE_ROUTING_PROFILE,
    thresholds: DEFAULT_ROUTE_CACHE_THRESHOLDS,
  };
}

export function auditRoutingCallBudget(overrides: Partial<AuditInputs> = {}): Problem[] {
  const inputs: AuditInputs = { ...defaultInputs(), ...overrides };
  const problems: Problem[] = [];
  const push = (rule: GuardRuleName, problem: string): void => {
    problems.push({ rule, problem });
  };

  // ١. السقفُ والشكلُ عقلانيّانِ — حاجزٌ بلا رقمٍ صالحٍ لا يحجزُ.
  if (!Number.isInteger(inputs.budget) || inputs.budget <= 0) {
    push("guard.budget-sane", `سقفُ النداءاتِ غيرُ صالحٍ: ${String(inputs.budget)}`);
  }
  if (inputs.budget > inputs.ceiling) {
    push(
      "guard.budget-sane",
      `السقفُ ${String(inputs.budget)} فوقَ أقصى المسموحِ ${String(inputs.ceiling)}`,
    );
  }
  if (inputs.judgeRuleCount === 0) {
    push("guard.budget-sane", "حكمٌ بلا قاعدةٍ واحدةٍ — لا شيءَ يُخالَفُ");
  }
  for (const [name, value] of [
    ["windowMs", inputs.profile.windowMs],
    ["heartbeatCount", inputs.profile.heartbeatCount],
    ["activeReadCount", inputs.profile.activeReadCount],
    ["repeatedReadCount", inputs.profile.repeatedReadCount],
    ["quoteCallCount", inputs.profile.quoteCallCount],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) {
      push("guard.budget-sane", `شكلُ النافذةِ «${name}» بعددٍ غيرِ صالحٍ: ${String(value)}`);
    }
  }
  if (!Number.isFinite(inputs.thresholds.ttlSeconds) || inputs.thresholds.ttlSeconds <= 0) {
    push(
      "guard.budget-sane",
      `مدّةُ صلاحيّةِ المخزونِ غيرُ صالحةٍ: ${String(inputs.thresholds.ttlSeconds)} — وبها تسقطُ قاعدةُ «المكرَّرُ لا يُنادي»`,
    );
  }

  // ٢. ملفُّ القياسِ موجودٌ — وغيابُه يُنهي الفحصَ: ما بعدَه يُقاسُ فيه.
  const source = inputs.measurementSource;
  if (source === null) {
    push("guard.measurement-present", `ملفُّ قياسِ النداءاتِ غائبٌ: ${ROUTING_CALLS_TEST_FILE}`);
    return problems;
  }

  // ٣. الحَكَمُ يُستورَدُ ولا يُعادُ بناؤُه في ملفِّ القياسِ.
  if (!/from\s+["'`][^"'`]*routing-call-budget/.test(source)) {
    push(
      "guard.judge-imported",
      "ملفُّ القياسِ لا يستوردُ الحَكَمَ من `scripts/lib/routing-call-budget.ts`",
    );
  }
  for (const symbol of ["judgeRoutingCalls", "routingCallBudget", "RIDE_ROUTING_PROFILE"]) {
    if (!source.includes(symbol)) {
      push("guard.judge-imported", `ملفُّ القياسِ لا يذكرُ \`${symbol}\``);
    }
  }

  // ٤. العدُّ على **السِلكِ**: خادمٌ يُصغي على منفذٍ حقيقيٍّ يعدُّ الطلباتَ.
  if (!/Bun\.serve\(/.test(source)) {
    push(
      "guard.wire-counted",
      "لا خادمَ توجيهٍ يُصغي في ملفِّ القياسِ — جاسوسٌ على دالّةٍ يُخفي طلباً يُرسِلُه المزوّدُ من وراءِ الواجهةِ",
    );
  }
  if (!/port:\s*0/.test(source)) {
    push("guard.wire-counted", "خادمُ القياسِ بلا `port: 0` — منفذٌ ثابتٌ يتعارضُ في CI");
  }
  if (!/calls\s*\+=\s*1/.test(source)) {
    push("guard.wire-counted", "لا عدَّ للطلباتِ داخلَ خادمِ التوجيهِ — القياسُ بلا عدّادٍ دعوى");
  }

  // ٥. التركيبُ من الحاويةِ الإنتاجيّةِ: مزوّدٌ يُبنى باليدِ يُثبِتُ المزوّدَ لا الوصلَ.
  for (const symbol of ["buildContainer", 'routingProvider: "osrm"', "osrmBaseUrl"]) {
    if (!source.includes(symbol)) {
      push(
        "guard.container-wired",
        `ملفُّ القياسِ لا يذكرُ \`${symbol}\` — القياسُ يجبُ أن يمرَّ من الحاويةِ الإنتاجيّةِ`,
      );
    }
  }

  // ٦. المراحلُ الثلاثُ مقيسةٌ كلُّها: حذفُ مرحلةٍ يجعلُ الأخضرَ صامتاً.
  for (const [marker, why] of [
    ["/v1/driver/location", "مرحلةُ النبضاتِ — وبها تُثبَتُ قاعدةُ «لا مسارَ لكلِّ نبضةٍ»"],
    ["/v1/quote/ride", "نداءُ الاقتباسِ — وهوَ حدُّ السقفِ الأوّلُ"],
    ["callsDuringHeartbeats", "نصيبُ النبضاتِ من النداءاتِ"],
    ["callsDuringRepeatedReads", "نصيبُ القراءاتِ المكرَّرةِ — وهوَ أثرُ التخزينِ"],
  ] as const) {
    if (!source.includes(marker)) {
      push("guard.phases-measured", `ملفُّ القياسِ لا يقيسُ «${marker}»: ${why}`);
    }
  }

  // ٧. التأكيدُ لم يُفرَّغْ: قياسٌ لا يُحاكَمُ سجلٌّ لا حاجزٌ.
  if (!/expect\(\s*violations\s*\)\.toEqual\(\[\]\)/.test(source)) {
    push(
      "guard.assertion-intact",
      "ملفُّ القياسِ لا يوكِّدُ خلوَّ الحكمِ من المخالفاتِ (`expect(violations).toEqual([])`)",
    );
  }
  if (!source.includes("measured: true")) {
    push(
      "guard.assertion-intact",
      "حقائقُ القياسِ لا تُعلِنُ `measured: true` — وقياسٌ لم يُعلِنْ أنَّه جرى يُقرأُ صفراً",
    );
  }

  // ٨. العتباتُ مستوردةٌ لا منسوخةً: مَن غيَّرَها يجبُ أن يرى القياسَ يتحرَّكُ.
  if (!source.includes("DEFAULT_ROUTE_CACHE_THRESHOLDS")) {
    push("guard.thresholds-imported", "ملفُّ القياسِ لا يقرأُ `DEFAULT_ROUTE_CACHE_THRESHOLDS`");
  }
  if (!new RegExp(`from\\s+["'\`][^"'\`]*${CACHE_MODULE}`).test(source)) {
    push(
      "guard.thresholds-imported",
      `ملفُّ القياسِ لا يستوردُ العتباتَ من \`${CACHE_MODULE}\` — رقمٌ مكتوبٌ يجمِّدُ القياسَ على ماضٍ`,
    );
  }
  for (const literal of [
    `minChangeMeters: ${String(inputs.thresholds.minChangeMeters)}`,
    `ttlSeconds: ${String(inputs.thresholds.ttlSeconds)}`,
  ]) {
    if (source.includes(literal)) {
      push("guard.thresholds-imported", `العتبةُ «${literal}» مكتوبةٌ في ملفِّ القياسِ بدلَ استيرادِها`);
    }
  }

  // ٩. سندُ القاعدةِ باقٍ: حاجزُ سياسةِ التخزينِ (`CAP-012`) في السلسلةِ وعلى القرصِ.
  const pkg = inputs.packageJson;
  if (!existsSync(ROUTE_CACHE_GUARD_FILE)) {
    push("guard.cache-policy-guard", `حاجزُ سياسةِ التخزينِ غائبٌ عن القرصِ: ${ROUTE_CACHE_GUARD_FILE}`);
  }
  if (pkg === null || !pkg.includes("check-route-cache-policy")) {
    push(
      "guard.cache-policy-guard",
      "حاجزُ سياسةِ تخزينِ المساراتِ (`check-route-cache-policy`) غائبٌ من سلسلةِ `ci` — وبزوالِه تصيرُ قاعدةُ «المكرَّرُ لا يُنادي» بلا سندٍ بنيويٍّ",
    );
  }

  // ١٠. الحاجزُ يحرسُ نفسَه: حاجزٌ غيرُ موصولٍ في السلسلةِ وثيقةٌ لا بوّابةٌ.
  if (pkg === null || !pkg.includes("check-routing-call-budget")) {
    push(
      "guard.self-enforced",
      "هذا الحاجزُ غيرُ موصولٍ في سلسلةِ `ci` من `package.json` — وحاجزٌ لا يُشغَّلُ وثيقةٌ",
    );
  }

  return problems;
}

function main(): void {
  const problems = auditRoutingCallBudget();

  if (problems.length > 0) {
    console.error("✗ عدُّ نداءاتِ التوجيهِ (`ECO-002`) مخروقٌ:\n");
    for (const problem of problems) {
      console.error(`  ــ [${problem.rule}] ${problem.problem}`);
    }
    console.error(
      "\nوالعلاجُ في الجِذرِ: يبقى القياسُ في `" +
        ROUTING_CALLS_TEST_FILE +
        "` يعدُّ طلباتِ `HTTP` على منفذٍ حقيقيٍّ من حاويةٍ إنتاجيّةٍ، " +
        "ويستوردُ حَكَمَه وعتباتِه من مصادرِها الواحدةِ. وإسكاتُ الحاجزِ ليسَ علاجاً.",
    );
    process.exit(1);
  }

  console.log(
    `✓ عدُّ نداءاتِ التوجيهِ محروسٌ (ECO-002): سقفٌ مُشتَقٌّ ${String(routingCallBudget())} نداءً لكلِّ رحلةٍ · ` +
      `${String(RIDE_ROUTING_PROFILE.heartbeatCount)} نبضةً نصيبُها صفرٌ · ` +
      `${String(JUDGE_RULE_NAMES.length)} قواعدَ حكمٍ · ${String(GUARD_RULE_NAMES.length)} قواعدَ حاجزٍ. ` +
      "وهذا **حِفظُ شرطٍ لا قياسُ فاتورةٍ**: العددُ يُقاسُ على السِلكِ، والسعرُ في فاتورةِ مزوّدٍ (REQ-09).",
  );
}

if (import.meta.main) main();
