#!/usr/bin/env bun
/**
 * # الحاجزُ: مانيفستُ النشرِ شرطُ صحّةٍ لا تفضيلُ سعةٍ — `R-17` · ADR 0050 ·
 * `F5-04` / `SCL-007` · ADR 0063
 *
 * **الغرض:** أن يستحيل رفعُ عددِ نسخِ خدمةٍ في `render.yaml` فوقَ الواحدةِ بلا
 * سقوطِ بناءٍ، وأن يستحيل تمريرُ خدمةٍ جديدةٍ في الملفِّ بلا تصنيفٍ صريحٍ
 * لعلاقتِها بشرطِ الصحّةِ هذا. فالعيبُ المُشتكى منه في `R-17` أنّ الشرطَ كان
 * **تعليقاً في رأسِ الملفِّ** — والتعليقُ لا يمنع تعديلاً.
 *
 * **وشرطٌ ثانٍ أُضيف بـ`F5-04`:** أن يستحيل أن يُعلِن المانيفستُ إطفاءَ المهامِّ
 * الدوريّةِ في البوّابةِ (`RUN_WORKER_IN_GATEWAY` كاذبة) بلا خدمةٍ من نوعِ
 * `worker` تحملها — وهو الحالُ المُشخَّصُ في
 * `docs/directive-item-0-live-diagnosis.md` §0.2: لا مهمّةٌ دوريّةٌ واحدةٌ تعمل
 * في المنظومةِ كلِّها، و`/health` يقول «سليم». ويُفحَص كذلك أنّ كلَّ خدمةٍ
 * **تُعلن** المتغيّرَ بقيمةٍ من قائمةٍ مغلقةٍ، فـ`"fasle"` تُقرَأ اليومَ «كاذبة»
 * بصمتٍ. والتفصيلُ في ADR 0063.
 *
 * **الحالة:** الشطرُ التنفيذيُّ من `R-17` (الإنفاذُ) — منفَّذ · مُختبَر · مبرهَنُ
 * السقوطِ بخرقٍ مزروعٍ. وشطرُ **القدرةِ** (توزيعُ الأحداثِ بين النسخِ) مؤجَّلٌ
 * بـADR 0050 §٣-د، فالبندُ لا يُقلَب `[x]`.
 *
 * **ينتمي إلى:** البند `R-17` · [ADR 0050](../docs/adr/0050-single-instance-is-a-correctness-invariant-not-a-comment.md) · `ADR 0011` ·
 * البند `F5-04` / `SCL-007` · [ADR 0063](../docs/adr/0063-worker-service-separation.md).
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
  /**
   * خدمةُ لوحةِ الإدارةِ (`F5-08` / `ARCH-011` · ADR 0064). ليست خدمةَ خطرِ `R-17`:
   * لا تستقبل تحديثَ تلغرام فلا حالةَ حوارٍ فيها، وحالُ تصريحِها كلُّها في القاعدةِ
   * (جلسةٌ بجدولٍ ورمزُ CSRF مُشتقٌّ لا مُخزَّنٌ)، فهي عمليّاً بلا حالةٍ محلّيّةٍ.
   * ومع ذلك تُلزَم بالنسخةِ الواحدةِ لسببٍ آخرَ: كلُّ نسخةٍ تفتح مستهلِكاً لمجرى
   * `waslah:tracking:events` وبِركةَ اتّصالاتٍ خاصّةً بها، ورفعُ العددِ يضاعفهما
   * لخدمةٍ يستخدمها مشغّلون معدودون — قرارُ سعةٍ يوجب دليلاً مقيساً لا تعديلَ سطرٍ.
   */
  "waslah-admin":
    "لا حالةَ محلّيّةً فيها (التصريحُ في القاعدةِ · ARCH-005)، لكنّ رفعَ النسخِ يضاعف مستهلِكي مجرى Redis وبِركَ الاتّصالِ — قرارُ سعةٍ يوجب ADR ودليلاً مقيساً",
};

/**
 * اسمُ خدمةِ اللوحةِ. ثابتٌ مُصدَّرٌ لا نصٌّ مكرَّرٌ: يُقرأ في حكمَي `ADMIN_DUPLICATED`
 * و`ADMIN_ORPHANED` وفي رسالتَيهما وفي الاختبارِ، وأربعُ نسخٍ يدويّةٍ منه تختلف
 * بسهوٍ فيصير حكمٌ يبحث عن اسمٍ لا يوجد — أي حاجزٌ ينجح دائماً.
 */
