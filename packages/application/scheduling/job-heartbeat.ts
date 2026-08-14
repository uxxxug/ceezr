/**
 * الغرض: نبضةُ المهامّ الدورية — منفذُ الكتابة، منفذُ القراءة، والحكمُ الخالص الذي
 *   يترجم النبضات إلى «عاملٌ سليم / متدهوّر / معطَّل» ليقرأه `/ready`.
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14 (§4.3 من أمر الإطلاق التجاري).
 * ينتمي إلى: application/scheduling
 * يُستخدم في: apps/workers/src/runner.ts (الكتابة)، apps/gateway/src/index.ts (الفحص)
 * الجدول والدالّة: supabase/migrations/20260814130000_job_heartbeats.sql
 *
 * ## لماذا الحكمُ دالّةٌ خالصة هنا لا شرطٌ داخل مسار `/ready`
 *
 * لأنّه الجزءُ الذي يُخطئ فعلاً: «متى تُعدّ المهمّة بائتة» و«متى يكون غيابُها
 * إخفاقاً لا إقلاعاً» حكمان زمنيّان، واختبارُهما داخل مسار HTTP يحتاج قاعدةً
 * وخادماً وساعةً حقيقية — أي اختباراً لا يُكتب. هنا يُختبَران بأرقامٍ صريحة.
 */

import type { CityId } from "../../shared/kernel/index.ts";

export type JobHeartbeatStatus = "ok" | "failed" | "skipped";

export interface JobHeartbeatRecord {
  readonly jobName: string;
  readonly cityId: CityId | null;
  readonly status: JobHeartbeatStatus;
  readonly detail: string | null;
}

/**
 * منفذُ الكتابة. **لا يرمي ولا يعيد نتيجة**: النبضةُ رصدٌ لا عمل، وفشلُ كتابتها
 * لا يجوز أن يُحوّل مهمّةً ناجحة إلى فاشلة في السجلّ ولا أن يُسقط الشوط.
 */
export interface JobHeartbeatRecorderPort {
  record(input: JobHeartbeatRecord): Promise<void>;
}

export interface JobHeartbeatRow {
  readonly jobName: string;
  /**
   * لا يُعدَم أبداً (القاعدة 0.4): المهمّةُ العامّة تُسجّل صفّاً لكلّ مدينة مفعّلة
   * تخدمها، فترد باسمِها نفسه في عدّة صفوف — والحكمُ يأخذ أحدثَها.
   */
  readonly cityId: CityId;
  readonly lastRunAt: Date;
  readonly lastStatus: JobHeartbeatStatus;
  readonly detail: string | null;
}

export interface JobHeartbeatReaderPort {
  /** كلُّ النبضات. عشراتُ صفوف لا آلاف — فلا ترقيمَ ولا ترشيح. */
  list(): Promise<readonly JobHeartbeatRow[]>;
}

/** مهمّةٌ حرجة يُنتظر منها نبضة، بتواترها المتوقَّع بالثواني. */
export interface CriticalJobExpectation {
  readonly jobName: string;
  readonly everySeconds: number;
}

export interface JobHealthInput {
  readonly expectations: readonly CriticalJobExpectation[];
  /**
   * مهامٌّ يُراقَب بياتُها ولا يُحاسَب غيابُها: المهمّةُ المشروطة باعتمادٍ خارجي (النسخُ
   * الاحتياطي بلا اعتمادات Google Drive) لا تُسجَّل أصلاً في بيئةٍ لا تملكه، وعدّ
   * غيابها إخفاقاً كان سيُسقط `/ready` في كلّ بيئةٍ ناقصةِ الاعتماد — أي إنذارٌ دائم
   * لا يُقرأ، وهو أسوأ من غياب الإنذار. فإن نبضت مرّةً صار بياتُها بعدها تدهوّراً.
   */
  readonly optionalExpectations?: readonly CriticalJobExpectation[];
  readonly heartbeats: readonly JobHeartbeatRow[];
  readonly now: Date;
  /** لحظةُ إقلاع العملية — أساسُ نافذة الإمهال. */
  readonly startedAt: Date;
}

export interface JobHealthReport {
  /**
   * `failed`: مهمّةٌ حرجة لا نبضةَ لها بعد انقضاء إمهالها — العاملُ لم يعمل أصلاً.
   * `degraded`: نبضةٌ موجودة لكنّها بائتة أو آخرُ حالتها فشل — يعمل ناقصاً.
   */
  readonly status: "ok" | "degraded" | "failed";
  /** حرجةٌ غائبة بعد الإمهال. */
  readonly missing: readonly string[];
  /** موجودةٌ لكن آخرُ نبضةٍ أقدمُ من ضِعف تواترها. */
  readonly stale: readonly string[];
  /** نبضت لكنّ آخرَ شوطٍ أخفق. */
  readonly failing: readonly string[];
  /** غائبةٌ وما زالت في نافذة الإمهال — ليست عطلاً ولا تُذاع كإخفاق. */
  readonly warming: readonly string[];
}

