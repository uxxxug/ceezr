#!/usr/bin/env bun
/**
 * # الحاجزُ: `numInstances` شرطُ صحّةٍ لا تفضيلُ سعةٍ — `R-17` · ADR 0050
 *
 * **الغرض:** أن يستحيل رفعُ عددِ نسخِ خدمةٍ في `render.yaml` فوقَ الواحدةِ بلا
 * سقوطِ بناءٍ، وأن يستحيل تمريرُ خدمةٍ جديدةٍ في الملفِّ بلا تصنيفٍ صريحٍ
 * لعلاقتِها بشرطِ الصحّةِ هذا. فالعيبُ المُشتكى منه في `R-17` أنّ الشرطَ كان
 * **تعليقاً في رأسِ الملفِّ** — والتعليقُ لا يمنع تعديلاً.
 *
 * **الحالة:** الشطرُ التنفيذيُّ من `R-17` (الإنفاذُ) — منفَّذ · مُختبَر · مبرهَنُ
 * السقوطِ بخرقٍ مزروعٍ. وشطرُ **القدرةِ** (توزيعُ الأحداثِ بين النسخِ) مؤجَّلٌ
 * بـADR 0050 §٣-د، فالبندُ لا يُقلَب `[x]`.
 *
 * **ينتمي إلى:** البند `R-17` · [ADR 0050](../docs/adr/0050-single-instance-is-a-correctness-invariant-not-a-comment.md) · `ADR 0011`.
 *
 * **يُتوقع أن يستخدمه لاحقاً:** سلسلةُ `bun run ci`، ويُشغَّل في CI العامِّ عبرَ
 * `tests/unit/check-instance-invariant.test.ts` على المستودعِ الحقيقيِّ.
 *
 * ## كيف يُشغَّل
 *
 * ```
 * bun run scripts/check-instance-invariant.ts [مسارُ render.yaml]
 * ```
 *
 * وغيابُ الملفِّ **سقوطٌ لا تخطٍّ**، وبنيةٌ لا تُفهَم **سقوطٌ** كذلك: حاجزٌ ينجح
 * على مُدخلٍ لم يفهمه ليس حاجزاً.
 *
 * ## ما لا يفعله هذا الحاجزُ عن قصد
 *
 * - **لا يُحلِّل YAML تحليلاً عامّاً.** لا مكتبةَ YAML في الاعتمادياتِ، وإدخالُ
 *   واحدةٍ لأجلِ حاجزٍ توسيعٌ لسطحِ الاعتمادِ. فالمقروءُ **شكلٌ ضيّقٌ مُلزَمٌ**
 *   (خدمةٌ عندَ مسافتَين، حقلٌ عندَ أربعٍ، متغيّرٌ عندَ ستٍّ) وما خرج عنه سقوطٌ.
 * - **لا يحكم على قيمةِ `SESSION_STORE` بذاتِها.** إلزامُ `redis` في الإنتاجِ بندٌ
 *   آخرُ مفتوحٌ (`F5-03` · `SCL-002`)، وليس هذا موضعَه. وإنّما يُقرأ ههنا
 *   **اقتراناً**: عددُ نسخٍ فوقَ الواحدةِ مع `memory` خرقٌ مزدوجٌ (ADR 0011).
 * - **لا يمسّ عددَ النسخِ.** يقرأ ولا يكتب.
 *
 * ## التوسعةُ بـADR 0051 — الطوبولوجيا تُعلَن ولا تُستنتَج
 *
 * الحاجزُ **وُسِّع في موضعِه ولم يُستنسَخ**: حارسٌ ثانٍ يقرأ الملفَّ نفسَه يُنشئ
 * موضعَي حقيقةٍ يتباعدان. والمُضافُ قراءةُ `PROCESS_TOPOLOGY` من متغيّراتِ الخدمةِ،
 * وإنفاذُ **تكافؤٍ في الاتّجاهَين**:
 *
 * ```
 * numInstances == 1   ⟺   PROCESS_TOPOLOGY == single-process
 * ```
 *
 * ولمَ تكافؤٌ لا شرطٌ في اتّجاهٍ واحدٍ: الطرفانِ **إعلانانِ عن الشيءِ نفسِه** في
 * موضعَين، وإعلانانِ متنافرانِ أسوأُ من إعلانٍ واحدٍ خاطئٍ — لأنّ كلَّ قارئٍ
 * يُصدِّق أحدَهما. فمَن رفع النسخَ ونسي الطوبولوجيا يسقط، ومَن أعلن
 * `multi-process` وأبقى النسخةَ واحدةً يسقط كذلك.
 *
 * وتُقرأ `PROCESS_TOPOLOGY` **دلالةً على الطوبولوجيا وحدَها**، و`SESSION_STORE`
 * **دلالةً على مكانِ الجلساتِ وحدَه** — ولا يُستنتَج أحدُهما من الآخرِ (ADR 0051 §١).
 */

