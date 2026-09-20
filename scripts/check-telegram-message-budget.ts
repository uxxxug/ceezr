#!/usr/bin/env bun
/**
 * # الحاجزُ الساكنُ: رسائلُ تيليجرام لكلِّ رحلةٍ معدودةٌ لا مُقدَّرةٌ — `ECO-003`
 *
 * **الغرض:** أن يستحيلَ أن يُحذَفَ قياسُ رسائلِ الرحلةِ أو يُفرَّغَ تأكيدُه أو
 * تُنسَخَ قائمةُ الأنواعِ الحرجةِ أو يُرفَعَ سقفُه بيدٍ أو **يُطمَسَ الفرقُ بينَ
 * رسالةِ الدفعِ وردِّ الحوارِ** — **قبلَ** أن يُشغَّلَ القياسُ. والقسمُ 17 يوجبُ
 * أن يكونَ لكلِّ رحلةٍ عددٌ معلومٌ من الرسائلِ الحرجةِ؛ وهذا الحاجزُ يحرسُ
 * **بقاءَ العدِّ وبقاءَ القسمةِ** لا نتيجتَهما: النتيجةُ تُقاسُ على بوّابةٍ
 * وقاعدةٍ حقيقيَّتَينِ في `tests/integration/telegram-message-budget.test.ts`.
 *
 * **ولِمَ تُحرَسُ القسمةُ بقوّةِ ما يُحرَسُ العدُّ:** رقمٌ إجماليٌّ لا يُقرأُ منه
 * خطرٌ. رسالةُ الدفعِ تتوسَّعُ بعددِ السائقينَ فتصطدمُ بحدِّ `TG-001`، وردُّ
 * الحوارِ مشدودٌ إلى تحديثٍ واحدٍ فلا يتوسَّعُ أبداً. فمن جمعَهُما في عددٍ
 * واحدٍ خبَّأَ النصفَ النامي خلفَ النصفِ الثابتِ — وذاكَ أسوأُ من لا قياسٍ،
 * لأنَّه قياسٌ يُطمئنُ.
 *
 * **الحالة:** `ECO-003` — مُنفَّذ · مُختبَر · مبرهَنُ السقوطِ (`ح-7`).
 *
 * **ينتمي إلى:** البند `ECO-003` · القسمُ 17 (اقتصادُ التشغيلِ).
 *
 * **يُستخدَمُ من:** سلسلةُ `bun run ci` · خطوةٌ مُسمّاةٌ في `.github/workflows/ci.yml`.
 *
 * **يحرسُه:** `tests/unit/check-telegram-message-budget.test.ts` — سالبةٌ لكلِّ قاعدةٍ.
 *
 * **الحاكم:** `docs/adr/0152-telegram-messages-per-ride-are-counted-not-estimated.md`
 *
 * **ما لا يفعلُه هذا الحاجزُ عن قصدٍ:**
 * - **لا يُثبِتُ أنَّ الرحلةَ ضمنَ السقفِ**: ذاكَ قياسٌ على السِلكِ، ووجودُ هذا
 *   الحاجزِ **ليسَ** دليلَ التزامٍ.
 * - **لا يعرفُ سعراً ولا نجمةً ولا يحسبُ فاتورةً**: تمكينُ البثِّ المدفوعِ
 *   وسعرُه قرارُ مالكٍ محجوزٌ بـ`DEC-04` (`[!]`). فالمحروسُ **العددُ** وحدَه.
 * - **لا يحكمُ على صوابِ تصنيفِ نوعٍ حرجاً**: ذاكَ حكمُ منتَجٍ، وحاجزُ
 *   `check-notification-classification` يفرضُ اتّساقَه لا صوابَه.
 * - **لا يقرأُ شبكةً ولا قاعدةً**: ساكنٌ عن قصدٍ.
 */

