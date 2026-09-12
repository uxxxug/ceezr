#!/usr/bin/env bun
/**
 * الغرض: حارسُ سجلِّ الحواجزِ ومُصدِرِ الإشهادِ (`W-8` زيادةٌ ثانيةٌ / ADR 0087).
 *   ويُنفِذُ ستّةَ أمورٍ، كلُّها **قابلةٌ للإخفاقِ فعلاً**:
 *
 *   ١. **كلُّ معرّفِ حاجزٍ يُذكَرُ في شيفرةِ TypeScript مُفكَّكٌ من `ROADMAP.md`** —
 *      فمعرّفٌ مُختلَقٌ أو مُخطَأٌ حرفاً لا يمرُّ باعتبارِه حكماً. والاستثناءُ
 *      الاصطناعيُّ (معرّفٌ يزرعُه اختبارٌ ليقيسَ الرفضَ) **يُعلَنُ بسببِه وبملفِّه،
 *      ويجبُ أن يُوجَدَ فيه فعلاً**، فلا يبقى إعفاءٌ ميّتٌ.
 *   ٢. **كلُّ معرّفٍ يُذكَرُ في `ROADMAP.md` مُفكَّكٌ صفّاً أو مُعلَنٌ استثناءَ خارطةٍ
 *      بسببٍ** — الطرفُ الثاني: حاجزٌ يُذكَرُ في نصٍّ ولا يُعلَنُ في جدولٍ لا حالةَ
 *      له، وسؤالٌ عنه يرمي.
 *   ٣. **لا حاجزَ بنصٍّ أو أثرٍ فارغٍ** — صفٌّ بلا أثرٍ لا يُراجَعُ.
 *   ٤. **كلُّ حاجزٍ مُغلَقٍ يحملُ دليلاً**: التزاماً أو تاريخاً. «مُغلَقٌ» عارياً
 *      ادّعاءٌ، وهذا الحاجزُ يمنعُ إغلاقاً بكلمةٍ.
 *   ٥. **مُصدِرُ الإشهادِ واحدٌ**: وَسمُ الإشهادِ لا يظهرُ إلّا في ملفِّ المكتبةِ،
 *      ولا ملفَّ آخرَ يُعرِّفُ `issueCoreAttestation`. فسبيلٌ ثانٍ إلى الإشهادِ
 *      يُبطِلُ الأوّلَ كلَّه.
 *   ٦. **الوثيقةُ المولَّدةُ تطابقُ التفكيكَ** — ولا تُكتَبُ يداً (القاعدةُ 0.6).
 *
 * الحالة: منفّذ فعلياً — `W-8` (زيادةٌ ثانيةٌ)، ومربوطٌ بسلسلةِ `ci` وبوظيفةِ
 *   `verify` **قبلَ** خطوةِ `city_id` الحمراءِ، لأنَّ خطوةً بعدَها تُقرَأُ
 *   `skipped` فلا حكمَ لها.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: `W-9` عندَ ربطِ تمرينِ التحوُّلِ بحالةِ `B-5`، وكلُّ
 *   حاجزٍ يسألُ عن حالةِ حاجزٍ بدلاً من أن يفترضَها.
 * ملاحظات مستقبلية: عندَ إغلاقِ تبعيّةٍ في الخارطةِ يتغيَّرُ مُخرَجُ هذا الحارسِ
 *   من نفسِه، ويُطلَبُ توليدُ الوثيقةِ بـ`--write` فيُقرأُ التغيُّرُ في مراجعةٍ.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Blocker,
  mentionedBlockerIds,
  openBlockers,
  parseBlockers,
} from "./lib/wasla-blockers.ts";

export interface Problem {
  readonly check: string;
  readonly detail: string;
}

const ROADMAP = "ROADMAP.md";
const DOC_PATH = "docs/wasla/blockers.md";
const LIB_PATH = "scripts/lib/wasla-migration-dry-run.ts";
const BRAND_TOKEN = "CORE_ATTESTATION_BRAND";
const ISSUER_TOKEN = "export function issueCoreAttestation";
const SCAN_ROOTS = ["apps", "packages", "scripts", "tests"] as const;

/**
 * الملفُّ الوحيدُ المُستثنى من مسحِ المعرّفاتِ والرموزِ: **هذا الحارسُ نفسُه**.
 * فهوَ يُسمّي المعرّفاتَ الاصطناعيّةَ ورمزَ الوَسمِ ونصَّ المُصدِرِ في ثوابتِه، فلو
 * مسحَ نفسَه لَأخفقَ على نفسِه ثمَّ خُفِّفَ — والتخفيفُ هوَ العطبُ الذي يُمنَعُ.
 * **والاستثناءُ ليسَ مجّانيّاً**: الفحصُ ٧ يُخفِقُ إن لم يُوجَدْ هذا الملفُّ في
 * المسحِ أو لم يعُدْ يذكرُ الرمزَينِ، فلا يبقى إعفاءٌ ميّتٌ.
 */