import { existsSync, readFileSync } from "node:fs";

const DEFAULT_MANIFEST = "render.yaml";

/**
 * تصنيفُ الخدماتِ المعروفةِ. **قائمةٌ مغلقةٌ**: خدمةٌ في الملفِّ ليست ههنا سقوطٌ،
 * لأنّ الغرضَ منعُ تسلّلِ خدمةٍ متعدّدةِ النسخِ بلا قرارٍ مكتوبٍ.
 */
export const CLASSIFIED_SERVICES: Readonly<Record<string, string>> = {
  /** ناقلُ الأحداثِ داخلَ العمليةِ + حدُّ المعدّلِ في الذاكرةِ ⇒ عمليةٌ واحدةٌ شرطُ صحّةٍ. */
  "waslah-gateway":
    "ناقلُ الأحداثِ داخلَ العمليةِ لا يعبر حدودَها (R-17 · ADR 0050)، وحدُّ المعدّلِ في الذاكرةِ عندَ SESSION_STORE=memory",
  /**
   * القفلُ الموزَّعُ يحمي المهامَّ الدوريةَ من التكرارِ، فليست هذه خدمةَ خطرِ
   * `R-17`. ومع ذلك تُلزَم بالواحدةِ: رفعُها قرارُ سعةٍ يوجب ADR ودليلَ قياسٍ،
   * لا تعديلَ سطرٍ في ملفِّ نشرٍ.
   */
  "waslah-worker": "القفلُ الموزَّعُ يمنع تكرارَ المهامِّ، ورفعُ النسخِ قرارُ سعةٍ يوجب ADR ودليلاً مقيساً",
};

/** خدمةٌ يجب حضورُها — كي لا ينجحَ الحاجزُ على ملفٍّ فُرِّغَ من الخدمةِ المعنيّةِ. */
export const REQUIRED_SERVICES = ["waslah-gateway"] as const;

/**
 * القيمُ الصالحةُ لـ`PROCESS_TOPOLOGY`. تُكرَّر ههنا ولا تُستورَد من
 * `packages/shared/config`: الحاجزُ أداةُ مستودعٍ تقرأ نصّاً، وربطُه بشيفرةِ
 * الإنتاجِ يجعل خطأً في الأولى يُعمي الثانيةَ. والتكرارُ نفسُه محروسٌ بالاختبارِ
 * الذي يُطابِق القائمتَين.
 */
export const VALID_PROCESS_TOPOLOGIES = ["single-process", "multi-process"] as const;

/** متغيّراتُ البيئةِ التي يلتقطها الحاجزُ من كلِّ خدمةٍ. قائمةٌ مغلقةٌ. */
const TRACKED_ENV_KEYS = ["SESSION_STORE", "PROCESS_TOPOLOGY"] as const;

type TrackedEnvKey = (typeof TRACKED_ENV_KEYS)[number];

export interface ServiceDeclaration {
  readonly name: string | null;
  readonly numInstances: string | null;
  readonly sessionStore: string | null;
  /** قيمةُ `PROCESS_TOPOLOGY` المُعلَنةُ للخدمةِ، أو `null` إن لم تُعلَن (ADR 0051). */
  readonly processTopology: string | null;
  /** رقمُ سطرِ `numInstances` — للإحالةِ في الرسالةِ، أو `null` إن غاب الحقلُ. */
  readonly instancesLine: number | null;
  readonly startLine: number;
}

interface MutableService {
  name: string | null;
  numInstances: string | null;
  processTopology: string | null;
  sessionStore: string | null;
  instancesLine: number | null;
  startLine: number;
}

