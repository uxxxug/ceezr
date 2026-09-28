/**
 * اشتقاقُ مخطّطِ staging من مخطّطِ الإنتاجِ — `F9-01` · `OPS-001` · `ADR 0206`.
 *
 * ## لماذا اشتقاقٌ لا نسخةٌ ثانيةٌ
 *
 * البندُ يطلبُ بيئةَ staging «نفسَ الحاويةِ والزمنِ التشغيليِّ ونفسَ وضعِ
 * القاعدةِ». وأضعفُ طريقٍ إليه ملفٌّ ثانٍ يُكتَبُ باليدِ بجانبِ `render.yaml`:
 * يتطابقانِ يومَ الكتابةِ ويتباعدانِ بأوّلِ متغيّرٍ يُضافُ إلى أحدِهما — وهذا
 * التباعدُ هو بعينِه ما يجعلُ staging كاذبةً («نجحَ في staging» عن نظامٍ ليسَ
 * الإنتاجَ). فمصدرُ الحقيقةِ واحدٌ: `render.yaml`. وملفُّ staging **مُشتقٌّ
 * آليّاً** منه بفرقٍ مُعلَنٍ مغلقٍ (`STAGING_OVERLAY`)، ومحفوظٌ في المستودعِ
 * ليُراجَعَ ويُطبَّقَ، والحاجزُ `scripts/check-staging-blueprint.ts` يُعيدُ
 * الاشتقاقَ في كلِّ CI ويُسقِطُ البناءَ على أيِّ بايتٍ مختلفٍ.
 *
 * ## الفرقُ المسموحُ — مغلقٌ
 *
 * 1. **اسمُ كلِّ خدمةٍ** يُلحَقُ به `-staging` (أسماءُ Render فريدةٌ في مساحةِ
 *    العملِ، وخدمتانِ باسمٍ واحدٍ تُسقِطانِ التطبيقَ أو — أسوأُ — تُحدِّثانِ
 *    الإنتاجَ من مخطّطِ staging).
 * 2. **الرأسُ التعليقيُّ** يُستبدَلُ برأسٍ يُعلِنُ أنّ الملفَّ مُولَّدٌ ومن أين.
 *
 * ولا شيءَ غيرُهما: لا خطّةَ أصغرَ، ولا منطقةَ أخرى، ولا `NODE_ENV` آخرَ، ولا
 * متغيّرَ يُحذَفُ. فـstaging تُقلِعُ **بشروطِ ضبطِ الإنتاجِ نفسِها**
 * (`packages/shared/config`) — وهو معنى «نفسُ الزمنِ التشغيليِّ». والأسرارُ كلُّها
 * `sync: false` في الأصلِ، فلكلِّ بيئةٍ قيمُها في لوحتِها ولا يُكتبُ سرٌّ هنا.
 *
 * ## ما لا تفعلُهُ هذهِ المكتبةُ عن قصدٍ
 *
 * - **لا تُنشئُ بيئةً.** إنشاءُ الخدماتِ في Render فعلٌ مدفوعٌ خارجَ المستودعِ،
 *   والنشرُ الحيُّ بأمرٍ لا بدفعةٍ (`autoDeploy: false` · `ADR 0099`). والملفُّ
 *   في `deploy/staging/` لا في الجذرِ، فلا يلتقطُه Render تلقائيّاً.
 * - **لا تدّعي CDN ولا WAF ولا توسّعاً تلقائيّاً ولا قياساً مركزيّاً.** هذهِ
 *   أبعادٌ من البندِ لا يُعبِّرُ عنها مخطّطُ Render أصلاً أو تنتظرُ قراراً، وهيَ
 *   مُسجَّلةٌ في `OPS001_DIMENSIONS` بحاجزِها الصريحِ لا مسكوتٌ عنها (`ح-5`).
 */

/** اللاحقةُ الوحيدةُ التي تفرّقُ خدمةَ staging عن أختِها الإنتاجيّةِ. */
export const STAGING_SUFFIX = "-staging";

/** مسارُ مخطّطِ الإنتاجِ — المصدرُ الوحيدُ. */
export const PRODUCTION_BLUEPRINT = "render.yaml";

/** مسارُ مخطّطِ staging المُشتقِّ المحفوظِ. خارجَ الجذرِ عمداً (لا التقاطَ تلقائيٌّ). */
export const STAGING_BLUEPRINT = "deploy/staging/render.staging.yaml";

