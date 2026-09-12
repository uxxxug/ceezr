/**
 * الغرض: مصدرُ الحقيقةِ الواحدُ لأداتَي التشغيلِ الجافِّ والتسويةِ في هجرةِ
 *   WASLA (`W-8`). الملفُّ **لا يُكرِّرُ** المصفوفةَ ولا الجردَ: الجداولُ والموجاتُ
 *   والآليّاتُ تُقرأُ من `wasla-migration-matrix.ts` عندَ التوليدِ والفحصِ
 *   (القاعدةُ 0.6). وما يُعلَنُ ههنا شيئانِ لا ثالثَ لهما:
 *
 *   ١. **كيفَ يُقاسُ جدولٌ قياساً للقراءةِ فقط** — تعبيرُ التجميعِ لكلِّ جدولٍ.
 *   ٢. **متى يجوزُ لتسويةٍ أن تقولَ «مُسوّىً»** — مفرداتٌ مغلقةٌ وشرطُ إشهادٍ.
 *
 *   والثابتُ الحاكمُ في البندِ ثابتانِ، وكلاهما **مُنفَذٌ لا موعودٌ**:
 *
 *   - **التشغيلُ الجافُّ لا يستطيعُ الكتابةَ.** لا لأنَّه «لا يكتبُ» في نصِّه، بل
 *     لأنَّه يُشغَّلُ داخلَ `BEGIN … READ ONLY` فمُحرِّكُ PostgreSQL نفسُه يردُّ أيَّ
 *     كتابةٍ بخطأٍ (`25006`)، ثمَّ تُلفُّ المُعاملةُ بـ`ROLLBACK` على كلِّ حالٍ.
 *     وذانِ سبيلانِ مستقلّانِ لا سبيلٌ واحدٌ: لو أخفقَ الثاني لَمنعَ الأوّلُ، ولو
 *     أُسقِطَ الأوّلُ سهواً لَمنعَ الثاني الأثرَ من الثباتِ.
 *   - **التسويةُ لا تستطيعُ أن تُخرِجَ أخضرَ زائفاً.** حالةُ `RECONCILED` **غيرُ
 *     قابلةٍ للبناءِ** إلّا بإشهادِ مصدرٍ حقيقيٍّ في CORE؛ وما دامَ `DEP-CORE-007`
 *     مفتوحاً فلا مصدرَ، والحالةُ الوحيدةُ المُشتَقَّةُ `UNVERIFIABLE` — لا
 *     `RECONCILED` ولا حتّى `DIVERGED`، لأنَّ «مختلفٌ» ادّعاءُ معرفةٍ بالطرفِ
 *     الآخرِ، ونحنُ لا نعرفُه.
 *
 * الحالة: منفّذ فعلياً — `W-8`، ومحروسٌ بـ`scripts/check-migration-dry-run.ts`،
 *   وثابتُ القراءةِ-فقط مَقيسٌ على PostgreSQL حقيقيٍّ في
 *   `tests/integration/migration-dry-run-read-only.test.ts`.
 * ينتمي إلى: scripts/lib
 * يُتوقع أن يستخدمه لاحقاً: `scripts/wasla-migration-dry-run.ts` والحارسُ
 *   والاختباراتُ، وكلُّ موجةٍ تُنفَّذُ لاحقاً في `W-3` و`W-7` و`W-9`.
 * ملاحظات مستقبلية: عندَ إغلاقِ `DEP-CORE-007` يُمرَّرُ قارئُ CORE حقيقيٌّ إلى
 *   `deriveReconciliation` معَ إشهادٍ، فتصيرُ `RECONCILED`/`DIVERGED` قابلتَينِ
 *   للبناءِ بلا تعديلِ حرفٍ في منطقِ الاشتقاقِ.
 */

import { type Blocker, blockerStatus, UnknownBlockerError } from "./wasla-blockers.ts";
import { WASLA_MIGRATION_MATRIX, WAVES } from "./wasla-migration-matrix.ts";

