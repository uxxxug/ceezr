/**
 * الغرض: عقدُ **الحالةِ الساخنةِ المشتركةِ** لموقعِ السائقِ ومنطقُها النقيُّ — البند
 *    `F4-02` والعائقُ `CAP-009` («كتابةُ الموقعِ تصيبُ الجدولَ الرئيسيَّ بكثافةٍ»).
 *    ههنا ثلاثةُ أشياءَ لا رابعَ لها: منافذُ يُنفِّذُها المحوّلُ، وتفسيرُ أرقامِ
 *    الإعداداتِ، ودالّةُ اختيارِ الأحدثِ لكلِّ سائقٍ قبلَ الإفراغِ.
 * الحالة: منفّذ فعلياً — 2026-09-09 · البند `F4-02`.
 * ينتمي إلى: application/geo
 * يُستخدم من: `packages/application/geo/update-driver-location.ts`،
 *    `packages/application/geo/flush-driver-location-backlog.ts`،
 *    `packages/infrastructure/geo/redis-driver-location-hot-state.ts`
 * ملاحظات مستقبلية: قراءةُ الخريطةِ من الحالةِ الساخنةِ مباشرةً (بدلَ الجدولِ)
 *    ليست ههنا ولا تُدَّعى: هيَ بندٌ لاحقٌ يحتاجُ قارئاً ومقياسَ إخفاقٍ، وبناءُ
 *    منفذِ قراءةٍ لا يقرؤه أحدٌ اليومَ كودٌ ميّتٌ تنهى عنه القاعدةُ ٠.١.
 *
 * ## لماذا لا يُقرَّرُ ههنا شيءٌ عن Redis
 *
 * هذا الملفُّ لا يعرفُ Redis ولا SQL. وذلكَ ليسَ ترتيباً معماريّاً: منطقُ «أيُّ
 * إصلاحةٍ أحدثُ» يجبُ أن يُقرأَ ويُختبَرَ بلا شبكةٍ، وأن يكونَ **نصّاً واحداً**
 * يُنفِّذُه المخزنانِ معاً (Redis في السكربتِ، وPostgreSQL في `where` الدالّةِ
 * الذرّيّةِ). فالقاعدةُ مكتوبةٌ ههنا مرّةً بالعربيّةِ: **الأقدمُ لا يُزيحُ الأحدثَ،
 * والمتساويانِ يُقبَلانِ** — كما كانَ في `F4-01` حرفاً بحرفٍ.
 *
 * ## لماذا يُقبَلُ المتساويانِ
 *
 * لأنَّ حارسَ `F4-01` في القاعدةِ `last_location_recorded_at <= $at`، فنبضةٌ
 * بطابعٍ مساوٍ تُكتَبُ. ولو ضُيِّقَ ههنا إلى `<` لصارَ للنظامِ **حَكَمانِ
 * مختلفانِ** على الإصلاحةِ الواحدةِ: Redis يقولُ «قديمةٌ» والقاعدةُ تقولُ
 * «مقبولةٌ». وهوَ عينُ ما ينهى عنه `ADR 0053 §٦`، وثمنُه دُفِعَ في `BUG-001`.
 * فالتضييقُ ههنا قرارُ مالكٍ يُغيِّرُ المخزنَينِ معاً، لا تحسينٌ في محوّلٍ.
 */

import type { CityId, DriverId } from "../../shared/kernel/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { StoredLocationQuality } from "../bots/types.ts";
import type { PortFailureError } from "../ports/index.ts";

/** الأرقامُ الأربعةُ للمسارِ الساخنِ، مقروءةً من `platform_settings` لا مُخترَعةً. */
export interface HotLocationLimits {
  readonly hotTtlSeconds: number;
  readonly flushIntervalSeconds: number;
  readonly flushBatchSize: number;
  readonly backlogLimit: number;
}