/** الرأسُ المُولَّدُ — ثابتٌ، فالاشتقاقُ حتميٌّ بايتاً ببايتٍ. */
export const STAGING_HEADER = [
  "# ⚠️ ملفٌّ مُولَّدٌ — لا يُحرَّرُ باليدِ (F9-01 · OPS-001 · ADR 0206).",
  "#",
  "# مُشتقٌّ آليّاً من render.yaml بفرقَينِ مُعلَنَينِ لا ثالثَ لهما:",
  "#   1) اسمُ كلِّ خدمةٍ يُلحَقُ به -staging،",
  "#   2) هذا الرأسُ بدلَ رأسِ الأصلِ.",
  "# وكلُّ ما عداهما — الحاويةُ والزمنُ التشغيليُّ ووضعُ القاعدةِ والمتغيّراتُ",
  "# والفحوصُ وسياسةُ النشرِ — مطابقٌ للإنتاجِ حرفاً بحرفٍ، والتعليقاتُ الداخليّةُ",
  "# موروثةٌ من الأصلِ كما هي (أسماءُ الخدماتِ فيها أسماءُ الإنتاجِ).",
  "#",
  "# لإعادةِ التوليدِ بعدَ تعديلِ render.yaml:",
  "#   bun run scripts/check-staging-blueprint.ts --write",
  "# والحاجزُ نفسُه بلا --write يُسقِطُ CI على أيِّ تباعدٍ.",
  "#",
  "# لا يلتقطُه Render تلقائيّاً (ليسَ في الجذرِ)، ويُطبَّقُ بأمرٍ صريحٍ كمخطّطٍ",
  "# مستقلٍّ بقيمِ أسرارٍ مستقلّةٍ — والأسرارُ كلُّها sync: false.",
  "",
].join("\n");

/** سطرُ اسمِ خدمةٍ في الشكلِ الضيّقِ الذي يقرؤه `check-instance-invariant.ts`. */
const SERVICE_NAME_LINE = /^( {2}- | {4})name:(\s*)([A-Za-z0-9][A-Za-z0-9_-]*)(\s*(#.*)?)$/;

/** بدايةُ خدمةٍ (مسافتانِ ثم شرطةٌ). */
const SERVICE_START = /^ {2}-\s+[A-Za-z][A-Za-z0-9_]*:/;

export class StagingDerivationError extends Error {}

/**
 * يشتقُّ نصَّ staging من نصِّ الإنتاجِ. يرمي على مُدخلٍ لا يفهمُه — فالاشتقاقُ
 * الناجحُ على ملفٍّ غيرِ مفهومٍ أسوأُ من سقوطِه:
 *
 * - غيابُ سطرِ `services:` في العمودِ الأوّلِ.
 * - خدمةٌ بلا سطرِ اسمٍ، أو باسمَينِ.
 * - اسمٌ يحملُ اللاحقةَ أصلاً (اشتقاقٌ فوقَ اشتقاقٍ).
 */
export function deriveStagingBlueprint(production: string): string {
  const lines = production.split("\n");
  const servicesAt = lines.findIndex((line) => line === "services:");
  if (servicesAt < 0) {
    throw new StagingDerivationError(
      "لا سطرَ «services:» في العمودِ الأوّلِ — بنيةٌ لا يفهمُها الاشتقاقُ.",
    );
  }

  const body = lines.slice(servicesAt);
  const renamed: string[] = [];
  let serviceCount = 0;
  let namesInCurrent = 0;
  const closeService = (at: number) => {
    if (serviceCount > 0 && namesInCurrent !== 1) {
      throw new StagingDerivationError(
        `الخدمةُ رقمُ ${serviceCount} (قبلَ السطرِ ${at}) تحملُ ${namesInCurrent} سطرَ اسمٍ، والمتوقَّعُ واحدٌ.`,
      );
    }
  };

  body.forEach((line, offset) => {
    const lineNumber = servicesAt + offset + 1;
    if (SERVICE_START.test(line)) {
      closeService(lineNumber);
      serviceCount += 1;
      namesInCurrent = 0;
    }
    const match = SERVICE_NAME_LINE.exec(line);
    if (match !== null && serviceCount > 0) {
      const name = match[3] ?? "";
      if (name.endsWith(STAGING_SUFFIX)) {
        throw new StagingDerivationError(
          `الاسمُ «${name}» (السطر ${lineNumber}) يحملُ «${STAGING_SUFFIX}» أصلاً — المُدخلُ ليسَ مخطّطَ الإنتاجِ.`,
        );
      }
      namesInCurrent += 1;
      renamed.push(`${match[1]}name:${match[2]}${name}${STAGING_SUFFIX}${match[4] ?? ""}`);
      return;
    }
    renamed.push(line);
  });
  closeService(lines.length);

  if (serviceCount === 0) {
    throw new StagingDerivationError("لم تُقرأ خدمةٌ واحدةٌ بعدَ «services:».");
  }

  return `${STAGING_HEADER}${renamed.join("\n")}`;
}

/** أسماءُ الخدماتِ في مخطّطٍ (بالترتيبِ). */
export function serviceNames(blueprint: string): readonly string[] {
  const names: string[] = [];
  let inService = false;
  for (const line of blueprint.split("\n")) {
    if (SERVICE_START.test(line)) inService = true;
    if (!inService) continue;
    const match = SERVICE_NAME_LINE.exec(line);
    if (match !== null) names.push(match[3] ?? "");
  }
  return names;
}

export interface StagingFinding {
  readonly code:
    | "STAGING_MISSING"
    | "STAGING_DRIFT"
    | "STAGING_NAME_COLLISION"
    | "DERIVATION_FAILED"
    | "DIMENSION_UNACCOUNTED";
  readonly message: string;
}

/** أوّلُ سطرٍ يختلفُ — للرسالةِ لا للحكمِ (الحكمُ مساواةُ النصِّ كلِّه). */
function firstDifference(expected: string, actual: string): string {
  const a = expected.split("\n");
  const b = actual.split("\n");
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) {
      return `السطر ${index + 1}: المتوقَّعُ «${a[index] ?? "(نهايةُ الملفِّ)"}» والموجودُ «${b[index] ?? "(نهايةُ الملفِّ)"}»`;
    }
  }
  return "لا فرقَ";
}

