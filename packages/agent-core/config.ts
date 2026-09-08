/**
 * الغرض: إعدادات الطبقة، وأهمّها مفتاح التعطيل الشامل الذي يجب أن يُعيد المنصّة
 *   إلى ما كانت عليه قبل وجود هذه الطبقة تماماً.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.1.
 * ينتمي إلى: packages/agent-core
 * يُتوقع أن يستخدمه لاحقاً: gateway.ts، core.ts، طبقات الذاكرة والتجربة
 * ملاحظات مستقبلية: عند تعدّد الخدمات تصير هذه خدمة إعدادات مركزية بتحديث حيّ بلا
 *   إعادة نشر. اليوم متغيّرات بيئة تُقرأ مرّة عند الإقلاع — وهذا كافٍ لخدمة واحدة،
 *   والتعقيد الزائد هنا يُشترى بلا حاجة.
 */

/** جذر الملفات المؤقتة. كل ما تكتبه هذه الطبقة يقع تحته، فيُمحى بمجلد واحد. */
export const DEFAULT_RUNTIME_ROOT = "runtime_agent";

export interface AgentCoreConfig {
  /**
   * **مفتاح التعطيل الشامل.** `false` يعني أن `gateway.ts` يعود فوراً بقرار
   * «معطَّلة» بلا لمس ملف ولا قراءة معرفة ولا كتابة تجربة. هذا ليس تحسيناً بل
   * شرط عزل: طبقةٌ لا يمكن إطفاؤها ليست معزولة، مهما قيل عن حدودها.
   */
  readonly enabled: boolean;
  /** جذر الكتابة المؤقتة. */
  readonly runtimeRoot: string;
  /** مجلد ملفات المعرفة (`.md`) الذي يُحمَّل عند الإقلاع. */
  readonly knowledgeRoot: string;
  /** أقصى عدد أسطر في الذاكرة متوسطة المدى — الأقدم يُحذف. */
  readonly mediumTermMaxLines: number;
  /** عتبة الثقة الدنيا لعرض اقتراح على إنسان. */
  readonly confidenceThreshold: number;
  /** أقصى طول نصّ مقبول من المُدخَل. ما فوقه يُقصّ لا يُرفض. */
  readonly maxInputLength: number;
  /** أقصى طول للاقتراح المعروض. */
  readonly maxOutputLength: number;
  /**
   * أقلّ عدد تجارب متوافقة قبل توليد مرشَّح تعلّم. مرشَّحٌ من تجربة واحدة ليس نمطاً
   * بل صدفة، واعتماده يُعلّم النظام الضجيج.
   */
  readonly minSupportForCandidate: number;
  /** يكتب التجربة والذاكرة على القرص؟ `false` في الاختبارات الوحدوية. */
  readonly persistenceEnabled: boolean;
}

export const DEFAULT_CONFIG: AgentCoreConfig = {
  enabled: false, // ← معطَّلة افتراضياً: طبقة تجريبية لا تُشغَّل بالسهو
  runtimeRoot: DEFAULT_RUNTIME_ROOT,
  knowledgeRoot: "packages/agent-core/knowledge_base",
  mediumTermMaxLines: 5000,
  confidenceThreshold: 0.55,
  maxInputLength: 4000,
  maxOutputLength: 2000,
  minSupportForCandidate: 3,
  persistenceEnabled: true,
};

function readFlag(source: Readonly<Record<string, string | undefined>>, key: string): boolean {
  const raw = source[key];
  // `true` وحدها تُفعّل. أي شيء آخر — بما فيه "1" و"yes" — لا يُفعّل. التساهل في
  // قراءة مفتاح تفعيلٍ يُنتج طبقةً شُغّلت بلا أن يقصد أحد تشغيلها.
  return raw === "true";
}

function readInt(
  source: Readonly<Record<string, string | undefined>>,
  key: string,
  fallback: number,
): number {
  const raw = source[key];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readRatio(
  source: Readonly<Record<string, string | undefined>>,
  key: string,
  fallback: number,
): number {
  const raw = source[key];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

/**
 * تُقرأ من البيئة **بلا رمي استثناء أبداً**: قيمة غير صالحة تعود للافتراضي بدل أن
 * توقف الإقلاع. هذا معاكسٌ مقصود لإعداد المشروع الأساسي (`InvalidEnvVarError`
 * يوقف الإقلاع)، والفرق مبنيّ على الغرض لا على المزاج: خطأ في إعداد المنصّة يجب
 * أن يمنع تشغيلها ناقصةً، وخطأ في إعداد طبقةٍ اختيارية يجب ألّا يُسقط المنصّة معه.
 */
export function loadConfig(
  source: Readonly<Record<string, string | undefined>> = process.env,
): AgentCoreConfig {
  return {
    enabled: readFlag(source, "AGENT_CORE_ENABLED"),
    runtimeRoot: source.AGENT_CORE_RUNTIME_ROOT ?? DEFAULT_CONFIG.runtimeRoot,
    knowledgeRoot: source.AGENT_CORE_KNOWLEDGE_ROOT ?? DEFAULT_CONFIG.knowledgeRoot,
    mediumTermMaxLines: readInt(
      source,
      "AGENT_CORE_MEDIUM_TERM_MAX_LINES",
      DEFAULT_CONFIG.mediumTermMaxLines,
    ),
    confidenceThreshold: readRatio(
      source,
      "AGENT_CORE_CONFIDENCE_THRESHOLD",
      DEFAULT_CONFIG.confidenceThreshold,
    ),
    maxInputLength: readInt(source, "AGENT_CORE_MAX_INPUT_LENGTH", DEFAULT_CONFIG.maxInputLength),
    maxOutputLength: readInt(
      source,
      "AGENT_CORE_MAX_OUTPUT_LENGTH",
      DEFAULT_CONFIG.maxOutputLength,
    ),
    minSupportForCandidate: readInt(
      source,
      "AGENT_CORE_MIN_SUPPORT",
      DEFAULT_CONFIG.minSupportForCandidate,
    ),
    persistenceEnabled: source.AGENT_CORE_PERSISTENCE !== "false",
  };
}