const SELF_FILE = "scripts/check-blocker-registry.ts";

/**
 * ملفُّ الاختبارِ الذي **يقيسُ** استحالةَ التلفيقِ. مُعلَنٌ لأنَّ الفحصَ ٨ يشترطُ
 * وجودَه وأن يبقى يقيسُ الرفضَ فعلاً، فلا يبقى الحاجزُ بلا مسارٍ أحمرَ مقيسٍ.
 */
const FORGERY_TEST_FILE = "tests/unit/wasla-blockers.test.ts";

/**
 * معرّفاتٌ اصطناعيّةٌ تزرعُها اختباراتٌ لتقيسَ **الرفضَ**. كلُّ إعفاءٍ يُعلَنُ
 * بملفِّه وسببِه، والحارسُ يُخفِقُ إن لم يُوجَدْ فعلاً — فالإعفاءُ الميّتُ يُخفي
 * أنَّ الاختبارَ لم يعُدْ يقيسُ شيئاً.
 */
export const SYNTHETIC_ID_EXEMPTIONS: readonly {
  readonly id: string;
  readonly file: string;
  readonly reason: string;
}[] = [
  {
    id: "DEP-CORE-999",
    file: "tests/unit/check-migration-matrix.test.ts",
    reason: "معرّفٌ غيرُ مُعلَنٍ يُزرَعُ في المصفوفةِ ليقيسَ أنَّ حارسَ المصفوفةِ يُخفِقُ على شرطٍ سابقٍ مُختلَقٍ.",
  },
  {
    id: "B-99",
    file: "tests/unit/check-migration-matrix.test.ts",
    reason: "معرّفُ حاجزٍ غيرُ مُعلَنٍ يُزرَعُ ليقيسَ أنَّ حارسَ المصفوفةِ يُخفِقُ على معرّفٍ مُختلَقٍ لا يقبلُه.",
  },
  {
    id: "DEP-CORE-998",
    file: "tests/unit/wasla-blockers.test.ts",
    reason:
      "معرّفٌ غيرُ مُعلَنٍ يُسأَلُ عنه ليقيسَ أنَّ `blockerStatus` **ترمي** ولا تُجيبُ «مُغلَقٌ»، وأنَّ المُصدِرَ يرفضُ إغلاقاً مُختلَقاً.",
  },
  {
    id: "B-98",
    file: "tests/unit/wasla-blockers.test.ts",
    reason:
      "معرّفٌ غيرُ مُعلَنٍ يُسأَلُ عنه ليقيسَ أنَّ `isBlockerOpen` ترمي على المجهولِ بدلاً من أن تُجيبَ إجابةً تُقرأُ إذناً.",
  },
  {
    id: "DEP-CORE-998",
    file: "tests/unit/check-blocker-registry.test.ts",
    reason:
      "معرّفٌ مُختلَقٌ يُزرَعُ في ملفِّ شيفرةٍ اصطناعيٍّ ليقيسَ أنَّ الفحصَ الأوّلَ يُخفِقُ على معرّفٍ بلا صفٍّ في الخارطةِ.",
  },
  {
    id: "B-98",
    file: "tests/unit/check-blocker-registry.test.ts",
    reason:
      "معرّفٌ مُختلَقٌ يُزرَعُ في خارطةٍ وفي شيفرةٍ اصطناعيّتَينِ ليقيسَ طرفَي الفحصِ: إعفاءً حيّاً وإعفاءً ميّتاً وإعفاءً بسببٍ قصيرٍ.",
  },
  {
    id: "O-98",
    file: "tests/unit/check-blocker-registry.test.ts",
    reason: "معرّفٌ مُختلَقٌ في إعفاءِ خارطةٍ اصطناعيٍّ ليقيسَ أنَّ إعفاءً لمعرّفٍ لم يعُدْ مذكوراً في الخارطةِ يُخفِقُ.",
  },
  {
    id: "DEP-CORE-999",
    file: "tests/unit/check-egress-boundary.test.ts",
    reason:
      "معرّفٌ غيرُ مُعلَنٍ يُزرَعُ في مُدخلِ جردٍ اصطناعيٍّ ليقيسَ أنَّ حارسَ حدِّ الصادرِ لا يقبلُ تسليماً محجوباً بتبعيّةٍ مُختلَقةٍ.",
  },
];