/** رمزُ خطأِ PostgreSQL لمحاولةِ كتابةٍ داخلَ مُعاملةٍ للقراءةِ فقط. */
export const READ_ONLY_SQLSTATE = "25006";

/**
 * الجُملُ المسموحةُ للتشغيلِ الجافِّ. **قائمةٌ مغلقةٌ لا نمطُ منعٍ**: قائمةُ منعٍ
 * تُخفِقُ صامتةً حينَ يُخترَعُ فعلُ كتابةٍ لم يُدرَجْ، والمغلقةُ تُخفِقُ عاليةً حينَ
 * يُحتاجُ فعلٌ لم يُعلَنْ. وذاكَ الإخفاقُ هوَ المطلوبُ.
 */
export const DRY_RUN_ALLOWED_VERBS = ["SELECT", "WITH", "BEGIN", "ROLLBACK", "SET"] as const;

/**
 * أفعالُ الكتابةِ التي يُحرَّمُ ظهورُها في وحدةِ التشغيلِ الجافِّ. **وهذه ليستْ
 * الإنفاذَ** — الإنفاذُ هوَ `READ ONLY` في المحرِّكِ. وهذه شبكةٌ ثانيةٌ تُخفِقُ في
 * `verify` قبلَ أن يُصلَ الأمرُ قاعدةً، فيُقرأُ العطبُ في مراجعةٍ لا في تشغيلٍ.
 */
export const FORBIDDEN_WRITE_VERBS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "ALTER",
  "DROP",
  "CREATE",
  "COPY",
  "GRANT",
  "REVOKE",
  "COMMIT",
  "VACUUM",
  "REINDEX",
  "REFRESH",
] as const;

/**
 * ما يُقاسُ في جدولٍ واحدٍ قياساً للقراءةِ فقط. **ولا حقلَ ههنا يُكرِّرُ
 * المصفوفةَ**: الآليّةُ والموجةُ والوجهةُ تُقرأُ من `WASLA_MIGRATION_MATRIX`.
 */
export interface ProbeDefinition {
  readonly table: string;
  /**
   * أعمدةُ التجميعِ التي تُقرأُ. **والعمودُ ههنا يُقاسُ لأنَّه يُهاجَرُ**، لا لأنَّه
   * موجودٌ: عمودٌ لا تلمسُه الموجةُ لا يُدرَجُ، فالتشغيلُ الجافُّ يقيسُ الخطّةَ لا
   * الجدولَ.
   */
  readonly groupBy: readonly string[];
  /**
   * سببُ القياسِ بعبارةِ الهجرةِ. **يُقرأُ في التقريرِ**: تقريرٌ يقولُ «١٤٢ صفّاً»
   * بلا سببٍ لا يُراجَعُ.
   */
  readonly measures: string;
}

/**
 * المسابرُ. **ونطاقُها نطاقُ البندِ لا أوسعُ**: `W-8` أداةٌ لهجرتَي **المهمّةِ
 * والهويّةِ**، فالمسابرُ للموجةِ ١ (الهويّةُ) وللموجةِ ٦ ومخطَّطِ `W-4`/`W-5`
 * (المهمّةُ). ولا مِسبارَ لموجةٍ أخرى: أداةٌ تُقيسُ ما لم يُحجَزْ تُقرَأُ إنجازاً
 * لبندٍ آخرَ لم يُنفَّذْ. والحارسُ يُثبِتُ الطرفَينِ: لا جدولَ في الموجتَينِ بلا
 * مِسبارٍ، ولا مِسبارَ خارجَهما.
 */