/** يُجرِّد التعليقَ اللاحقَ والفواصلَ من قيمةِ حقلٍ: `frankfurt # أقرب` ⇒ `frankfurt`. */
function bareValue(raw: string): string {
  const withoutComment = raw.split("#")[0] ?? "";
  return withoutComment.trim().replace(/^["']|["']$/g, "");
}

/**
 * يقرأ الخدماتَ من نصِّ الملفِّ بشكلٍ ضيّقٍ مُلزَمٍ. لا يرمي: يُعيد ما وجد،
 * والحكمُ على الفراغِ والنقصِ في `analyse`.
 */
export function servicesFromManifest(content: string): readonly ServiceDeclaration[] {
  const services: MutableService[] = [];
  let current: MutableService | null = null;
  let pendingEnvKey: TrackedEnvKey | null = null;

  content.split("\n").forEach((raw, index) => {
    if (raw.trim().startsWith("#")) return;

    const serviceStart = /^ {2}-\s+([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/.exec(raw);
    if (serviceStart !== null) {
      current = {
        name: null,
        numInstances: null,
        processTopology: null,
        sessionStore: null,
        instancesLine: null,
        startLine: index + 1,
      };
      services.push(current);
      pendingEnvKey = null;
      if (serviceStart[1] === "name") current.name = bareValue(serviceStart[2] ?? "");
      return;
    }

    if (current === null) return;

    const field = /^ {4}([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/.exec(raw);
    if (field !== null) {
      pendingEnvKey = null;
      if (field[1] === "name") current.name = bareValue(field[2] ?? "");
      if (field[1] === "numInstances") {
        current.numInstances = bareValue(field[2] ?? "");
        current.instancesLine = index + 1;
      }
      return;
    }

    const envKey = /^ {6}-\s+key:\s*(.*)$/.exec(raw);
    if (envKey !== null) {
      const key = bareValue(envKey[1] ?? "");
      pendingEnvKey = (TRACKED_ENV_KEYS as readonly string[]).includes(key)
        ? (key as TrackedEnvKey)
        : null;
      return;
    }

    const envValue = /^ {8}value:\s*(.*)$/.exec(raw);
    if (envValue !== null && pendingEnvKey !== null) {
      const value = bareValue(envValue[1] ?? "");
      if (pendingEnvKey === "SESSION_STORE") current.sessionStore = value;
      else current.processTopology = value;
    }
  });

  return services;
}

export interface Finding {
  /** رمزٌ ثابتٌ يُميَّز به الخرقُ بلا مطابقةِ نصٍّ عربيٍّ. */
  readonly code:
    | "NO_SERVICES"
    | "UNNAMED_SERVICE"
    | "UNCLASSIFIED_SERVICE"
    | "MISSING_REQUIRED_SERVICE"
    | "MISSING_NUM_INSTANCES"
    | "INVALID_NUM_INSTANCES"
    | "INSTANCES_ABOVE_ONE"
    | "SESSION_STORE_INCOHERENT"
    | "MISSING_PROCESS_TOPOLOGY"
    | "INVALID_PROCESS_TOPOLOGY"
    | "TOPOLOGY_INSTANCES_MISMATCH"
    | "MULTI_PROCESS_WITHOUT_DISTRIBUTION";
  readonly message: string;
}

/**
 * الحكمُ نقيّاً: نصُّ الملفِّ ⇒ قائمةُ خروقٍ. فراغُها قبولٌ.
 *
 * وترتيبُ الفحوصِ مقصودٌ: بنيةُ الملفِّ أوّلاً، فالتصنيفُ، فالقيمةُ. لأنّ ملفّاً
 * لا تُقرأ خدماتُه لا يُقال فيه «عددُ النسخِ واحدٌ» بحالٍ.
 */
export function analyse(content: string): readonly Finding[] {
  const services = servicesFromManifest(content);
  const findings: Finding[] = [];

  if (services.length === 0) {
    return [
      {
        code: "NO_SERVICES",
        message:
          "لم تُقرأ خدمةٌ واحدةٌ من ملفِّ النشرِ. إمّا فُرِّغَ الملفُّ وإمّا تغيّرت بنيتُه " +
          "عن الشكلِ الذي يقرؤه الحاجزُ — وحاجزٌ ينجح على ملفٍّ لم يفهمه ليس حاجزاً.",
      },
    ];
  }

  for (const name of REQUIRED_SERVICES) {
    if (!services.some((service) => service.name === name)) {
      findings.push({
        code: "MISSING_REQUIRED_SERVICE",
        message: `الخدمةُ «${name}» غائبةٌ عن ملفِّ النشرِ، وهي الخدمةُ التي يسري عليها شرطُ صحّةِ R-17. لا يُقبَل نجاحٌ بلا فحصِها.`,
      });
    }
  }

  for (const service of services) {
    const at = `السطر ${service.instancesLine ?? service.startLine}`;

    if (service.name === null || service.name.length === 0) {
      findings.push({
        code: "UNNAMED_SERVICE",
        message: `خدمةٌ بلا اسمٍ عندَ السطر ${service.startLine} — لا يُحكَم على مجهولٍ.`,
      });
      continue;
    }

    const classification = CLASSIFIED_SERVICES[service.name];
    if (classification === undefined) {
      findings.push({
        code: "UNCLASSIFIED_SERVICE",
        message:
          `الخدمةُ «${service.name}» (${at}) غيرُ مصنَّفةٍ في هذا الحاجزِ. ` +
          "أُضيفت خدمةٌ إلى ملفِّ النشرِ بلا بيانِ علاقتِها بشرطِ صحّةِ R-17: " +
          "يُضاف مدخلُها إلى CLASSIFIED_SERVICES بسببٍ مكتوبٍ قبلَ أن يمرَّ البناءُ.",
      });
      continue;
    }

    if (service.numInstances === null || service.numInstances.length === 0) {
      findings.push({
        code: "MISSING_NUM_INSTANCES",
        message:
          `الخدمةُ «${service.name}» (السطر ${service.startLine}) بلا حقلِ numInstances. ` +
          "والغيابُ ليس واحدةً: يصير العددُ افتراضَ منصّةٍ غيرَ مُصرَّحٍ في المستودعِ، " +
          "وشرطُ الصحّةِ لا يُبنى على افتراضٍ غيرِ مكتوبٍ. يُصرَّح «numInstances: 1».",
      });
      continue;
    }

    if (!/^\d+$/.test(service.numInstances)) {
      findings.push({
        code: "INVALID_NUM_INSTANCES",
        message: `الخدمةُ «${service.name}» (${at}): قيمةُ numInstances «${service.numInstances}» ليست عدداً صحيحاً غيرَ سالبٍ.`,
      });
      continue;
    }

    const instances = Number.parseInt(service.numInstances, 10);

    /*
     * الطوبولوجيا (ADR 0051): تُفحَص **قبلَ** الحكمِ على العددِ، لأنّ إعلاناً
     * مفقوداً أو غيرَ مفهومٍ يُبطِل الحكمَ على الاتّساقِ أصلاً. ولا `continue`
     * بعدَها: عددُ النسخِ يُحكَم عليه في كلِّ حالٍ كي لا يُخفيَ خطأُ طوبولوجيا
     * خرقاً في العددِ.
     */
    if (service.processTopology === null || service.processTopology.length === 0) {
      findings.push({
        code: "MISSING_PROCESS_TOPOLOGY",
        message:
          `الخدمةُ «${service.name}» (السطر ${service.startLine}) بلا متغيّرِ PROCESS_TOPOLOGY. ` +
          "والغيابُ ليس «عمليةً واحدةً»: يصير أهمُّ محورٍ في شرطِ صحّةِ R-17 ضمنيّاً " +
          `غيرَ مكتوبٍ في ملفِّ النشرِ. يُصرَّح بإحدى: ${VALID_PROCESS_TOPOLOGIES.join(" · ")} (ADR 0051 §٢-ب).`,
      });
    } else if (!(VALID_PROCESS_TOPOLOGIES as readonly string[]).includes(service.processTopology)) {
      findings.push({
        code: "INVALID_PROCESS_TOPOLOGY",
        message:
          `الخدمةُ «${service.name}» (السطر ${service.startLine}): قيمةُ PROCESS_TOPOLOGY ` +
          `«${service.processTopology}» غيرُ معروفةٍ. المتاح: ${VALID_PROCESS_TOPOLOGIES.join(" · ")}. ` +
          "ولا تُردُّ القيمةُ المجهولةُ إلى الافتراضِ: من كتبها قصدَ شيئاً، والصمتُ عنها " +
          "عينُ ما يشكو منه R-17.",
      });
    } else {
      const declaredSingle = service.processTopology === "single-process";
      const declaredOneInstance = instances === 1;

      if (declaredSingle !== declaredOneInstance) {
        findings.push({
          code: "TOPOLOGY_INSTANCES_MISMATCH",
          message:
            `الخدمةُ «${service.name}» (${at}): إعلانانِ متنافرانِ — numInstances = ${instances} ` +
            `وPROCESS_TOPOLOGY = «${service.processTopology}». والمُلزَمُ تكافؤٌ: ` +
            "numInstances == 1 ⟺ single-process (ADR 0051 §٢-هـ). " +
            "وإعلانانِ متنافرانِ أسوأُ من واحدٍ خاطئٍ: كلُّ قارئٍ يُصدِّق أحدَهما.",
        });
      }

      /*
       * الرفضُ على **الطوبولوجيا والتوزيعِ** لا على مخزنِ الجلساتِ (ADR 0051 §٢-ج).
       * وآليةُ التوزيعِ المُقرَّرةُ اليومَ `in-process` ثابتاً في الشيفرةِ، فأيُّ
       * إعلانِ `multi-process` خرقٌ ما دامت كذلك.
       */
      if (!declaredSingle) {
        findings.push({
          code: "MULTI_PROCESS_WITHOUT_DISTRIBUTION",
          message:
            `الخدمةُ «${service.name}» (السطر ${service.startLine}) تُعلِن PROCESS_TOPOLOGY = ` +
            "«multi-process»، وآليةُ توزيعِ الأحداثِ المُقرَّرةُ «in-process» لا تعبر حدودَ " +
            "العمليةِ (ADR 0050 §٣-د). فمشتركٌ على نسخةٍ لا يرى حدثاً نُشِر في أخرى. " +
            "ولا يُعلَن multi-process إلّا بعدَ ADR ناسخٍ يعتمد آليةَ توزيعٍ عابرةً.",
        });
      }
    }

    if (instances !== 1) {
      findings.push({
        code: "INSTANCES_ABOVE_ONE",
        message:
          `الخدمةُ «${service.name}» (${at}): numInstances = ${instances} والمُلزَمُ 1. ` +
          `السببُ: ${classification}. ` +
          "وهذا شرطُ صحّةٍ لا تفضيلُ سعةٍ (R-17 · ADR 0050): رفعُه بلا آليةِ توزيعٍ " +
          "يكسر السلوكَ صامتاً. ولا يُرفَع إلّا بـADR ناسخٍ لـADR 0050 §٨.",
      });
      if (instances > 1) {
        findings.push({
          code: "MULTI_PROCESS_WITHOUT_DISTRIBUTION",
          message:
            `وزيادةً على ذلك: «${service.name}» ترفع النسخَ فوقَ الواحدةِ وآليةُ التوزيعِ ` +
            "المُقرَّرةُ «in-process» لا تعبر حدودَ العمليةِ (ADR 0050 §٣-د · ADR 0051 §٢-ج). " +
            "فالرفضُ على الطوبولوجيا والتوزيعِ، لا على مخزنِ الجلساتِ.",
        });
      }
      if (instances > 1 && service.sessionStore !== null && service.sessionStore !== "redis") {
        findings.push({
          code: "SESSION_STORE_INCOHERENT",
          message:
            `وزيادةً على ذلك: «${service.name}» ترفع النسخَ وSESSION_STORE = «${service.sessionStore}». ` +
            "و«redis» إلزاميٌّ قبلَ رفعِ النسخِ لا اختياريٌّ (ADR 0011): الجلساتُ وحدُّ المعدّلِ " +
            "في الذاكرةِ لا يُشاركانِ بين عمليّاتٍ.",
        });
      }
    }
  }

  return findings;
}

function main(): void {
  const manifest = process.argv[2] ?? DEFAULT_MANIFEST;

  if (!existsSync(manifest)) {
    console.error(`❌ ملفُّ النشرِ غيرُ موجودٍ: ${manifest}`);
    console.error("   غيابُ الملفِّ سقوطٌ لا تخطٍّ — لا يُفحَص عددُ النسخِ في العدمِ.");
    process.exit(1);
  }

  let content: string;
  try {
    content = readFileSync(manifest, "utf8");
  } catch (error) {
    console.error(`❌ تعذّرت قراءةُ ملفِّ النشرِ: ${manifest}`);
    console.error(`   ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const findings = analyse(content);
  if (findings.length > 0) {
    console.error(`❌ خرقُ شرطِ صحّةِ النسخةِ الواحدةِ في ${manifest} (R-17 · ADR 0050):`);
    for (const finding of findings) console.error(`  - [${finding.code}] ${finding.message}`);
    process.exit(1);
  }

  console.log(`✅ كلُّ خدمةٍ في ${manifest} مصنَّفةٌ وعددُ نسخِها 1 — شرطُ صحّةِ R-17 قائمٌ.`);
}

if (import.meta.main) {
  main();
}