/**
 * معرّفاتٌ تُذكَرُ في `ROADMAP.md` بلا صفِّ جدولٍ. تُعلَنُ بسببِها كي لا يُقرأَ
 * غيابُها عن الجدولِ سهواً ولا إذناً.
 */
export const ROADMAP_ID_EXEMPTIONS: readonly { readonly id: string; readonly reason: string }[] = [
  {
    id: "O-5",
    reason:
      "تعليمةُ مالكٍ مُسجَّلةٌ قسماً بعنوانِه (أمرُ الدمجِ في 2026-09-12) لا قرارَ مُنتظَراً في جدولِ القراراتِ، فلا حالةَ «مفتوحٌ/مُغلَقٌ» لها.",
  },
];

/** كلُّ ملفّاتِ TypeScript تحتَ الجذورِ المُعلَنةِ. */
export function typescriptFiles(roots: readonly string[] = SCAN_ROOTS): readonly string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".ts") || path.endsWith(".tsx")) found.push(path);
    }
  };
  for (const root of roots) walk(root);
  return found.sort();
}

/** ما يُمرَّرُ إلى `blockerProblems` كي تكونَ الدالّةُ نقيّةً قابلةً للإفسادِ. */
export interface BlockerInputs {
  readonly roadmapText: string;
  readonly docText: string | null;
  readonly libSource: string;
  /** ملفُّ الشيفرةِ ونصُّه، لكلِّ ملفٍّ يُمسَحُ. */
  readonly sources: readonly { readonly file: string; readonly text: string }[];
  readonly syntheticExemptions: typeof SYNTHETIC_ID_EXEMPTIONS;
  readonly roadmapExemptions: typeof ROADMAP_ID_EXEMPTIONS;
}

export function defaultInputs(): BlockerInputs {
  return {
    roadmapText: readFileSync(ROADMAP, "utf8"),
    docText: readDocOrNull(),
    libSource: readFileSync(LIB_PATH, "utf8"),
    sources: typescriptFiles().map((file) => ({ file, text: readFileSync(file, "utf8") })),
    syntheticExemptions: SYNTHETIC_ID_EXEMPTIONS,
    roadmapExemptions: ROADMAP_ID_EXEMPTIONS,
  };
}

function readDocOrNull(): string | null {
  try {
    return readFileSync(DOC_PATH, "utf8");
  } catch {
    return null;
  }
}

/** جدولُ الوثيقةِ المولَّدةِ. **مُشتَقٌّ من التفكيكِ**، فلا يُكتَبُ يداً. */
export function renderDoc(blockers: readonly Blocker[]): string {
  const rows = blockers
    .map(
      (blocker) =>
        `| \`${blocker.id}\` | ${kindLabel(blocker.kind)} | ${blocker.status === "OPEN" ? "**مفتوحٌ**" : "مُغلَقٌ"} | ${oneLine(blocker.statement)} | ${oneLine(blocker.blocks)} |`,
    )
    .join("\n");
  const open = openBlockers(blockers).length;
  return [
    "# حواجزُ الحكمِ — مُولَّدةٌ من `ROADMAP.md`",
    "",
    "**هذه الوثيقةُ مُولَّدةٌ. لا تُحرَّرْ يداً** (القاعدةُ 0.6): تُولَّدُ بـ",
    "`bun run scripts/check-blocker-registry.ts --write`، ومصدرُها الوحيدُ جداولُ",
    "`ROADMAP.md`. فإن أردتَ تغييرَ حاجزٍ فغيِّرْ صفَّه هناكَ.",
    "",
    `المُفكَّكُ: **${blockers.length}** حاجزاً، منها **${open}** مفتوحةٌ.`,
    "",
    "| المعرّفُ | الصنفُ | الحالةُ | ما هوَ | ماذا يمنعُ |",
    "|---|---|---|---|---|",
    rows,
    "",
  ].join("\n");
}