/** إصلاحةٌ في الحالةِ الساخنةِ — الموضعُ والطابعُ والحكمُ معاً، لا موضعٌ عارٍ. */
export interface HotLocationFix {
  readonly cityId: CityId;
  readonly driverId: DriverId;
  readonly latitude: number;
  readonly longitude: number;
  readonly recordedAtMs: number;
  /**
   * `F4-05`: **زمنُ الخادمِ لحظةَ قبولِ الإصلاحةِ** — لا لحظةَ استمرارِها.
   *
   * والعمودُ `drivers.last_location_at` مُعلَنٌ في تعليقِه حرفاً: «زمنُ الخادمِ
   * لحظةَ قبولِ الإصلاحةِ — متى علمنا». ولمّا صارَ الاستمرارُ مجمَّعاً في `F4-02`
   * كتبَتْه الدالّةُ الذرّيّةُ `now()` **لحظةَ الإفراغِ**، فصارَ العمودُ يقولُ
   * «علمتُ الآنَ» عن إصلاحةٍ عُلِمَت قبلَ دورةِ إفراغٍ كاملةٍ. وذاكَ ليسَ تأخّراً
   * في العرضِ بل **مبالغةٌ في ادّعاءِ الحداثةِ**: صفحةُ `SS-06` تقولُ للمنتظِرِ
   * «آخرُ تحديثٍ: الآنَ» وهيَ لا تعلمُ ذلك، وحارسُ `driver_location_max_age_seconds`
   * يقيسُ عمراً أصغرَ من الحقيقةِ فيقبلُ ما كانَ يجبُ أن يرفضَه.
   *
   * فالطابعُ يُحمَلُ من لحظةِ القبولِ إلى الدفعةِ ولا يُختَرَعُ عندَ الكتابةِ. وهوَ
   * **زمنُ خادمٍ لا طابعُ جهازٍ**، فلا يُخرَقُ به قرارُ هجرةِ المرحلةِ الثامنةِ
   * (العمرُ يُقاسُ بزمنِنا لا بساعةِ السائقِ، فتلكَ مُدخَلٌ خارجيٌّ يُزوَّرُ).
   *
   * و`null` حالٌ انتقاليّةٌ واحدةٌ لا أكثرُ: إصلاحةٌ كُتِبَت ساخنةً **قبلَ** هذا
   * التغييرِ فلا تحملُ الحقلَ. ولا تُسقَطُ (إسقاطُها فقدُ موضعٍ)، ولا يُوضَعُ
   * مكانَها `recordedAtMs` (فذاكَ طابعُ الجهازِ في عمودِ زمنِ الخادمِ — كذبٌ من
   * نوعٍ آخرَ)، بل تُقرأُ في القاعدةِ «مجهولةَ لحظةِ القبولِ» فتأخذُ `now()` كما
   * كانَ الحالُ سابقاً. والنافذةُ بعمرِ الحالةِ الساخنةِ وحدَه (ثوانٍ)، وتُغلَقُ
   * بذاتِها بعدَ أوّلِ ذَواءٍ.
   */
  readonly observedAtMs: number | null;
  readonly accuracyMeters: number | null;
  readonly verdict: StoredLocationQuality["verdict"];
}

/**
 * الطابعُ المخزَّنُ في القاعدةِ كما قرأَه المُنادي في الصفِّ نفسِه. وهوَ **أرضيّةُ
 * الحكمِ** لا زينةٌ: مفتاحُ الحالةِ الساخنةِ يذوي بعمرِه، فلو حُكِمَ على الأحدثِ
 * بالحالةِ الساخنةِ وحدَها لَقبِلَ النظامُ إصلاحةً أقدمَ من صفِّه بعدَ كلِّ ذَواءٍ،
 * فأجابَ السائقَ «حُفِظَ» ورفضَتها القاعدةُ صامتةً. فالأرضيّةُ تُغلِقُ هذه الفجوةَ:
 * أقدمُ ما يُقبَلُ هوَ أحدثُ ما نعرفُه من المخزنَينِ معاً.
 */
export interface HotLocationRecordInput extends HotLocationFix {
  readonly previousRecordedAtMs: number | null;
}