/**
 * أدنى نافذةِ إمهال. مهمّةٌ تواترها ٢٠ ثانية إمهالُها ٤٠ ثانية حسابياً، وهذا أقصرُ
 * من زمن إقلاعٍ عادي على Render (سحبُ صورة، اتصالُ قاعدة، بناءُ حاوية التبعيات).
 * وبلا هذا الحدّ كانت البوابةُ تُعلن `not_ready` في أوّل ثوانيها فيوقف Render
 * توجيهَ الحركة ويعيد التشغيل — دورةُ إعادةِ تشغيلٍ سببُها الفحصُ نفسه لا عطل.
 */
export const MIN_HEARTBEAT_GRACE_MS = 180_000;

/** معامل البيات: ضِعفُ التواتر المتوقَّع — شوطٌ فائتٌ واحد يُغتفَر، واثنان لا. */
const STALENESS_FACTOR = 2;

function thresholdMs(everySeconds: number): number {
  return Math.max(everySeconds * STALENESS_FACTOR * 1000, MIN_HEARTBEAT_GRACE_MS);
}

/**
 * الحكم. لا قاعدةَ ولا شبكة: صفوفٌ ولحظتان تدخلان، وتقريرٌ يخرج.
 *
 * الغيابُ داخل الإمهال ليس إخفاقاً — وهذا أهمّ سطرٍ في الملف: بلا هذه التفرقة كان
 * كلُّ نشرٍ جديد يبدأ بـ`not_ready` لأنّ المهامّ لم تُشغَّل بعد، ثم يُقتل قبل أن
 * تُشغَّل — عطلٌ يخلقه الفحص. والإمهالُ يُقاس من إقلاع العملية لا من الآن، وإلّا
 * لكان متجدّداً بلا نهاية فلا يُكشف غيابٌ أبداً.
 */
export function evaluateJobHealth(input: JobHealthInput): JobHealthReport {
  /**
   * أحدثُ نبضةٍ لكلّ اسم لا أوّلُ ما ورد: المهمّةُ العامّة ترد بصفٍّ لكلّ مدينة، ومدينةٌ
   * فُعّلت بعد آخر شوط تحمل صفّاً أقدم — وأخذُ الأقدم كان سيعلن بياتاً لا وجودَ له.
   * وأماّ تدهوّرُ مدينةٍ واحدة في مهمّةٍ مدنيّة فلا يُستر: اسمُ المهمّة المدنيّة يحمل
   * معرّفَ مدينتها، فلكلّ مدينةٍ توقّعٌ منفصل واسمٌ منفصل.
   */
  const byName = new Map<string, JobHeartbeatRow>();
  for (const row of input.heartbeats) {
    const seen = byName.get(row.jobName);
    if (seen === undefined || row.lastRunAt.getTime() > seen.lastRunAt.getTime()) {
      byName.set(row.jobName, row);
    }
  }
  const nowMs = input.now.getTime();
  const upMs = nowMs - input.startedAt.getTime();

  const missing: string[] = [];
  const stale: string[] = [];
  const failing: string[] = [];
  const warming: string[] = [];

  for (const expectation of input.expectations) {
    const limit = thresholdMs(expectation.everySeconds);
    const row = byName.get(expectation.jobName);

    if (row === undefined) {
      if (upMs <= limit) warming.push(expectation.jobName);
      else missing.push(expectation.jobName);
      continue;
    }

    if (nowMs - row.lastRunAt.getTime() > limit) {
      stale.push(expectation.jobName);
      continue;
    }

    // `skipped` ليست إخفاقاً: نسخةٌ أخرى حملت الشوط بالقفل الموزَّع، والنبضةُ
    // حديثةٌ فالمهمّة تعمل — في مكانٍ آخر من نفس النظام.
    if (row.lastStatus === "failed") failing.push(expectation.jobName);
  }

  for (const expectation of input.optionalExpectations ?? []) {
    const row = byName.get(expectation.jobName);
    if (row === undefined) continue;
    if (nowMs - row.lastRunAt.getTime() > thresholdMs(expectation.everySeconds)) {
      stale.push(expectation.jobName);
    } else if (row.lastStatus === "failed") {
      failing.push(expectation.jobName);
    }
  }

  const status =
    missing.length > 0 ? "failed" : stale.length > 0 || failing.length > 0 ? "degraded" : "ok";

  return { status, missing, stale, failing, warming };
}

/** نصٌّ واحد يسمّي العطل باسمه — يُقرأ في `/ready` ليلاً بلا فتح القاعدة. */
export function describeJobHealth(report: JobHealthReport): string {
  const parts: string[] = [];
  if (report.missing.length > 0) parts.push(`لا نبضة لها: ${report.missing.join(", ")}`);
  if (report.stale.length > 0) parts.push(`نبضتها بائتة: ${report.stale.join(", ")}`);
  if (report.failing.length > 0) parts.push(`آخر شوط أخفق: ${report.failing.join(", ")}`);
  if (report.warming.length > 0) parts.push(`قيد الإقلاع: ${report.warming.join(", ")}`);
  return parts.length === 0 ? "كل المهامّ الحرجة نبضت في وقتها" : parts.join(" | ");
}