/**
 * الحكمُ: staging المحفوظُ يساوي اشتقاقَ الإنتاجِ بايتاً ببايتٍ، ولا اسمَ خدمةٍ
 * فيه يلتقي باسمٍ إنتاجيٍّ. `staging === null` يعني أنّ الملفَّ غائبٌ — سقوطٌ لا تخطٍّ.
 */
export function stagingFindings(
  production: string,
  staging: string | null,
): readonly StagingFinding[] {
  let expected: string;
  try {
    expected = deriveStagingBlueprint(production);
  } catch (error) {
    return [
      {
        code: "DERIVATION_FAILED",
        message: `تعذّرَ اشتقاقُ staging من ${PRODUCTION_BLUEPRINT}: ${error instanceof Error ? error.message : String(error)}`,
      },
    ];
  }
  if (staging === null) {
    return [
      {
        code: "STAGING_MISSING",
        message: `${STAGING_BLUEPRINT} غائبٌ — staging ككودٍ لا يُدَّعى بلا ملفِّها. أعِد التوليدَ بـ--write.`,
      },
    ];
  }

  const findings: StagingFinding[] = [];
  if (staging !== expected) {
    findings.push({
      code: "STAGING_DRIFT",
      message:
        `${STAGING_BLUEPRINT} تباعدَ عن اشتقاقِ ${PRODUCTION_BLUEPRINT} — ${firstDifference(expected, staging)}. ` +
        "staging المتباعدةُ تشهدُ عن نظامٍ ليسَ الإنتاجَ؛ عدِّل render.yaml ثم أعِد التوليدَ بـ--write، ولا تُحرِّرِ المُولَّدَ باليدِ.",
    });
  }

  const productionNames = new Set(serviceNames(production));
  for (const name of serviceNames(staging)) {
    if (productionNames.has(name)) {
      findings.push({
        code: "STAGING_NAME_COLLISION",
        message: `الخدمةُ «${name}» في staging تحملُ اسمَ خدمةٍ إنتاجيّةٍ — تطبيقُ المخطّطِ يُحدِّثُ الإنتاجَ لا staging.`,
      });
    }
  }
  return findings;
}

/**
 * أبعادُ `OPS-001` كما في نصِّ `F9-01` — كلُّ بعدٍ إمّا **مُنفَذٌ بالاشتقاقِ**
 * (المطابقةُ الحرفيّةُ تحملُه) وإمّا **خارجيٌّ** بحاجزٍ مُسمّى. لا ثالثَ، ولا
 * بعدَ بلا تصنيفٍ: قائمةٌ مغلقةٌ يفحصُها الاختبارُ على نصِّ البندِ.
 */