export const DRY_RUN_PROBES: readonly ProbeDefinition[] = [
  {
    table: "users",
    groupBy: ["city_id", "role"],
    measures:
      "عددُ المستخدمينَ الذينَ يصيرونَ مبادئَ (principals) في CORE في الموجةِ ١، موزَّعاً على المدينةِ **والدورِ**. والدورُ لازمٌ: `B-2` سؤالُها كم هويّةً مكرَّرةً، والتكرارُ يقعُ حينَ يحملُ رقمٌ واحدٌ دورَينِ — وتقريرٌ يجمعُ الأدوارَ رقماً واحداً يُخفي السؤالَ نفسَه.",
  },
  {
    table: "riders",
    groupBy: ["city_id"],
    measures:
      "عددُ صفوفِ الراكبِ التي تُشطَرُ في الموجةِ ١ (`SPLIT_TABLE`)، موزَّعاً على المدنِ. ويُقاسُ معَ `users` في تشغيلٍ واحدٍ لأنَّ الشطرَ يُنسِبُ الصفَّ إلى مبدأٍ في CORE ويُبقي المحليَّ ههنا، فالعددانِ يُطابَقانِ.",
  },
  {
    table: "admin_sessions",
    groupBy: ["city_id"],
    measures:
      "عددُ جلساتِ المسؤولِ القائمةِ عندَ لحظةِ التحوُّلِ في الموجةِ ١ (`READ_THROUGH_CORE`). وهذا العددُ هوَ حجمُ ما يُبطَلُ في التحوُّلِ (`W-9`)، ولا يُقدَّرُ تخميناً: جلسةٌ تُبطَلُ بلا عَدٍّ سابقٍ تعني مسؤولاً يخرجُ من اللوحةِ وسطَ التحوُّلِ بلا أن يُتوقَّعَ ذلكَ.",
  },
  {
    table: "admin_login_codes",
    groupBy: ["city_id"],
    measures:
      "عددُ رموزِ الدخولِ الحيّةِ في الموجةِ ١ (`READ_THROUGH_CORE`)، موزَّعاً على المدنِ. ويُقاسُ لأنَّ رمزاً حيّاً لحظةَ التحوُّلِ يصيرُ رمزاً لا يُصدِّقُه أحدٌ: أُصدِرَ ههنا ويُتحقَّقُ منه هنالكَ.",
  },
  {
    table: "orders",
    groupBy: ["city_id", "status"],
    measures:
      "عددُ الطلباتِ التي تُشطَرُ إلى `operational_jobs` في الموجةِ ٦، موزَّعاً على المدينةِ **والحالةِ**. والحالةُ لازمةٌ: طلبٌ جارٍ يُشطَرُ وسطَ تنفيذِه غيرُ طلبٍ منتهٍ، وتقريرٌ يجمعُهما رقماً واحداً يُخفي المخاطرةَ كلَّها.",
  },
  {
    table: "operational_jobs",
    groupBy: ["state"],
    measures:
      "عددُ المهمّاتِ التشغيليّةِ القائمةِ في مخطَّطِ `W-4`/`W-5`، موزَّعاً على الطورِ. **ولا `city_id` في هذا الجدولِ** فلا تجزئةَ مدينيّةً، وذاكَ عينُ `O-1` (`DEP-CORE-006`): التجميعُ يُعلَنُ بالطورِ وحدَه لا يُلفَّقُ بمدينةٍ لا تُوجَدُ في الصفِّ.",
  },
];

/** الموجاتُ التي يحجزُها هذا البندُ. **معلَنةٌ كي يُقاسَ الطرفانِ لا طرفٌ.** */
export const DRY_RUN_RESERVED_WAVES = [1, 6] as const;

/**
 * جداولُ مخطَّطِ المهمّةِ التي **ليست** في المصفوفةِ لأنَّها لم تكنْ موجودةً حينَ
 * كُتِبَت (`W-4`/`W-5` أنشأتْها). مُعلَنةٌ صراحةً كي لا يُقرأَ وجودُ مِسبارٍ لها
 * انحرافاً عن المصفوفةِ، ولا يُقرأَ غيابُها عن المصفوفةِ إذناً بإضافةِ ما يُشاءُ.
 */
export const DRY_RUN_POST_MATRIX_TABLES = ["operational_jobs"] as const;