export const ADMIN_SERVICE_NAME = "waslah-admin";

/** خدمةٌ يجب حضورُها — كي لا ينجحَ الحاجزُ على ملفٍّ فُرِّغَ من الخدمةِ المعنيّةِ. */
export const REQUIRED_SERVICES = ["waslah-gateway"] as const;

/**
 * القيمُ الصالحةُ لـ`PROCESS_TOPOLOGY`. تُكرَّر ههنا ولا تُستورَد من
 * `packages/shared/config`: الحاجزُ أداةُ مستودعٍ تقرأ نصّاً، وربطُه بشيفرةِ
 * الإنتاجِ يجعل خطأً في الأولى يُعمي الثانيةَ. والتكرارُ نفسُه محروسٌ بالاختبارِ
 * الذي يُطابِق القائمتَين.
 */
export const VALID_PROCESS_TOPOLOGIES = ["single-process", "multi-process"] as const;

/**
 * حروفُ المنطقيِّ الصالحةُ لـ`RUN_WORKER_IN_GATEWAY` و`RUN_ADMIN_IN_GATEWAY`. تُكرَّر ههنا ولا تُستورَد من
 * `packages/shared/config` لنفسِ سببِ `VALID_PROCESS_TOPOLOGIES` أعلاه، والتكرارُ
 * محروسٌ باختبارٍ يُطابِق القائمتَين.
 */
export const VALID_BOOLEAN_LITERALS = [
  "true",
  "1",
  "yes",
  "on",
  "false",
  "0",
  "no",
  "off",
] as const;

/** الحروفُ التي تعني نفياً — «لا تعمل في البوّابةِ»، للمهامِّ وللوحةِ سواءً. */
const FALSY_BOOLEAN_LITERALS: readonly string[] = ["false", "0", "no", "off"];

/** الحروفُ التي تعني إثباتاً. تُشتقُّ لا تُكتَب: قائمتانِ يدويّتانِ تختلفان بسهوٍ. */
const TRUTHY_BOOLEAN_LITERALS: readonly string[] = VALID_BOOLEAN_LITERALS.filter(
  (literal) => !FALSY_BOOLEAN_LITERALS.includes(literal),
);

/** متغيّراتُ البيئةِ التي يلتقطها الحاجزُ من كلِّ خدمةٍ. قائمةٌ مغلقةٌ. */
const TRACKED_ENV_KEYS = [
  "SESSION_STORE",
  "PROCESS_TOPOLOGY",
  "RUN_WORKER_IN_GATEWAY",
  "RUN_ADMIN_IN_GATEWAY",
] as const;

type TrackedEnvKey = (typeof TRACKED_ENV_KEYS)[number];

export interface ServiceDeclaration {
  readonly name: string | null;
  readonly numInstances: string | null;
  readonly sessionStore: string | null;
  /** قيمةُ `PROCESS_TOPOLOGY` المُعلَنةُ للخدمةِ، أو `null` إن لم تُعلَن (ADR 0051). */
  readonly processTopology: string | null;
  /**
   * قيمةُ `RUN_WORKER_IN_GATEWAY` المُعلَنةُ للخدمةِ، أو `null` إن لم تُعلَن
   * (F5-04 / SCL-007 · ADR 0063). وهي **إعلانُ موضعِ المهامِّ الدوريّةِ** لا مُفعِّلُ
   * ميزةٍ، فغيابُها من ملفِّ النشرِ سكوتٌ عن أهمِّ سؤالٍ فيه.
   */
  readonly runWorkerInGateway: string | null;
  /**
   * قيمةُ `RUN_ADMIN_IN_GATEWAY` المُعلَنةُ للخدمةِ، أو `null` إن لم تُعلَن
   * (`F5-08` / `ARCH-011` · ADR 0064). وهي إعلانُ **موضعِ سطحِ الإدارةِ**، وخطرُها
   * معكوسٌ عن أختِها: خطأُ موضعِ المهامِّ يوقف المهامَّ، وخطأُ هذا يُبقي كلَّ شيءٍ
   * يعمل **ويُلغي العزلَ وحدَه** — فلا يُقاس أحدُهما على الآخرِ في الحكمِ.
   */
  readonly runAdminInGateway: string | null;
  /**
   * نوعُ الخدمةِ كما في `type:` (`web` · `worker` · …)، أو `null` إن غاب. يُقرأ
   * لأنّ حكمَ «المهامُّ بلا موضعٍ» يحتاج معرفةَ **هل في الملفِّ خدمةُ عاملٍ أصلاً**،
   * والاسمُ وحدَه لا يكفي: خدمةٌ تُسمّى `waslah-worker` وتُعلَن `type: web` ليست عاملاً.
   */
  readonly serviceType: string | null;
  /** رقمُ سطرِ `numInstances` — للإحالةِ في الرسالةِ، أو `null` إن غاب الحقلُ. */
  readonly instancesLine: number | null;
  readonly startLine: number;
}