import { existsSync, readFileSync } from "node:fs";
import {
  NOTIFICATION_KINDS,
  SEEDED_NOTIFICATION_CHANNELS,
} from "../packages/shared/config/notification-kinds.ts";
import {
  JUDGE_RULE_NAMES,
  maxAllowedReplyBurst,
  NOTIFICATION_CLASSIFICATION_GUARD_FILE,
  NOTIFICATION_KINDS_FILE,
  PUSH_CAUSES,
  pushMessageBudget,
  RIDE_MESSAGE_PROFILE,
  TELEGRAM_FREE_RATE_PER_SECOND,
  TELEGRAM_MESSAGES_TEST_FILE,
} from "./lib/telegram-message-budget.ts";

/** سلسلةُ `ci` — منها يُقرأُ بقاءُ الحاجزِ نفسِه وحاجزِ تصنيفِ الإشعاراتِ. */
const PACKAGE_FILE = "package.json";
/** وحدةُ مصدرِ الحقيقةِ للتصنيفِ كما تُستوردُ في ملفِّ القياسِ. */
const KINDS_MODULE = "notification-kinds";

/** أسماءُ قواعدِ الحاجزِ — مُصدَّرةٌ كي تُبذَرَ سالبةٌ لكلِّ واحدةٍ (`ح-7`). */
export const GUARD_RULE_NAMES = [
  "guard.measurement-present",
  "guard.judge-imported",
  "guard.wire-counted",
  "guard.container-wired",
  "guard.attribution-intact",
  "guard.lifecycle-driven",
  "guard.assertion-intact",
  "guard.kinds-imported",
  "guard.classification-guard",
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
  readonly replyBurstCeiling: number;
  readonly judgeRuleCount: number;
  readonly pushCauseCount: number;
  readonly criticalKindCount: number;
  readonly freeRatePerSecond: number;
  readonly profile: typeof RIDE_MESSAGE_PROFILE;
}