export interface Ops001Dimension {
  /** اسمُ البعدِ كما وردَ في نصِّ `F9-01`. */
  readonly dimension: string;
  readonly status: "enforced-by-derivation" | "external";
  /** لماذا يُعدُّ مُنفَذاً، أو ما الحاجزُ الخارجيُّ ومعرّفُه. */
  readonly basis: string;
  /** معرّفاتُ الحواجزِ في `ROADMAP-MASTER.md` للخارجيِّ (فارغةٌ للمُنفَذِ). */
  readonly blockers: readonly string[];
}

export const OPS001_DIMENSIONS: readonly Ops001Dimension[] = [
  {
    dimension: "نفس الحاوية",
    status: "enforced-by-derivation",
    basis: "dockerfilePath وruntime لكلِّ خدمةٍ مطابقانِ حرفيّاً — الحاويةُ نفسُها تُبنى من الملفِّ نفسِه.",
    blockers: [],
  },
  {
    dimension: "الزمن التشغيلي",
    status: "enforced-by-derivation",
    basis:
      "NODE_ENV=production وكلُّ متغيّرِ ضبطٍ مطابقٌ — فتُقلِعُ staging بشروطِ packages/shared/config الإنتاجيّةِ نفسِها.",
    blockers: [],
  },
  {
    dimension: "نفس وضع القاعدة",
    status: "enforced-by-derivation",
    basis:
      "DATABASE_URL مُعلَنٌ sync: false بالمفتاحِ نفسِه وسلسلةُ الهجراتِ واحدةٌ؛ القاعدةُ نفسُها قيمةٌ في لوحةِ البيئةِ لا في الملفِّ.",
    blockers: [],
  },
  {
    dimension: "Redis حقيقي",
    status: "enforced-by-derivation",
    basis:
      "SESSION_STORE=redis ومفاتيحُ UPSTASH_* مطابقةٌ، والحاجزُ check-instance-invariant يمنعُ memory مع production على الأصلِ فيمتدُّ المنعُ بالاشتقاقِ.",
    blockers: [],
  },
  {
    dimension: "طابور حقيقي",
    status: "enforced-by-derivation",
    basis:
      "خدمةُ العاملِ (type: worker) مشتقّةٌ بأختِها، والطابورُ PostgreSQL نفسُه؛ وتقنيةُ الطابورِ النهائيّةُ قرارٌ منفصلٌ (DEC-02) لا يُغيِّرُ التطابقَ.",
    blockers: [],
  },
  {
    dimension: "CDN",
    status: "external",
    basis:
      "مخطّطُ Render لا يُعبِّرُ عن CDN أمامَ خدمةِ Docker؛ الموقعُ الساكنُ يُوزَّعُ على شبكةِ Render وهو موروثٌ بالاشتقاقِ، أمّا CDN للبوّابةِ فحسابُ حافةٍ خارجيٌّ.",
    blockers: ["REQ-04"],
  },
  {
    dimension: "WAF",
    status: "external",
    basis: "لا WAF في مخطّطِ Render؛ يحتاجُ حسابَ حافةٍ خارجيّاً (CDN + WAF ونطاقٌ مخصّصٌ).",
    blockers: ["REQ-04"],
  },
  {
    dimension: "TLS",
    status: "external",
    basis:
      "TLS يُديرُه Render لنطاقِه تلقائيّاً ولا يُعلَنُ في المخطّطِ؛ وTLS على نطاقٍ مخصّصٍ يتبعُ حسابَ الحافةِ والنطاقَ، وإثباتُه قياسٌ على بيئةٍ قائمةٍ.",
    blockers: ["REQ-04"],
  },
  {
    dimension: "توسّع تلقائي",
    status: "external",
    basis:
      "numInstances: 1 شرطُ صحّةٍ لا تفضيلٌ (R-17 · ADR 0050)، ورفعُه محجوبٌ بقرارِ المالكِ؛ فالتوسّعُ التلقائيُّ ممنوعٌ في الإنتاجِ وفي staging سواءً.",
    blockers: ["DEC-14", "REQ-07"],
  },
  {
    dimension: "قياس مركزي",
    status: "external",
    basis: "ناقلُ الآثارِ وجامعُها لم يُقرَّرْ، فلا وجهةَ قياسٍ مركزيٍّ تُعلَنُ في أيِّ بيئةٍ.",
    blockers: ["DEC-17", "REQ-05"],
  },
  {
    dimension: "إدارة أسرار",
    status: "enforced-by-derivation",
    basis:
      "كلُّ سرٍّ sync: false في الأصلِ فيرثُه staging: لا سرَّ مكتوبٌ في المستودعِ، وقيمُ كلِّ بيئةٍ في لوحتِها منفصلةً.",
    blockers: [],
  },
];