interface MutableService {
  name: string | null;
  numInstances: string | null;
  processTopology: string | null;
  runWorkerInGateway: string | null;
  runAdminInGateway: string | null;
  serviceType: string | null;
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
        runWorkerInGateway: null,
        runAdminInGateway: null,
        serviceType: null,
        sessionStore: null,
        instancesLine: null,
        startLine: index + 1,
      };
      services.push(current);
      pendingEnvKey = null;
      if (serviceStart[1] === "name") current.name = bareValue(serviceStart[2] ?? "");
      if (serviceStart[1] === "type") current.serviceType = bareValue(serviceStart[2] ?? "");
      return;
    }

    if (current === null) return;

    const field = /^ {4}([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/.exec(raw);
    if (field !== null) {
      pendingEnvKey = null;
      if (field[1] === "name") current.name = bareValue(field[2] ?? "");
      if (field[1] === "type") current.serviceType = bareValue(field[2] ?? "");
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
      /*
       * فرزٌ **مُستوفٍ** بلا فرعٍ جامعٍ — والتحذيرُ الذي كان مكتوباً ههنا وقعَ فعلاً:
       *
       * النسخةُ الأولى أسندت كلَّ ما ليس `SESSION_STORE` إلى `processTopology`،
       * فصحّحها `F5-04` إلى ثلاثةِ فروعٍ آخرُها `else current.runWorkerInGateway`.
       * وذلك `else` كان صحيحاً بثلاثةِ مفاتيحَ وخطأً بأربعةٍ: مع `F5-08` صار
       * `RUN_ADMIN_IN_GATEWAY` يُسنَد إلى `runWorkerInGateway` فتُقرأ قيمتُه
       * موضعاً للمهامِّ — **وينجحُ الحاجزُ على ملفٍّ لم يفهمه**، وهو أسوأُ من
       * سقوطِه. فالفرزُ الآن صريحٌ لكلِّ مفتاحٍ، ويُحيلُ المجهولَ إلى `never`:
       * إضافةُ مفتاحٍ خامسٍ إلى `TRACKED_ENV_KEYS` بلا فرعٍ له **تُسقِط
       * `typecheck`** لا تُنتِج قراءةً خاطئةً صامتةً.
       */
      switch (pendingEnvKey) {
        case "SESSION_STORE":
          current.sessionStore = value;
          break;
        case "PROCESS_TOPOLOGY":
          current.processTopology = value;
          break;
        case "RUN_WORKER_IN_GATEWAY":
          current.runWorkerInGateway = value;
          break;
        case "RUN_ADMIN_IN_GATEWAY":
          current.runAdminInGateway = value;
          break;
        default: {
          const exhaustive: never = pendingEnvKey;
          throw new Error(`مفتاحٌ مُتتبَّعٌ بلا فرعِ إسنادٍ: ${String(exhaustive)}`);
        }
      }
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
    | "MULTI_PROCESS_WITHOUT_DISTRIBUTION"
    | "MISSING_RUN_WORKER_DECLARATION"
    | "INVALID_RUN_WORKER_VALUE"
    | "JOBS_ORPHANED"
    | "MISSING_RUN_ADMIN_DECLARATION"
    | "INVALID_RUN_ADMIN_VALUE"
    | "ADMIN_DUPLICATED"
    | "ADMIN_ORPHANED";
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
        // طبقةُ ملفِّ النشرِ توجب إعلاناً صريحاً، وطبقةُ العمليةِ تفترض
        // `single-process` عندَ الغيابِ (ADR 0051 §٢-ب). والفرقُ مقصودٌ: الملفُّ
        // إعلانُ نيّةٍ يُقرأ بجانبِ `numInstances` فلا يُقبَل فيه سكوتٌ.
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

    /*
     * موضعُ المهامِّ الدوريّةِ (F5-04 / SCL-007 · ADR 0063). يُفحَص **لكلِّ خدمةٍ**
     * لا للبوّابةِ وحدَها: `packages/shared/config` صار يُلزم الإعلانَ في الإنتاجِ،
     * فخدمةٌ إنتاجيّةٌ بلا هذا السطرِ **لا تُقلع أصلاً** — وسقوطُ إقلاعِ العاملِ هو
     * عينُ العطلِ الذي تمنعه هذه المرحلةُ، فلا يُترَك لِيُكتشَف في النشرِ.
     */
    if (service.runWorkerInGateway === null || service.runWorkerInGateway.length === 0) {
      findings.push({
        code: "MISSING_RUN_WORKER_DECLARATION",
        message:
          `الخدمةُ «${service.name}» (السطر ${service.startLine}) بلا متغيّرِ RUN_WORKER_IN_GATEWAY. ` +
          "وهو في الإنتاجِ **إعلانٌ إلزاميٌّ** يمنع الإقلاعَ إن غاب (ADR 0063)، فغيابُه ههنا " +
          "خدمةٌ لا تُقلع لا خدمةٌ بافتراضٍ. وأصلُ الإلزامِ أنّ السكوتَ عن موضعِ المهامِّ " +
          `يُفسَّر لصالحِ أحدِ الطرفَين بلا قرارٍ مكتوبٍ. يُصرَّح بإحدى: ${VALID_BOOLEAN_LITERALS.join(" · ")}.`,
      });
    } else if (
      !(VALID_BOOLEAN_LITERALS as readonly string[]).includes(
        service.runWorkerInGateway.toLowerCase(),
      )
    ) {
      findings.push({
        code: "INVALID_RUN_WORKER_VALUE",
        message:
          `الخدمةُ «${service.name}» (السطر ${service.startLine}): قيمةُ RUN_WORKER_IN_GATEWAY ` +
          `«${service.runWorkerInGateway}» لا تُفهَم. المتاح: ${VALID_BOOLEAN_LITERALS.join(" · ")}. ` +
          "ولا تُردُّ المجهولةُ إلى الافتراضِ: «fasle» تُقرأ true فتعمل المهامُّ في موضعٍ " +
          "غيرِ الذي قصدَه من كتبها — وهو انحرافٌ صامتٌ بين ما ضُبِط وما يعمل.",
      });
    }

    /*
     * موضعُ سطحِ الإدارةِ (`F5-08` / `ARCH-011` · ADR 0064). يُفحَص لكلِّ خدمةٍ بنفسِ
     * حجّةِ أختِه أعلاه حرفاً: الإعلانُ صار إلزاميّاً في الإنتاجِ، فخدمةٌ بلا سطرِه
     * **لا تُقلع**. ويُفحَص للعاملِ أيضاً — وهو لا يقرؤه — لأنّ الإعدادَ واحدٌ في
     * كلِّ عمليّةٍ، والإلزامُ لا يستثني مَن لا يستخدم.
     */
    if (service.runAdminInGateway === null || service.runAdminInGateway.length === 0) {
      findings.push({
        code: "MISSING_RUN_ADMIN_DECLARATION",
        message:
          `الخدمةُ «${service.name}» (السطر ${service.startLine}) بلا متغيّرِ RUN_ADMIN_IN_GATEWAY. ` +
          "وهو في الإنتاجِ إعلانٌ إلزاميٌّ يمنع الإقلاعَ إن غاب (ADR 0064)، فغيابُه ههنا " +
          `خدمةٌ لا تُقلع لا خدمةٌ بافتراضٍ. يُصرَّح بإحدى: ${VALID_BOOLEAN_LITERALS.join(" · ")}.`,
      });
    } else if (
      !(VALID_BOOLEAN_LITERALS as readonly string[]).includes(
        service.runAdminInGateway.toLowerCase(),
      )
    ) {
      findings.push({
        code: "INVALID_RUN_ADMIN_VALUE",
        message:
          `الخدمةُ «${service.name}» (السطر ${service.startLine}): قيمةُ RUN_ADMIN_IN_GATEWAY ` +
          `«${service.runAdminInGateway}» لا تُفهَم. المتاح: ${VALID_BOOLEAN_LITERALS.join(" · ")}. ` +
          "ولا تُردُّ المجهولةُ إلى الافتراضِ: القديمُ كان يُقرأ true، فتعود اللوحةُ إلى " +
          "البوّابةِ من حيث لا يعلم من كتبها — ولا شيءَ يُخفِق فيُنبِّه.",
      });
    }
  }

  /*
   * ## حكمُ «المهامُّ بلا موضعٍ» — الخرقُ الذي وقعَ فعلاً في الإنتاجِ
   *
   * `docs/directive-item-0-live-diagnosis.md` §0.2 يُثبِت أنّ خدمةَ العاملِ كانت
   * **مُعرَّفةً في هذا الملفِّ وغيرَ مُنشأةٍ في المنصّةِ**، فلمّا أُطفئ العاملُ
   * المضمَّنُ لم تُنفَّذ مهمّةٌ دوريّةٌ واحدةٌ قطُّ. والحاجزُ لا يرى منصّةً، لكنّه
   * يرى **المخطوطةَ** — فيمنع أن تُعبِّر أصلاً عن حالِ «لا مهامَّ في أيِّ موضعٍ».
   *
   * ويُفحَص عبرَ الخدماتِ لا داخلَ واحدةٍ، لأنّ الحكمَ **علاقةٌ بينها**: بوّابةٌ
   * تتخلّى عن المهامِّ مقبولةٌ إن وُجِد مَن يحملها، ومرفوضةٌ إن لم يوجد. وهذا هو
   * الفرقُ بين فصلِ العاملِ وإسقاطِه.
   */
  const gateway = services.find((service) => service.name === "waslah-gateway");
  const gatewayDisownsJobs =
    gateway !== undefined &&
    gateway.runWorkerInGateway !== null &&
    FALSY_BOOLEAN_LITERALS.includes(gateway.runWorkerInGateway.toLowerCase());
  if (gatewayDisownsJobs && !services.some((service) => service.serviceType === "worker")) {
    findings.push({
      code: "JOBS_ORPHANED",
      message:
        "«waslah-gateway» تُعلِن RUN_WORKER_IN_GATEWAY = false ولا خدمةَ «type: worker» في الملفِّ. " +
        "فليست هذه طوبولوجيا مفصولةً بل نظاماً بلا مهامَّ دوريّةٍ: لا اشتراكٌ ينتهي، ولا عرضٌ " +
        "يُسقَط بمهلتِه فيبقى الطلبُ باحثاً للأبد، ولا نسخةٌ احتياطيّةٌ تُؤخَذ — وهو العطلُ " +
        "المُشخَّصُ في docs/directive-item-0-live-diagnosis.md §0.2. " +
        "وهو **توقّفٌ تامٌّ صامتٌ** لا عطلٌ جزئيٌّ: لا طلبٌ يُخفِق ولا سجلٌّ يشكو. " +
        "فإمّا تُعلَن خدمةُ عاملٍ، وإمّا يُعاد الإدماجُ بـtrue صريحةٍ (ADR 0063).",
    });
  }

  /*
   * ## حكمُ موضعِ سطحِ الإدارةِ — خرقٌ **صامتٌ في الطرفَين**
   *
   * وهو معكوسُ حكمِ المهامِّ أعلاه لا نظيرُه:
   *
   * `ADMIN_DUPLICATED` (بوّابةٌ تُثبِت + خدمةُ لوحةٍ موجودةٌ): لا يُخفِق شيءٌ. تُقلع
   * الخدمتان، ويُجيب `/ready` أخضرَ، وتُفتَح اللوحةُ من العنوانَين وتعمل من
   * كليهما. **والعزلُ الذي دُفع ثمنُه — خدمةٌ كاملةٌ — لا يكون قائماً**: خريطةُ
   * العمليّاتِ الحيّةُ وتقاريرُ الحرارةِ والدفعاتِ تبقى تسحب من بِركةِ اتّصالاتِ
   * القاعدةِ نفسِها التي يجب أن تُجيبَ منها معالجةُ ويبهوكِ تلغرام في ثوانٍ
   * (`ARCH-013`). ولا يُكتشَف إلا بقياسٍ لا يُجريه أحدٌ — فالحاجزُ هو المُكتشِف.
   *
   * `ADMIN_ORPHANED` (بوّابةٌ تنفي + لا خدمةَ لوحةٍ): لا سطحَ إدارةٍ في أيِّ موضعٍ.
   * أصخبُ من أخيه — من يفتح الرابطَ يجد 404 — لكنّه لا يُخفِق مسارَ عملٍ واحداً
   * لراكبٍ أو سائقٍ، فيُكتشَف يومَ يحتاجه مشغّلٌ لا يومَ يُنشَر.
   *
   * والتعرّفُ على خدمةِ اللوحةِ **بالاسمِ** لا بالنوعِ: نوعُها `web` كالبوّابةِ،
   * فلا يُميَّزان بـ`type` كما مُيِّز العاملُ. والاسمُ مربوطٌ بـ`CLASSIFIED_SERVICES`
   * فلا يُسمّى شيءٌ `waslah-admin` بلا قرارٍ مكتوبٍ.
   */
  const adminService = services.find((service) => service.name === ADMIN_SERVICE_NAME);
  const gatewayHostsAdmin =
    gateway !== undefined &&
    gateway.runAdminInGateway !== null &&
    TRUTHY_BOOLEAN_LITERALS.includes(gateway.runAdminInGateway.toLowerCase());
  const gatewayDisownsAdmin =
    gateway !== undefined &&
    gateway.runAdminInGateway !== null &&
    FALSY_BOOLEAN_LITERALS.includes(gateway.runAdminInGateway.toLowerCase());

  if (gatewayHostsAdmin && adminService !== undefined) {
    findings.push({
      code: "ADMIN_DUPLICATED",
      message:
        `«waslah-gateway» تُعلِن RUN_ADMIN_IN_GATEWAY مُثبِتاً ومعها خدمةُ «${ADMIN_SERVICE_NAME}» ` +
        `(السطر ${adminService.startLine}). فسطحُ الإدارةِ في موضعَين، **ولا شيءَ يُخفِق**: ` +
        "الخدمتان تُقلعان، و/ready أخضرُ، واللوحةُ تعمل من العنوانَين. والذي يضيع هو " +
        "الغرضُ وحدَه: استعلاماتُ اللوحةِ الثقيلةُ تبقى تسحب من بِركةِ اتّصالاتِ البوّابةِ " +
        "التي يجب أن تُجيبَ ويبهوكَ تلغرام في ثوانٍ (ARCH-013 · ADR 0064). " +
        "فإمّا false على البوّابةِ، وإمّا تُحذَف خدمةُ اللوحةِ ويبقى الإدماجُ صريحاً.",
    });
  }

  if (gatewayDisownsAdmin && adminService === undefined) {
    findings.push({
      code: "ADMIN_ORPHANED",
      message:
        `«waslah-gateway» تُعلِن RUN_ADMIN_IN_GATEWAY = false ولا خدمةَ «${ADMIN_SERVICE_NAME}» في الملفِّ. ` +
        "فلا سطحَ إدارةٍ في أيِّ موضعٍ: لا موافقةَ على سائقٍ، ولا تفعيلَ اشتراكٍ يدويّاً، " +
        "ولا شاشةَ يُشخَّص بها عطلٌ — والنظامُ يخدّم الرحلاتِ فلا يُنبِّه أحدٌ. " +
        "وهو عينُ نمطِ العطلِ في docs/directive-item-0-live-diagnosis.md §0.2: خدمةٌ " +
        "مُتخلّىً عنها ولا مَن يحمل عملَها. فإمّا تُعلَن الخدمةُ، وإمّا يُعاد الإدماجُ بـtrue.",
    });
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

  console.log(
    `✅ كلُّ خدمةٍ في ${manifest} مصنَّفةٌ وعددُ نسخِها 1 — شرطُ صحّةِ R-17 قائمٌ؛ ` +
      `وموضعُ المهامِّ الدوريّةِ مُعلَنٌ ولا مهامَّ يتيمةً — شرطُ F5-04 قائمٌ؛ ` +
      `وموضعُ سطحِ الإدارةِ مُعلَنٌ في موضعٍ واحدٍ لا صفرٍ ولا اثنَين — شرطُ F5-08 قائمٌ.`,
  );
}

if (import.meta.main) {
  main();
}