/** مفرداتُ حالةِ التسويةِ. **مغلقةٌ**، ولا حالةَ سادسةَ تُخترَعُ في موقعِ النداءِ. */
export type ReconciliationStatus = "RECONCILED" | "DIVERGED" | "UNVERIFIABLE";

/**
 * وَسمُ الإشهادِ. **رمزٌ خاصٌّ بهذا الملفِّ لا يُصدَّرُ**، فلا ملفَّ آخرَ يستطيعُ
 * تسميةَ الحقلِ ولا بناءَ الكائنِ — والاستحالةُ بِنيويّةٌ لا اتّفاقيّةٌ.
 */
const CORE_ATTESTATION_BRAND: unique symbol = Symbol("wasla.core-attestation");

/**
 * إشهادُ مصدرِ CORE. **بناؤُه هوَ الشرطُ**: لا حقلٌ منطقيٌّ يُرفَعُ، بل مصدرٌ
 * يُسمّى ويُشهَدُ عليه. وما دامَ `DEP-CORE-007` مفتوحاً فلا أحدَ يستطيعُ بناءَه
 * صادقاً، فلا `RECONCILED`.
 *
 * **والزيادةُ الثانيةُ أغلقَت ثقباً مَقيساً في هذا النصِّ عينِه**: كانَ الإشهادُ
 * واجهةَ ثلاثِ سلاسلَ، فأيُّ مُنادٍ — نصٌّ أو اختبارٌ أو مُهيِّئٌ لاحقٌ — يكتبُ
 * ثلاثَ كلماتٍ فيحصلُ على `RECONCILED` و`DEP-CORE-007` مفتوحٌ. فصارَ **موسوماً
 * برمزٍ لا يُصدَّرُ**، ومُصدِرُه الوحيدُ `issueCoreAttestation` يقرأُ حالةَ
 * التبعيّةِ من `ROADMAP.md` ويرفضُ ما دامَت مفتوحةً. فالرفضُ آلةٌ لا انتباهٌ.
 */
export interface CoreAttestation {
  /** كيفَ قُرِئَ طرفُ CORE فعلاً، بعبارةٍ تُراجَعُ. */
  readonly readVia: string;
  /** التبعيّةُ التي كانَ لا بدَّ من إغلاقِها قبلَ القراءةِ، وقد أُغلِقَت. */
  readonly closedDependency: string;
  /** القِطعةُ أو الجولةُ التي قُرِئَ فيها الطرفانِ في اللحظةِ عينِها. */
  readonly measuredAt: string;
  /** الوَسمُ. لا يُكتَبُ يداً: مِفتاحُه رمزٌ غيرُ مُصدَّرٍ. */
  readonly [CORE_ATTESTATION_BRAND]: true;
}

/** ما يُطلَبُ به الإشهادُ. سلاسلُ فقط، ولا وَسمَ فيها. */
export interface AttestationRequest {
  readonly readVia: string;
  readonly closedDependency: string;
  readonly measuredAt: string;
}

/** رفضُ إصدارٍ، بسببٍ مقروءٍ. **ولا يُلَقَّبُ خطأً عابراً**: هوَ الحكمُ. */
export interface AttestationRefused {
  readonly refused: true;
  readonly reason: string;
}

/** هل النتيجةُ رفضٌ؟ حارسُ نوعٍ كي لا يُقرأَ الرفضُ إشهاداً. */
export function isAttestationRefused(
  result: CoreAttestation | AttestationRefused,
): result is AttestationRefused {
  return (result as AttestationRefused).refused === true;
}

/**
 * عباراتُ الحشوِ التي تُرفَضُ في وصفِ القراءةِ. **قائمةٌ مغلقةٌ صغيرةٌ**: الغرضُ
 * منعُ إشهادٍ يقولُ «TODO» أو «مجهولٌ» لا تصفيةُ اللغةِ.
 */
const PLACEHOLDER_PATTERN = /\b(?:TODO|TBD|FIXME|N\/?A|unknown|placeholder)\b|مجهول|لاحقاً/i;