/** قراءةُ ملفٍّ نصّاً، و`null` إن غابَ — الغيابُ حكمٌ لا استثناءٌ. */
function read(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

/** المدخلاتُ الحقيقيّةُ: القرصُ ومكتبةُ الحَكَمِ — الموضعُ الوحيدُ الذي يقرأُ. */
export function defaultInputs(): AuditInputs {
  return {
    measurementSource: read(TELEGRAM_MESSAGES_TEST_FILE),
    packageJson: read(PACKAGE_FILE),
    budget: pushMessageBudget(),
    replyBurstCeiling: maxAllowedReplyBurst(),
    judgeRuleCount: JUDGE_RULE_NAMES.length,
    pushCauseCount: PUSH_CAUSES.length,
    criticalKindCount: NOTIFICATION_KINDS.filter(
      (kind) => SEEDED_NOTIFICATION_CHANNELS[kind] === "critical",
    ).length,
    freeRatePerSecond: TELEGRAM_FREE_RATE_PER_SECOND,
    profile: RIDE_MESSAGE_PROFILE,
  };
}

export function auditTelegramMessageBudget(overrides: Partial<AuditInputs> = {}): Problem[] {
  const inputs: AuditInputs = { ...defaultInputs(), ...overrides };
  const problems: Problem[] = [];
  const push = (rule: GuardRuleName, problem: string): void => {
    problems.push({ rule, problem });
  };

  // ١. السقفُ والشكلُ عقلانيّانِ — حاجزٌ بلا رقمٍ صالحٍ لا يحجزُ.
  if (!Number.isInteger(inputs.budget) || inputs.budget <= 0) {
    push("guard.budget-sane", `سقفُ رسائلِ الدفعِ غيرُ صالحٍ: ${String(inputs.budget)}`);
  }
  if (inputs.profile.maxReplyBurst > inputs.replyBurstCeiling) {
    push(
      "guard.budget-sane",
      `حدُّ دفقةِ الردِّ ${String(inputs.profile.maxReplyBurst)} فوقَ أقصى المسموحِ ${String(inputs.replyBurstCeiling)}`,
    );
  }
  if (inputs.judgeRuleCount === 0) {
    push("guard.budget-sane", "حكمٌ بلا قاعدةٍ واحدةٍ — لا شيءَ يُخالَفُ");
  }
  if (inputs.pushCauseCount === 0) {
    push(
      "guard.budget-sane",
      "قائمةُ أسبابِ الدفعِ فارغةٌ — وبفراغِها يصيرُ كلُّ خروجٍ ردَّ حوارٍ فيسقطُ القياسُ كلُّه",
    );
  }
  if (inputs.criticalKindCount === 0) {
    push(
      "guard.budget-sane",
      `لا نوعَ واحدٌ مُعلَنٌ \`critical\` في ${NOTIFICATION_KINDS_FILE} — فلا رسالةَ حرجةً تُعَدُّ`,
    );
  }
  if (!Number.isInteger(inputs.freeRatePerSecond) || inputs.freeRatePerSecond <= 0) {
    push(
      "guard.budget-sane",
      `حدُّ تيليجرام المُعلَنُ غيرُ صالحٍ: ${String(inputs.freeRatePerSecond)} — وبه تسقطُ قاعدةُ الفُرجةِ`,
    );
  }
  for (const [name, value] of [
    ["offeredDriverCount", inputs.profile.offeredDriverCount],
    ["broadcastRoundCount", inputs.profile.broadcastRoundCount],
    ["crossPartyTransitionCount", inputs.profile.crossPartyTransitionCount],
    ["pushedRatingPromptCount", inputs.profile.pushedRatingPromptCount],
    ["maxReplyBurst", inputs.profile.maxReplyBurst],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) {
      push("guard.budget-sane", `شكلُ الرحلةِ «${name}» بعددٍ غيرِ صالحٍ: ${String(value)}`);
    }
  }

  // ٢. ملفُّ القياسِ موجودٌ — وغيابُه يُنهي الفحصَ: ما بعدَه يُقاسُ فيه.
  const source = inputs.measurementSource;
  if (source === null) {
    push("guard.measurement-present", `ملفُّ قياسِ الرسائلِ غائبٌ: ${TELEGRAM_MESSAGES_TEST_FILE}`);
    return problems;
  }

  // ٣. الحَكَمُ يُستورَدُ ولا يُعادُ بناؤُه في ملفِّ القياسِ.
  if (!/from\s+["'`][^"'`]*telegram-message-budget/.test(source)) {
    push(
      "guard.judge-imported",
      "ملفُّ القياسِ لا يستوردُ الحَكَمَ من `scripts/lib/telegram-message-budget.ts`",
    );
  }
  for (const symbol of ["judgeTelegramMessages", "pushMessageBudget", "RIDE_MESSAGE_PROFILE"]) {
    if (!source.includes(symbol)) {
      push("guard.judge-imported", `ملفُّ القياسِ لا يذكرُ \`${symbol}\``);
    }
  }

  // ٤. العدُّ على **السِلكِ**: مُرسِلٌ يُلتقَطُ خروجُه فعلاً لا جاسوسٌ على عدّادٍ.
  for (const [marker, why] of [
    ["sendMessage", "نصُّ الرسالةِ — وهوَ أكثرُ ما يخرجُ"],
    ["sendPhoto", "الصورةُ تُحسَبُ رسالةً عندَ تيليجرام كما يُحسَبُ النصُّ"],
    ["sendLocation", "دبّوسُ الموقعِ رسالةٌ ثالثةٌ — وإهمالُه يُنقِصُ العدَّ ثُلثَ دفقةٍ"],
  ] as const) {
    if (!source.includes(marker)) {
      push("guard.wire-counted", `مُرسِلُ القياسِ لا يعدُّ «${marker}»: ${why}`);
    }
  }
  if (!/webhook\/telegram\//.test(source)) {
    push(
      "guard.wire-counted",
      "القياسُ لا يمرُّ من الـwebhook الحقيقيِّ — نداءُ دالّةٍ مباشرةً يُخفي ما يُرسِلُه المُوزِّعُ من وراءِ الواجهةِ",
    );
  }

  // ٥. التركيبُ من الحاويةِ الإنتاجيّةِ: مُوزِّعٌ يُبنى باليدِ يُثبِتُ نسخةً لا وصلاً.
  for (const symbol of ["buildContainer", "createServer", "drainNotificationOutbox"]) {
    if (!source.includes(symbol)) {
      push(
        "guard.container-wired",
        `ملفُّ القياسِ لا يذكرُ \`${symbol}\` — القياسُ يجبُ أن يمرَّ من الحاويةِ الإنتاجيّةِ ومن عاملِ التسليمِ`,
      );
    }
  }
  if (!/TEST_DATABASE_URL/.test(source)) {
    push(
      "guard.container-wired",
      "ملفُّ القياسِ لا يطلبُ `TEST_DATABASE_URL` — قياسٌ بلا قاعدةٍ حقيقيّةٍ لا يُنشئُ عرضاً فلا يعدُّ بثّاً",
    );
  }

  // ٦. **الإسنادُ باقٍ**: بزوالِه يبقى رقمٌ إجماليٌّ يُطمئنُ ولا يُقرأُ منه خطرٌ.
  for (const [marker, why] of [
    ["duringUpdateFrom", "مَن أرسلَ التحديثَ — وبه يُفرَّقُ الدفعُ من الردِّ"],
    ["updateIndex", "تسلسلُ التحديثِ — وبه تُقاسُ الدفقةُ"],
    ["cause", "سببُ الرسالةِ المُعلَنُ"],
  ] as const) {
    if (!source.includes(marker)) {
      push("guard.attribution-intact", `ملفُّ القياسِ لا يُسنِدُ «${marker}»: ${why}`);
    }
  }
  for (const cause of PUSH_CAUSES) {
    if (!source.includes(cause)) {
      push(
        "guard.attribution-intact",
        `سببُ الدفعِ «${cause}» غيرُ مقيسٍ في ملفِّ القياسِ — سببٌ مُعلَنٌ لا يُقاسُ اسمٌ ميّتٌ`,
      );
    }
  }

  // ٧. دورةُ الحياةِ مُدارةٌ كاملةً: رحلةٌ مقطوعةٌ تُنقِصُ الدفعَ فتُخضِرُ السقفَ كذباً.
  for (const [marker, why] of [
    ["offer:accept:", "القبولُ — ومنه دفعُ «قُبِلَ طلبُك» إلى الراكبِ"],
    ["ride:start:", "البدءُ — ومنه دفعُ «انطلقَ سائقُك»"],
    ["ride:complete:", "الإكمالُ — ومنه دفعُ الملخَّصِ وطلبِ التقييمِ"],
    ["rate:", "التقييمُ — وهوَ آخرُ ما يخرجُ في الرحلةِ"],
    ['"completed"', "توكيدُ أنَّ الرحلةَ اكتملَت فعلاً لا أنَّها قُطِعَت"],
  ] as const) {
    if (!source.includes(marker)) {
      push("guard.lifecycle-driven", `ملفُّ القياسِ لا يُدير «${marker}»: ${why}`);
    }
  }

  // ٨. التأكيدُ لم يُفرَّغْ: قياسٌ لا يُحاكَمُ سجلٌّ لا حاجزٌ.
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

  // ٩. قائمةُ الأنواعِ مستوردةٌ لا منسوخةً: مَن غيَّرَها يجبُ أن يرى القياسَ يتحرَّكُ.
  if (!source.includes("SEEDED_NOTIFICATION_CHANNELS")) {
    push("guard.kinds-imported", "ملفُّ القياسِ لا يقرأُ `SEEDED_NOTIFICATION_CHANNELS`");
  }
  if (!new RegExp(`from\\s+["'\`][^"'\`]*${KINDS_MODULE}`).test(source)) {
    push(
      "guard.kinds-imported",
      `ملفُّ القياسِ لا يستوردُ الأنواعَ من \`${KINDS_MODULE}\` — رقمٌ مكتوبٌ يجمِّدُ القياسَ على ماضٍ`,
    );
  }
  if (source.includes(`criticalKindCount: ${String(inputs.criticalKindCount)}`)) {
    push(
      "guard.kinds-imported",
      `عددُ الأنواعِ الحرجةِ (${String(inputs.criticalKindCount)}) مكتوبٌ في ملفِّ القياسِ بدلَ اشتقاقِه`,
    );
  }

  // ١٠. سندُ القاعدةِ باقٍ: حاجزُ تصنيفِ الإشعاراتِ في السلسلةِ وعلى القرصِ.
  const pkg = inputs.packageJson;
  if (!existsSync(NOTIFICATION_CLASSIFICATION_GUARD_FILE)) {
    push(
      "guard.classification-guard",
      `حاجزُ تصنيفِ الإشعاراتِ غائبٌ عن القرصِ: ${NOTIFICATION_CLASSIFICATION_GUARD_FILE}`,
    );
  }
  if (pkg === null || !pkg.includes("check-notification-classification")) {
    push(
      "guard.classification-guard",
      "حاجزُ تصنيفِ الإشعاراتِ (`check-notification-classification`) غائبٌ من سلسلةِ `ci` — وبزوالِه يصيرُ «النوعُ الحرجُ» دعوىً بلا قائمةٍ مغلقةٍ محروسةٍ",
    );
  }

  // ١١. الحاجزُ يحرسُ نفسَه: حاجزٌ غيرُ موصولٍ في السلسلةِ وثيقةٌ لا بوّابةٌ.
  if (pkg === null || !pkg.includes("check-telegram-message-budget")) {
    push(
      "guard.self-enforced",
      "هذا الحاجزُ غيرُ موصولٍ في سلسلةِ `ci` من `package.json` — وحاجزٌ لا يُشغَّلُ وثيقةٌ",
    );
  }

  return problems;
}

function main(): void {
  const problems = auditTelegramMessageBudget();

  if (problems.length > 0) {
    console.error("✗ عدُّ رسائلِ تيليجرام لكلِّ رحلةٍ (`ECO-003`) مخروقٌ:\n");
    for (const problem of problems) {
      console.error(`  ــ [${problem.rule}] ${problem.problem}`);
    }
    console.error(
      "\nوالعلاجُ في الجِذرِ: يبقى القياسُ في `" +
        TELEGRAM_MESSAGES_TEST_FILE +
        "` يعدُّ ما يخرجُ من مُرسِلِ البوتَينِ في رحلةٍ كاملةٍ من بوّابةٍ إنتاجيّةٍ وقاعدةٍ حقيقيّةٍ، " +
        "ويُسنِدُ كلَّ رسالةٍ إلى تحديثِها فيُفرَّقُ الدفعُ من الردِّ، ويستوردُ حَكَمَه وقائمةَ أنواعِه من مصادرِها الواحدةِ. " +
        "وإسكاتُ الحاجزِ ليسَ علاجاً.",
    );
    process.exit(1);
  }

  const criticalKinds = NOTIFICATION_KINDS.filter(
    (kind) => SEEDED_NOTIFICATION_CHANNELS[kind] === "critical",
  ).length;
  console.log(
    `✓ عدُّ رسائلِ تيليجرام محروسٌ (ECO-003): سقفُ دفعٍ مُشتَقٌّ ${String(pushMessageBudget())} رسالةً لكلِّ رحلةٍ · ` +
      `${String(criticalKinds)} نوعاً حرجاً في القائمةِ المغلقةِ · ` +
      `دفقةُ ردٍّ ≤ ${String(RIDE_MESSAGE_PROFILE.maxReplyBurst)} · فُرجةٌ عن ${String(TELEGRAM_FREE_RATE_PER_SECOND)} رسالةً/ثانيةً (TG-001) · ` +
      `${String(JUDGE_RULE_NAMES.length)} قواعدَ حكمٍ · ${String(GUARD_RULE_NAMES.length)} قواعدَ حاجزٍ. ` +
      "وهذا **حِفظُ شرطٍ لا قياسُ فاتورةٍ**: العددُ يُقاسُ على السِلكِ، وتمكينُ البثِّ المدفوعِ وسعرُه في قرارِ DEC-04.",
  );
}

if (import.meta.main) main();