/**
 * موارِدُ **إنشاءِ** البيئةِ لا أبعادُ تعريفِها: المخطّطُ يُعلِنُ مفاتيحَ القاعدةِ
 * وRedis، وقيمُها موارِدُ منفصلةٌ لم تُوفَّرْ بعدُ — مشروعُ قاعدةٍ لـstaging بنفسِ
 * الإضافاتِ (`REQ-01`) وRedis حقيقيٌّ لها (`REQ-02`). فالتعريفُ ككودٍ مُنجَزٌ،
 * والإنشاءُ محجوبٌ بهما، ولا يُخلَطُ هذا بذاك.
 */
export const STAGING_PROVISIONING_BLOCKERS: readonly string[] = ["REQ-01", "REQ-02"];

/**
 * يفحصُ أنّ كلَّ بعدٍ خارجيٍّ يُحيلُ إلى حاجزٍ قائمٍ في نصِّ الخارطةِ، وأنّ
 * كلَّ بعدٍ مذكورٍ في نصِّ البندِ مُصنَّفٌ. `itemText` نصُّ سطرِ `F9-01`،
 * و`roadmap` نصُّ `ROADMAP-MASTER.md` كلِّه (للتحقّقِ من وجودِ الحواجزِ).
 */
export function dimensionFindings(itemText: string, roadmap: string): readonly StagingFinding[] {
  const findings: StagingFinding[] = [];
  for (const entry of OPS001_DIMENSIONS) {
    if (!itemText.includes(entry.dimension)) {
      findings.push({
        code: "DIMENSION_UNACCOUNTED",
        message: `البعدُ «${entry.dimension}» مُسجَّلٌ ولا يردُ في نصِّ F9-01 — تصنيفٌ لبعدٍ غيرِ مطلوبٍ أو نصٌّ تغيّر.`,
      });
    }
    if (entry.status === "external" && entry.blockers.length === 0) {
      findings.push({
        code: "DIMENSION_UNACCOUNTED",
        message: `البعدُ «${entry.dimension}» خارجيٌّ بلا حاجزٍ مُسمّى — والخارجيُّ بلا حاجزٍ سكوتٌ.`,
      });
    }
    if (entry.status === "enforced-by-derivation" && entry.blockers.length > 0) {
      findings.push({
        code: "DIMENSION_UNACCOUNTED",
        message: `البعدُ «${entry.dimension}» مُنفَذٌ بالاشتقاقِ ويحملُ حاجزاً — تصنيفٌ متناقضٌ.`,
      });
    }
    for (const blocker of entry.blockers) {
      if (!new RegExp(`^\\| ${blocker} \\|`, "m").test(roadmap)) {
        findings.push({
          code: "DIMENSION_UNACCOUNTED",
          message: `البعدُ «${entry.dimension}» يُحيلُ إلى «${blocker}» ولا صفَّ له في ROADMAP-MASTER.md.`,
        });
      }
    }
  }
  for (const blocker of STAGING_PROVISIONING_BLOCKERS) {
    if (!new RegExp(`^\\| ${blocker} \\|`, "m").test(roadmap)) {
      findings.push({
        code: "DIMENSION_UNACCOUNTED",
        message: `حاجزُ إنشاءِ staging «${blocker}» لا صفَّ له في ROADMAP-MASTER.md.`,
      });
    }
  }
  return findings;
}

/**
 * نصُّ البندِ `F9-01` وحدَه — العمودُ الثاني من صفِّه — لا الصفُّ كلُّه: عمودُ
 * الحالةِ تُضافُ إليه زياداتٌ (`ح-8`) قد تذكرُ الأبعادَ، فقياسُ التصنيفِ على
 * الصفِّ كلِّه يُنجِحُ الفحصَ على نصٍّ حُذِفَ منه بعدٌ ما دامت الزيادةُ تذكرُه.
 * يعيدُ `null` إن غابَ الصفُّ.
 */
export function f901ItemText(roadmap: string): string | null {
  const row = roadmap.split("\n").find((line) => line.startsWith("| F9-01 |"));
  if (row === undefined) return null;
  const cells = row.split(" | ");
  return cells[1] ?? null;
}