/**
 * **المُصدِرُ الوحيدُ للإشهادِ.** يقرأُ حالةَ التبعيّةِ المُعلَنةِ من سجلِّ الحواجزِ
 * — وهوَ نفسُه مقروءٌ من `ROADMAP.md` لا مكتوبٌ ههنا — ويرفضُ:
 *
 *   ١. تبعيّةً **مفتوحةً**: هذا هوَ الحاجزُ. ما دامَ `DEP-CORE-007` مفتوحاً فلا
 *      إشهادَ، فلا `RECONCILED` — **بالإنشاءِ لا بالمراجعةِ**.
 *   ٢. معرّفاً **غيرَ مُعلَنٍ**: `blockerStatus` ترمي، ويُترجَمُ الرميُ إلى رفضٍ.
 *      فمعرّفٌ مُختلَقٌ لا يُقرأُ إغلاقاً.
 *   ٣. وصفَ قراءةٍ أو لحظةَ قياسٍ **فارغةً أو حشواً**: إشهادٌ يقولُ «TODO» ليسَ
 *      إشهاداً، وإشهادٌ بلا لحظةٍ مُعيَّنةٍ لا يُراجَعُ.
 *
 * ولا يُصدَّرُ منهُ سبيلٌ ثانٍ: لا `unsafeAttestation` ولا مُعامِلُ تجاوزٍ. من
 * أرادَ إشهاداً فليُغلِقِ التبعيّةَ في الخارطةِ.
 */
export function issueCoreAttestation(
  request: AttestationRequest,
  blockers: readonly Blocker[],
): CoreAttestation | AttestationRefused {
  let status: string;
  try {
    status = blockerStatus(request.closedDependency, blockers);
  } catch (error) {
    if (error instanceof UnknownBlockerError) {
      return {
        refused: true,
        reason: `الإشهادُ يدّعي إغلاقَ \`${request.closedDependency}\` وهوَ معرّفٌ غيرُ مُعلَنٍ في ROADMAP.md، فلا إغلاقَ يُقرأُ منه.`,
      };
    }
    throw error;
  }
  if (status === "OPEN") {
    return {
      refused: true,
      reason: `التبعيّةُ \`${request.closedDependency}\` مُعلَنةٌ **مفتوحةً** في ROADMAP.md، فلا طرفَ CORE يُقرأُ ولا إشهادَ يُصدَرُ ولا تسويةَ تُقالُ.`,
    };
  }
  for (const [field, value] of [
    ["readVia", request.readVia],
    ["measuredAt", request.measuredAt],
  ] as const) {
    if (value.trim().length < 3 || PLACEHOLDER_PATTERN.test(value)) {
      return {
        refused: true,
        reason: `الحقلُ \`${field}\` فارغٌ أو حشوٌ (\`${value}\`)، وإشهادٌ لا يُراجَعُ ليسَ إشهاداً.`,
      };
    }
  }
  return {
    readVia: request.readVia,
    closedDependency: request.closedDependency,
    measuredAt: request.measuredAt,
    [CORE_ATTESTATION_BRAND]: true,
  };
}

/**
 * هل الإشهادُ مُصدَرٌ من المُصدِرِ الوحيدِ؟ **شبكةٌ ثانيةٌ وقتَ التشغيلِ**: النوعُ
 * يمنعُ البناءَ في المراجعةِ، وهذا يمنعُ ما يُمرَّرُ بعدَ `as` أو من JavaScript
 * بلا أنواعٍ. وذانِ سبيلانِ مستقلّانِ لا سبيلٌ واحدٌ.
 */
export function isIssuedAttestation(value: unknown): value is CoreAttestation {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[CORE_ATTESTATION_BRAND] === true
  );
}

/** طرفُ MOVE من التسويةِ: ما قاسَه التشغيلُ الجافُّ. */
export interface MoveSide {
  readonly table: string;
  readonly rows: number;
}

/** طرفُ CORE من التسويةِ. `undefined` تعني **لا قراءةَ**، لا «صفراً». */
export interface CoreSide {
  readonly table: string;
  readonly rows: number;
  readonly attestation: CoreAttestation;
}