/**
 * حكمُ الحالةِ الساخنةِ على الإصلاحةِ:
 * - `queued`: قُبِلَت وحُفِظَت ساخنةً وأُدرِجَت في قائمةِ الانتظارِ — الإفراغُ
 *   المجمَّعُ يتولّى القاعدةَ.
 * - `direct`: قُبِلَت وحُفِظَت ساخنةً و**لم تُدرَجْ**: التراكمُ بلغَ سقفَه. فعلى
 *   المُنادي أن يكتبَ في القاعدةِ مباشرةً — تأجيلٌ لا إسقاطٌ، والأثرُ تباطؤٌ لا فقدٌ.
 * - `stale`: أقدمُ من أحدثِ ما نعرفُه، فلا تُكتَبُ ولا تُبَثُّ.
 */
export type HotLocationRecordOutcome =
  | { readonly kind: "queued"; readonly backlog: number }
  | { readonly kind: "direct"; readonly backlog: number }
  | { readonly kind: "stale"; readonly newestKnownMs: number };

/** منفذُ الكتابةِ الساخنةِ كما تحتاجُه حالةُ الاستقبالِ وحدَها — لا إفراغَ فيه. */
export interface DriverLocationHotStateWriter {
  record(
    input: HotLocationRecordInput,
  ): Promise<Result<HotLocationRecordOutcome, PortFailureError>>;
}

/** منفذُ الإفراغِ كما تحتاجُه المهمّةُ الدوريّةُ وحدَها — لا كتابةَ ساخنةً فيه. */
export interface DriverLocationBacklogReader {
  /** يسحبُ حتّى `limit` سائقاً من قائمةِ الانتظارِ **ويُزيلُهم منها** معَ إصلاحاتِهم. */
  drain(
    cityId: CityId,
    limit: number,
  ): Promise<Result<readonly HotLocationFix[], PortFailureError>>;
  /** يُعيدُ ما لم يُكتَبْ إلى قائمةِ الانتظارِ — فشلُ الإفراغِ لا يُفقِدُ موضعاً. */
  requeue(fixes: readonly HotLocationFix[]): Promise<Result<void, PortFailureError>>;
}

/** حصيلةُ تطبيقِ دفعةٍ واحدةٍ في القاعدةِ، بأصنافِها الثلاثةِ لا بعددٍ واحدٍ. */
export interface DriverLocationBatchReport {
  /** صفوفٌ تغيَّرَت فعلاً. */
  readonly applied: number;
  /** صفوفٌ رفضَها حارسُ التسلسلِ في القاعدةِ لأنَّ فيها أحدثَ — حالةٌ سويّةٌ. */
  readonly stale: number;
  /** معرّفاتٌ لا صفَّ لها في هذه المدينةِ — سائقٌ حُذِفَ أو مدينةٌ خاطئةٌ. */
  readonly missing: number;
  /**
   * `F7-03`: صفوفُ الأثرِ المُلحَقةُ في `driver_location_history`.
   *
   * ينبغي أن يساويَ `applied` **دائماً**: الإلحاقُ فرعٌ من فرعِ الكتابةِ نفسِه في
   * الجملةِ نفسِها (ADR-0074). فاختلافُهما ليسَ حالاً سويّةً تُقرأُ بل عطلٌ في
   * الدالّةِ — ولذلكَ يُعَدُّ ويُسجَّلُ ولا يُفترَضُ.
   */
  readonly appended: number;
}

/** منفذُ الاستمرارِ المجمَّعِ: دالّةٌ ذرّيّةٌ واحدةٌ تأخذُ دفعةً لا صفّاً صفّاً. */
export interface DriverLocationBatchPersistence {
  persistBatch(
    cityId: CityId,
    fixes: readonly HotLocationFix[],
  ): Promise<Result<DriverLocationBatchReport, PortFailureError>>;
}

/** خرقُ إعدادٍ: مفاتيحُ غائبةٌ أو غيرُ موجبةٍ — يُقرأُ تعطيلاً للمسارِ الساخنِ. */
export interface HotLocationLimitsBreach {
  readonly code: "HOT_LOCATION_SETTINGS_INCOMPLETE";
  /** أسماءُ المفاتيحِ المعطوبةِ حرفاً — تُقرأُ في السجلِّ فتُصحَّحُ بلا تنقيبٍ. */
  readonly keys: readonly string[];
}