function kindLabel(kind: Blocker["kind"]): string {
  if (kind === "CORE_DEPENDENCY") return "تبعيّةٌ على CORE";
  if (kind === "OWNER_DECISION") return "قرارُ مالكٍ";
  return "حاجزُ برنامجٍ";
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const COMMIT_OR_DATE = /\b[0-9a-f]{7,40}\b|\b\d{4}-\d{2}-\d{2}\b/;

export function blockerProblems(inputs: BlockerInputs): readonly Problem[] {
  const problems: Problem[] = [];
  const blockers = parseBlockers(inputs.roadmapText);
  const declared = new Set(blockers.map((blocker) => blocker.id));

  // ١ — كلُّ معرّفٍ في الشيفرةِ مُفكَّكٌ، أو مُعفىً اصطناعيّاً بسببٍ.
  for (const source of inputs.sources) {
    if (source.file === SELF_FILE) continue;
    for (const id of mentionedBlockerIds(source.text)) {
      if (declared.has(id)) continue;
      const exemption = inputs.syntheticExemptions.find(
        (entry) => entry.id === id && entry.file === source.file,
      );
      if (exemption === undefined) {
        problems.push({
          check: "معرّفُ حاجزٍ في الشيفرةِ غيرُ مُفكَّكٍ من الخارطةِ",
          detail: `${source.file} يذكرُ \`${id}\` وليسَ له صفٌّ في ${ROADMAP}، ولا إعفاءَ اصطناعيّاً مُعلَناً لهذا الملفِّ`,
        });
        continue;
      }
      if (exemption.reason.trim().length < 20) {
        problems.push({
          check: "إعفاءٌ اصطناعيٌّ بلا سببٍ مقروءٍ",
          detail: `الإعفاءُ لـ\`${id}\` في ${source.file} سببُه أقصرُ من أن يُراجَعَ`,
        });
      }
    }
  }

  // ١-ب — لا إعفاءَ ميّتاً: كلُّ إعفاءٍ يجبُ أن يوجدَ في ملفِّه فعلاً.
  for (const exemption of inputs.syntheticExemptions) {
    const source = inputs.sources.find((entry) => entry.file === exemption.file);
    if (source === undefined) {
      problems.push({
        check: "إعفاءٌ اصطناعيٌّ لملفٍّ غيرِ موجودٍ",
        detail: `${exemption.file} مُعلَنٌ إعفاءً لـ\`${exemption.id}\` وليسَ في المسحِ`,
      });
      continue;
    }
    if (!source.text.includes(exemption.id)) {
      problems.push({
        check: "إعفاءٌ اصطناعيٌّ ميّتٌ",
        detail: `${exemption.file} لم يعُدْ يذكرُ \`${exemption.id}\`، فالإعفاءُ يُخفي أنَّ القياسَ سقطَ`,
      });
    }
  }

  // ٢ — كلُّ معرّفٍ في الخارطةِ مُفكَّكٌ أو مُعفىً بسببٍ.
  const exemptRoadmapIds = new Set(inputs.roadmapExemptions.map((entry) => entry.id));
  for (const id of mentionedBlockerIds(inputs.roadmapText)) {
    if (declared.has(id) || exemptRoadmapIds.has(id)) continue;
    problems.push({
      check: "معرّفٌ في الخارطةِ بلا صفٍّ يُفكَّكُ",
      detail: `${ROADMAP} يذكرُ \`${id}\` ولا صفَّ له في جداولِ الحواجزِ ولا إعفاءَ مُعلَناً، فلا حالةَ تُقرأُ له`,
    });
  }
  for (const exemption of inputs.roadmapExemptions) {
    if (!mentionedBlockerIds(inputs.roadmapText).has(exemption.id)) {
      problems.push({
        check: "إعفاءُ خارطةٍ ميّتٌ",
        detail: `\`${exemption.id}\` لم يعُدْ مذكوراً في ${ROADMAP}، فإعفاؤُه يُخفي تغيُّراً`,
      });
    }
    if (exemption.reason.trim().length < 20) {
      problems.push({
        check: "إعفاءُ خارطةٍ بلا سببٍ مقروءٍ",
        detail: `الإعفاءُ لـ\`${exemption.id}\` سببُه أقصرُ من أن يُراجَعَ`,
      });
    }
  }

  // ٣ — لا حاجزَ بنصٍّ أو أثرٍ فارغٍ.
  for (const blocker of blockers) {
    if (oneLine(blocker.statement).length < 3 || oneLine(blocker.blocks).length < 3) {
      problems.push({
        check: "حاجزٌ بنصٍّ أو أثرٍ فارغٍ",
        detail: `\`${blocker.id}\` صفُّه لا يقولُ ما هوَ أو ماذا يمنعُ`,
      });
    }
  }

  // ٤ — إغلاقٌ بلا دليلٍ يُرفَضُ.
  for (const blocker of blockers) {
    if (blocker.status !== "CLOSED") continue;
    const note = blocker.closureNote ?? "";
    if (!COMMIT_OR_DATE.test(note)) {
      problems.push({
        check: "إغلاقٌ بلا دليلٍ",
        detail: `\`${blocker.id}\` مُعلَنٌ مُغلَقاً بلا التزامٍ ولا تاريخٍ في صفِّه — وكلمةُ «مُغلَقٌ» وحدَها ادّعاءٌ`,
      });
    }
  }

  // ٥ — مُصدِرُ الإشهادِ واحدٌ، ووَسمُه لا يُغادِرُ ملفَّه.
  if (!inputs.libSource.includes(BRAND_TOKEN)) {
    problems.push({
      check: "وَسمُ الإشهادِ مفقودٌ",
      detail: `${LIB_PATH} لا يحتوي \`${BRAND_TOKEN}\`، فالإشهادُ صارَ كائناً يُكتَبُ يداً`,
    });
  }
  if (!inputs.libSource.includes(ISSUER_TOKEN)) {
    problems.push({
      check: "مُصدِرُ الإشهادِ مفقودٌ",
      detail: `${LIB_PATH} لا يُصدِّرُ \`issueCoreAttestation\`، فلا مُصدِرَ وحيداً`,
    });
  }
  for (const source of inputs.sources) {
    // ملفّاتُ الاختبارِ تُستثنى من مسحِ الرموزِ **بسببٍ مَقيسٍ**: هيَ الموضعُ الذي
    // يزرعُ نصَّ المُصدِرِ ونصَّ الوَسمِ سلاسلَ ليقيسَ أنَّ الحارسَ يُخفِقُ عليهما.
    // ولو مُسِحَت لَأخفقَ الحارسُ على قياسِ نفسِه، ثمَّ خُفِّفَ — وذاكَ العطبُ.
    // والاستثناءُ ليسَ مجّانيّاً: الفحصُ ٨ يشترطُ أن يبقى ملفُّ القياسِ موجوداً
    // وأن يبقى يقيسُ الرفضَ، وإلّا أخفقَ الحارسُ.
    if (source.file === LIB_PATH || source.file === SELF_FILE || source.file.startsWith("tests/")) {
      continue;
    }
    if (source.text.includes(BRAND_TOKEN)) {
      problems.push({
        check: "وَسمُ الإشهادِ خارجَ ملفِّه",
        detail: `${source.file} يذكرُ \`${BRAND_TOKEN}\`، وسبيلٌ ثانٍ إلى الوَسمِ يُبطِلُ الاستحالةَ البِنيويّةَ`,
      });
    }
    if (source.text.includes(ISSUER_TOKEN)) {
      problems.push({
        check: "مُصدِرُ إشهادٍ ثانٍ",
        detail: `${source.file} يُعرِّفُ \`issueCoreAttestation\` أيضاً، فالمُصدِرُ لم يبقَ واحداً`,
      });
    }
  }

  // ٧ — استثناءُ الحارسِ نفسِه حيٌّ لا ميّتٌ.
  const self = inputs.sources.find((entry) => entry.file === SELF_FILE);
  if (self === undefined) {
    problems.push({
      check: "استثناءُ الحارسِ نفسِه متقادمٌ",
      detail: `${SELF_FILE} غيرُ موجودٍ في المسحِ، فالاستثناءُ يُعفي ملفّاً لا وجودَ له`,
    });
  } else if (!self.text.includes(BRAND_TOKEN) || !self.text.includes(ISSUER_TOKEN)) {
    problems.push({
      check: "استثناءُ الحارسِ نفسِه لم يعُدْ لهُ سببٌ",
      detail: `${SELF_FILE} لم يعُدْ يذكرُ الوَسمَ أو نصَّ المُصدِرِ، فإعفاؤُه من المسحِ صارَ ثقباً بلا سببٍ`,
    });
  }

  // ٨ — مسارُ التلفيقِ مَقيسٌ فعلاً، وإلّا فاستثناءُ ملفّاتِ الاختبارِ ثقبٌ.
  const forgeryTest = inputs.sources.find((entry) => entry.file === FORGERY_TEST_FILE);
  if (forgeryTest === undefined) {
    problems.push({
      check: "قياسُ التلفيقِ غائبٌ",
      detail: `${FORGERY_TEST_FILE} غيرُ موجودٍ، فاستثناءُ ملفّاتِ الاختبارِ من مسحِ الرموزِ صارَ بلا مقابلٍ`,
    });
  } else if (
    !forgeryTest.text.includes("isIssuedAttestation") ||
    !forgeryTest.text.includes("as unknown as")
  ) {
    problems.push({
      check: "قياسُ التلفيقِ لم يعُدْ يقيسُ",
      detail: `${FORGERY_TEST_FILE} لم يعُدْ يزرعُ إشهاداً ملفَّقاً ولا يقيسُ الوَسمَ، فالاستحالةُ صارت غيرَ مقيسةٍ`,
    });
  }

  // ٦ — الوثيقةُ المولَّدةُ تطابقُ التفكيكَ.
  const expected = renderDoc(blockers);
  if (inputs.docText === null) {
    problems.push({
      check: "الوثيقةُ المولَّدةُ غائبةٌ",
      detail: `${DOC_PATH} غيرُ موجودٍ — يُولَّدُ بـ--write`,
    });
  } else if (inputs.docText.trim() !== expected.trim()) {
    problems.push({
      check: "الوثيقةُ المولَّدةُ لا تطابقُ التفكيكَ",
      detail: `${DOC_PATH} يهجرُ ما يُقرأُ من ${ROADMAP} — يُعادُ توليدُه بـ--write ولا يُحرَّرُ يداً`,
    });
  }

  return problems;
}

function main(): void {
  const write = process.argv.includes("--write");
  const inputs = defaultInputs();
  const blockers = parseBlockers(inputs.roadmapText);
  if (write) {
    writeFileSync(DOC_PATH, renderDoc(blockers), "utf8");
    console.log(`كُتِبَت ${DOC_PATH} — ${blockers.length} حاجزاً.`);
  }
  const problems = blockerProblems(write ? { ...inputs, docText: renderDoc(blockers) } : inputs);
  if (problems.length > 0) {
    console.error("فحصُ سجلِّ الحواجزِ: أخفقَ.");
    for (const problem of problems) console.error(`  - [${problem.check}] ${problem.detail}`);
    process.exit(1);
  }
  const open = openBlockers(blockers).length;
  console.log(
    `فحصُ سجلِّ الحواجزِ: نجح — ${blockers.length} حاجزاً مُفكَّكاً (${open} مفتوحاً)، ومُصدِرُ الإشهادِ واحدٌ، والوثيقةُ مطابقةٌ.`,
  );
}

if (import.meta.main) main();