export interface ReconciliationRecord {
  readonly table: string;
  readonly status: ReconciliationStatus;
  readonly moveRows: number;
  /** `undefined` حينَ لا قراءةَ. **ولا يُستبدَلُ بصفرٍ**: صفرٌ ادّعاءُ قياسٍ. */
  readonly coreRows?: number;
  /** لماذا هذه الحالةُ لا غيرُها، بعبارةٍ تُراجَعُ. */
  readonly reason: string;
}

/**
 * يشتقُّ حالةَ التسويةِ. **وهذا هوَ الحاجزُ لا الوثيقةُ**: لا سبيلَ إلى
 * `RECONCILED` بلا `CoreSide` مُشهَدٍ عليه، ولا سبيلَ إلى `DIVERGED` كذلكَ —
 * فالاختلافُ ادّعاءُ معرفةٍ بالطرفِ الآخرِ.
 */
export function deriveReconciliation(
  move: MoveSide,
  core: CoreSide | undefined,
): ReconciliationRecord {
  if (core === undefined) {
    return {
      table: move.table,
      status: "UNVERIFIABLE",
      moveRows: move.rows,
      reason:
        "لا مصدرَ حقيقيٌّ في CORE يُقرأُ منه الطرفُ الآخرُ (`DEP-CORE-007` مفتوحٌ). ولا يُقالُ «مُسوّىً» ولا «مختلفٌ»: كلاهما ادّعاءُ معرفةٍ بما لم يُقرأْ.",
    };
  }
  if (!isIssuedAttestation(core.attestation)) {
    return {
      table: move.table,
      status: "UNVERIFIABLE",
      moveRows: move.rows,
      reason:
        "الإشهادُ المُمرَّرُ ليسَ مُصدَراً من `issueCoreAttestation`، فهوَ كائنٌ كُتِبَ يداً لا قراءةٌ حدثَت. ولا يُقالُ «مُسوّىً» على إشهادٍ ملفَّقٍ.",
    };
  }
  if (core.table !== move.table) {
    return {
      table: move.table,
      status: "UNVERIFIABLE",
      moveRows: move.rows,
      reason: `طرفُ CORE المُمرَّرُ يقيسُ \`${core.table}\` لا \`${move.table}\`، فالمقارنةُ بينَ شيئَينِ مختلفَينِ.`,
    };
  }
  if (core.rows === move.rows) {
    return {
      table: move.table,
      status: "RECONCILED",
      moveRows: move.rows,
      coreRows: core.rows,
      reason: `الطرفانِ قُرِئا معاً عندَ \`${core.attestation.measuredAt}\` عبرَ ${core.attestation.readVia} بعدَ إغلاقِ ${core.attestation.closedDependency}، وتطابقَ العددُ.`,
    };
  }
  return {
    table: move.table,
    status: "DIVERGED",
    moveRows: move.rows,
    coreRows: core.rows,
    reason: `الطرفانِ قُرِئا معاً عندَ \`${core.attestation.measuredAt}\` عبرَ ${core.attestation.readVia}، فاختلفَ العددُ بفرقِ ${Math.abs(core.rows - move.rows)} صفّاً.`,
  };
}

/** مِسبارٌ بجدولِه. */
export function probeByTable(): Map<string, ProbeDefinition> {
  return new Map(DRY_RUN_PROBES.map((probe) => [probe.table, probe]));
}

/** الموجاتُ التي تلمسُ صفّاً فعلاً، مُشتَقّةً من المصفوفةِ لا مكتوبةً ههنا. */
export function wavesThatTouchRows(): readonly number[] {
  const touching = new Set<number>();
  for (const entry of WASLA_MIGRATION_MATRIX) {
    if (entry.mechanism !== "NONE") touching.add(entry.wave);
  }
  return [...touching].sort((a, b) => a - b);
}