/** صفٌّ خامٌ من `platform_settings` كما يُقرأُ، بلا تفسيرٍ. */
export interface RawSettingValue {
  readonly key: string;
  readonly value: unknown;
}

/**
 * رقمٌ موجبٌ صحيحٌ أو `null`. ورقمٌ خُزِّنَ نصّاً (`'"5"'`) يُقرأُ `null` أي خرقاً:
 * القبولُ به يجعلُ نوعَ العمودِ زينةً، والرفضُ يُظهِرُ الخطأَ حيثُ يُصحَّحُ.
 */
function positiveIntegerOf(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const truncated = Math.trunc(value);
  return truncated > 0 ? truncated : null;
}

/**
 * تفسيرُ صفوفِ الإعداداتِ إلى الأرقامِ الأربعةِ. ولا افتراضَ في هذه الدالّةِ
 * إطلاقاً: مفتاحٌ ناقصٌ أو غيرُ موجبٍ يُرجَعُ خرقاً باسمِه، ومن قرأَ الخرقَ عطَّلَ
 * المسارَ الساخنَ ورجعَ إلى كتابةِ `F4-01` المباشرةِ.
 */
export function resolveHotLocationLimits(
  rows: readonly RawSettingValue[],
): Result<HotLocationLimits, HotLocationLimitsBreach> {
  const find = (key: string): number | null => {
    const row = rows.find((entry) => entry.key === key);
    return row === undefined ? null : positiveIntegerOf(row.value);
  };

  const hotTtlSeconds = find("driver_location_hot_ttl_seconds");
  const flushIntervalSeconds = find("driver_location_flush_interval_seconds");
  const flushBatchSize = find("driver_location_flush_batch_size");
  const backlogLimit = find("driver_location_backlog_limit");

  const missing: string[] = [];
  if (hotTtlSeconds === null) missing.push("driver_location_hot_ttl_seconds");
  if (flushIntervalSeconds === null) missing.push("driver_location_flush_interval_seconds");
  if (flushBatchSize === null) missing.push("driver_location_flush_batch_size");
  if (backlogLimit === null) missing.push("driver_location_backlog_limit");
  if (
    hotTtlSeconds === null ||
    flushIntervalSeconds === null ||
    flushBatchSize === null ||
    backlogLimit === null
  ) {
    return err({ code: "HOT_LOCATION_SETTINGS_INCOMPLETE", keys: missing });
  }

  return ok({ hotTtlSeconds, flushIntervalSeconds, flushBatchSize, backlogLimit });
}

/**
 * أحدثُ إصلاحةٍ لكلِّ سائقٍ من دفعةٍ مختلطةٍ. ولمَ تُحتاجُ وقائمةُ الانتظارِ عضوٌ
 * واحدٌ لكلِّ سائقٍ: الإفراغُ يُسحَبُ من نسخٍ متعدِّدةٍ، فقد تُسحَبُ إصلاحةُ سائقٍ
 * في شوطٍ ثمَّ تُعادُ إليه (`requeue`) بعدَ فشلٍ فتلتقي بأحدثَ منها في الشوطِ التالي.
 * والدفعةُ تُنقّى ههنا **قبلَ** القاعدةِ كي تكونَ الدفعةُ صفّاً لكلِّ سائقٍ حقّاً،
 * فلا يُعتمَدَ على ترتيبٍ داخلَ `update` واحدٍ — والترتيبُ داخلَ الدفعةِ لا يُضمَنُ.
 *
 * والمتساويانِ: يُبقى على **الأوّلِ** ورودَاً. ولا فرقَ في الأثرِ إذ الطابعُ واحدٌ،
 * والقاعدةُ تقبلُ المساويَ فالنتيجةُ نفسُها أيّاً اختِيرَ.
 */
export function newestPerDriver(fixes: readonly HotLocationFix[]): readonly HotLocationFix[] {
  const newest = new Map<DriverId, HotLocationFix>();
  for (const fix of fixes) {
    const seen = newest.get(fix.driverId);
    if (seen === undefined || fix.recordedAtMs > seen.recordedAtMs) newest.set(fix.driverId, fix);
  }
  return [...newest.values()];
}