/** مسابرُ موجةٍ واحدةٍ، مُشتَقّةٌ من المصفوفةِ. */
export function probesForWave(wave: number): readonly ProbeDefinition[] {
  const tables = new Set(
    WASLA_MIGRATION_MATRIX.filter((entry) => entry.wave === wave).map((entry) => entry.table),
  );
  return DRY_RUN_PROBES.filter((probe) => tables.has(probe.table));
}

/** شرطُ الدخولِ المُعلَنُ لموجةٍ، مقروءاً من المصفوفةِ لا مُعاداً كتابتُه. */
export function entryConditionOf(wave: number): string | undefined {
  return WAVES.find((definition) => definition.wave === wave)?.entryCondition;
}

/**
 * يبني جملةَ القياسِ. **`SELECT` وحدَها لا غيرُ**، والأعمدةُ تُقتَبَسُ بمُعرِّفٍ
 * مزدوجٍ لأنَّها تأتي من سجلٍّ مُعلَنٍ محروسٍ لا من مُدخلِ مستخدمٍ.
 */
export function buildProbeStatement(probe: ProbeDefinition): string {
  const columns = probe.groupBy.map((column) => `"${column}"`).join(", ");
  return `SELECT ${columns}, count(*)::bigint AS rows FROM "${probe.table}" GROUP BY ${columns} ORDER BY ${columns}`;
}

/**
 * أعمدةُ جدولٍ كما هي في المخطَّطِ فعلاً، مُستخرَجةً من نصِّ الهجراتِ. **دالّةٌ
 * نقيّةٌ تأخذُ النصَّ** كي يُختبَرَ عليها بمخطَّطٍ مُفسَدٍ بلا قاعدةٍ ولا ملفٍّ.
 *
 * وهذا هوَ ما يجعلُ خطّةَ التشغيلِ الجافِّ **قابلةً للتشغيلِ**: مِسبارٌ يُجمِّعُ
 * بعمودٍ لا وجودَ لهُ خطّةٌ تُخفِقُ لحظةَ التحوُّلِ لا لحظةَ المراجعةِ — وذاكَ
 * أسوأُ وقتٍ يُكتشَفُ فيهِ.
 */
export function columnsFromSchema(sqlText: string): Map<string, ReadonlySet<string>> {
  const tables = new Map<string, ReadonlySet<string>>();
  const pattern = /create\s+table\s+if\s+not\s+exists\s+(\w+)\s*\(([\s\S]*?)\n\s*\);/gi;
  for (const match of sqlText.matchAll(pattern)) {
    const table = match[1];
    const body = match[2];
    if (table === undefined || body === undefined) continue;
    const columns = new Set(tables.get(table) ?? []);
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      if (line === "" || line.startsWith("--")) continue;
      const lowered = line.toLowerCase();
      if (
        lowered.startsWith("constraint") ||
        lowered.startsWith("primary key") ||
        lowered.startsWith("unique") ||
        lowered.startsWith("check") ||
        lowered.startsWith("foreign key") ||
        lowered.startsWith("exclude")
      ) {
        continue;
      }
      const name = line.split(/[\s(,]/)[0];
      if (name !== undefined && /^[a-z_][a-z0-9_]*$/.test(name)) columns.add(name);
    }
    tables.set(table, columns);
  }
  return tables;
}

/**
 * جملةُ فتحِ المُعاملةِ. **هذا هوَ الإنفاذُ**: `READ ONLY` تجعلُ المحرِّكَ نفسَه
 * يردُّ أيَّ كتابةٍ بـ`25006`، فالسلامةُ خاصّةُ الجلسةِ لا انتباهُ الكاتبِ.
 * و`statement_timeout` تمنعُ مِسباراً على جدولٍ ضخمٍ من قفلِ الإنتاجِ.
 */
export const DRY_RUN_BEGIN = "BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ";

/** حدُّ زمنِ الجملةِ الواحدةِ بالملّي ثانيةِ. */
export const DRY_RUN_STATEMENT_TIMEOUT_MS = 30_000;
