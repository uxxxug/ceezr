/**
 * الغرض: **قياسُ التدهورِ بعملٍ يفعلُه المحرِّكُ لا بزمنٍ تقرؤُه ساعةٌ** — عدّادانِ
 *   تراكميّانِ من `pg_stat_database` للقاعدةِ الجاريةِ: الصفوفُ الممسوحةُ
 *   (`tup_returned + tup_fetched`) والكُتَلُ الملموسةُ (`blks_read + blks_hit`).
 *
 *   والسببُ قرارُ `DEC-18`: كانَ حاجزُ الصمودِ (`tests/e2e/ride-soak.test.ts`)
 *   يوكِّدُ أنَّ **متوسِّطَ زمنِ** آخرِ خمسِ رحلاتٍ أقلُّ من ثلاثةِ أضعافِ متوسِّطِ
 *   أوّلِ خمسٍ. والغرضُ مشروعٌ — كشفُ نموٍّ خطّيٍّ أو أسوأَ (فهرسٌ مفقودٌ · تسريبُ
 *   حالةٍ · استعلامٌ يمسحُ جدولاً ينمو) — **لكنَّ المقياسَ كانَ خاطئاً**: زمنُ
 *   الساعةِ على مُنفِّذٍ مُشترَكٍ يقيسُ جارَكَ المُزدحِمَ لا شِفرتَكَ، فقرأَ ٣٫٢ على
 *   `60b1a94` ثمَّ مرَّ بإعادةِ التشغيلِ عينِها بالبصمةِ نفسِها. **فالعطبُ في
 *   وحدةِ القياسِ لا في العتبةِ**: رفعُها إسكاتٌ، وإعادةُ التشغيلِ حتّى يَخضَرَّ
 *   إفسادٌ لصدقِ الحكمِ.
 *
 *   والعملُ المقيسُ ههنا **لا يتأثَّرُ بازدحامِ المُعالِجِ ألبتّةَ**: صفٌّ يُمسَحُ
 *   يُعَدُّ صفّاً سواءٌ أكانَ المُنفِّذُ خالياً أم محمولاً عليه. فالنموُّ الذي
 *   يكشفُه هذا المقياسُ **نموُّ عملٍ حقيقيٍّ** — وهوَ بعينِه ما كانَ الحاجزُ
 *   الأصليُّ يبحثُ عنه.
 *
 * الحالة: أداةُ اختبارٍ منفّذةٌ فعلياً — تُقاسُ على PostgreSQL حقيقيّةٍ في CI.
 * ينتمي إلى: tests/support
 * يُستخدم من: tests/e2e/ride-soak.test.ts
 * يُتوقع أن يستخدمه لاحقاً: كلُّ حاجزِ صمودٍ يقيسُ تدهوراً على تكرارٍ.
 * الحاكم: docs/adr/0130-degradation-is-measured-in-work-not-in-clock-time.md · DEC-18
 *
 * ## لماذا انتظارُ سكونٍ قبلَ كلِّ قراءةٍ
 * عدّاداتُ `pg_stat_*` **لا تُكتَبُ لحظةَ العملِ**: كلُّ خادمٍ خلفيٍّ يُجمِّعُ
 * إحصاءَه ويُفرِغُه عندَ انتهاءِ معاملةٍ **بمهلةٍ دُنيا قدرُها ثانيةٌ**
 * (`PGSTAT_MIN_INTERVAL`)، ويُفرِغُه كذلكَ حينَ يَخمُلُ. فقراءةٌ تعقُبُ العملَ
 * مباشرةً تنسِبُ عملَ رحلةٍ إلى التي بعدَها، **فيُقاسُ حدُّ كتلةٍ لا عملُها**.
 * ولذلكَ تُقرأُ الحدودُ بعدَ **سكونٍ مقيسٍ**: قراءتانِ متتاليتانِ متطابقتانِ
 * يفصلُهما ربعُ ثانيةٍ. وهذا انتظارُ **تزامُنٍ** لا توكيدُ زمنٍ: لا يدخلُ حكماً،
 * ولا يُغيِّرُ نتيجةً، وأقصاهُ معلَنٌ فينقطعُ بخطأٍ مقروءٍ لا بصمتٍ.
 *
 * ## ولماذا لقطةُ الجلسةِ تُمسَحُ قبلَ كلِّ قراءةٍ
 * `stats_fetch_consistency` الافتراضيُّ `cache`: أوّلُ قراءةٍ في المعاملةِ
 * تُثبِّتُ اللقطةَ فتُعيدُ القراءاتُ التاليةُ **القيمةَ عينَها** مهما جرى.
 * فـ`pg_stat_clear_snapshot()` قبلَ كلِّ قراءةٍ شرطُ صحّةِ المقياسِ لا زينةٌ.
 */

import type { Sql } from "../../packages/infrastructure/db/client.ts";

/**
 * سقفُ النموِّ المسموحُ بينَ كتلةِ البدايةِ وكتلةِ النهايةِ — **مصدرُ حقيقةٍ
 * واحدٌ** يستوردُه الاختبارُ ويحرسُ قيمتَه `scripts/check-soak-work-measure.ts`.
 *
 * والقيمةُ `3` **هيَ عينُ سقفِ الحاجزِ الأصليِّ**: `DEC-18` قرارُ **وحدةِ قياسٍ**
 * لا قرارُ تخفيفٍ، فلا تُرفَعُ العتبةُ بحُجّةِ تبديلِ المقياسِ. ورفعُها لاحقاً
 * يُخفِقُ حاجزاً ساكناً لا يمرُّ بمراجعةٍ بشريّةٍ وحدَها.
 */
export const WORK_GROWTH_CEILING = 3;

/** حجمُ كتلةِ المقارنةِ: عشرُ رحلاتٍ في الطرفَينِ من ثلاثينَ. */
export const WORK_BLOCK_RIDES = 10;

/** عدّادا العملِ التراكميّانِ كما يقرؤُهما المحرِّكُ. */
export interface EngineWork {
  /** صفوفٌ أعادَها مسحٌ تسلسليٌّ أو فهرسٌ — `tup_returned + tup_fetched`. */
  readonly rowsScanned: bigint;
  /** كُتَلٌ لُمِسَت في الذاكرةِ أو على القرصِ — `blks_hit + blks_read`. */
  readonly blocksTouched: bigint;
}

/** فرقُ عدّادَينِ: عملُ ما بينَ حدَّينِ. */
export function workBetween(before: EngineWork, after: EngineWork): EngineWork {
  return {
    rowsScanned: after.rowsScanned - before.rowsScanned,
    blocksTouched: after.blocksTouched - before.blocksTouched,
  };
}

/** نسبةُ نموِّ العملِ بينَ كتلتَينِ متساويتَي الحجمِ. */
export interface WorkGrowth {
  readonly rowsRatio: number;
  readonly blocksRatio: number;
}

/**
 * يحسبُ نسبةَ النموِّ. والكتلتانِ متساويتا الحجمِ فالنسبةُ نفسُها سواءٌ قُسِمَ
 * المجموعُ أم المتوسِّطُ.
 *
 * وصفرُ الكتلةِ الأولى **يُرمى خطأً لا يُعالَجُ بقيمةٍ افتراضيّةٍ**: عملٌ مقيسٌ
 * بصفرٍ يعني أنَّ القياسَ نفسَه معطوبٌ (عدّادٌ لم يُفرَغْ · قاعدةٌ غيرُ التي
 * عُمِلَ عليها)، ونسبةٌ تُحسَبُ على صفرٍ **تُخضِّرُ حاجزاً أعمى**.
 */
export function workGrowth(firstBlock: EngineWork, lastBlock: EngineWork): WorkGrowth {
  if (firstBlock.rowsScanned <= 0n || firstBlock.blocksTouched <= 0n) {
    throw new Error(
      `قياسٌ معطوبٌ: كتلةُ البدايةِ بلا عملٍ (صفوفٌ=${String(firstBlock.rowsScanned)} · ` +
        `كُتَلٌ=${String(firstBlock.blocksTouched)}) — لا تُحسَبُ نسبةٌ على صفرٍ.`,
    );
  }
  // وكتلةُ النهايةِ بلا عملٍ **أخطرُ**: النسبةُ تصيرُ صفراً فيَخضَرُ الحاجزُ وهوَ
  // أعمى. وثلاثونَ رحلةً جرَت فعلاً، فصفرٌ معناه أنَّ القياسَ لم يرَ العملَ.
  if (lastBlock.rowsScanned <= 0n || lastBlock.blocksTouched <= 0n) {
    throw new Error(
      `قياسٌ معطوبٌ: كتلةُ النهايةِ بلا عملٍ (صفوفٌ=${String(lastBlock.rowsScanned)} · ` +
        `كُتَلٌ=${String(lastBlock.blocksTouched)}) — عشرُ رحلاتٍ جرَت ولم يُرَ لها عملٌ، ` +
        `فالعدّادُ لا الشِّفرةُ.`,
    );
  }
  return {
    rowsRatio: Number(lastBlock.rowsScanned) / Number(firstBlock.rowsScanned),
    blocksRatio: Number(lastBlock.blocksTouched) / Number(firstBlock.blocksTouched),
  };
}

/** وصفٌ مقروءٌ يُطبَعُ معَ الحكمِ فيُقرأُ الرقمُ لا يُخمَّنُ. */
export function describeWorkGrowth(
  firstBlock: EngineWork,
  lastBlock: EngineWork,
  growth: WorkGrowth,
): string {
  return (
    `عملُ الكتلةِ الدافئةِ الأولى (${String(WORK_BLOCK_RIDES)} رحلاتٍ بعدَ الإحماءِ): ` +
    `${String(firstBlock.rowsScanned)} صفّاً ممسوحاً · ${String(firstBlock.blocksTouched)} كتلةً. ` +
    `وعملُ الكتلةِ الأخيرةِ (${String(WORK_BLOCK_RIDES)} رحلاتٍ): ` +
    `${String(lastBlock.rowsScanned)} صفّاً · ${String(lastBlock.blocksTouched)} كتلةً. ` +
    `النسبةُ: صفوفٌ ×${growth.rowsRatio.toFixed(2)} · كُتَلٌ ×${growth.blocksRatio.toFixed(2)} ` +
    `(السقفُ ×${String(WORK_GROWTH_CEILING)}).`
  );
}

/** قراءةٌ واحدةٌ للعدّادَينِ بعدَ مسحِ لقطةِ الجلسةِ. */
async function readEngineWork(sql: Sql): Promise<EngineWork> {
  await sql`select pg_stat_clear_snapshot()`;
  const [row] = await sql<{ rows_scanned: string; blocks_touched: string }[]>`
    select (tup_returned + tup_fetched)::text as rows_scanned,
           (blks_read + blks_hit)::text      as blocks_touched
      from pg_stat_database
     where datname = current_database()
  `;
  if (row === undefined) throw new Error("لا صفَّ في pg_stat_database للقاعدةِ الجاريةِ");
  return { rowsScanned: BigInt(row.rows_scanned), blocksTouched: BigInt(row.blocks_touched) };
}

/** أقصى انتظارِ سكونٍ قبلَ أن يُعلَنَ عطبُ قياسٍ — لا صمتَ ولا انتظارَ بلا حدٍّ. */
const SETTLE_TIMEOUT_MS = 20_000;
const SETTLE_INTERVAL_MS = 500;
/**
 * انتظارٌ أوّليٌّ **أطولُ من `PGSTAT_MIN_INTERVAL`** (ثانيةٌ في PostgreSQL):
 * خادمٌ خلفيٌّ أفرغَ إحصاءَه قبلَ أقلَّ من ثانيةٍ يُؤجِّلُ الإفراغَ التالي، فقراءتانِ
 * متطابقتانِ خلالَ تلك الثانيةِ **سكونٌ كاذبٌ** لا سكونُ عملٍ.
 */
const SETTLE_GRACE_MS = 2_500;
/** تُشتَرَطُ ثلاثُ قراءاتٍ متتاليةٍ مستقرّةٍ لا واحدةٌ: إفراغٌ متأخّرٌ لخادمٍ واحدٍ يُكشَفُ. */
const SETTLE_STABLE_READS = 3;

/**
 * يقرأُ العدّادَينِ **بعدَ سكونٍ مقيسٍ**: مُهلةٌ أوّليّةٌ تتجاوزُ حدَّ الإفراغِ الأدنى،
 * ثمَّ إعادةُ القراءةِ حتّى تتطابقَ ثلاثُ قراءاتٍ متتاليةٍ، فيُضمَنَ أنَّ ما أفرغَتْهُ
 * الخوادمُ الخلفيّةُ صارَ في العدّادِ — لا أنَّ العدّادَ ساكنٌ لأنَّه لم يُفرَغْ بعدُ.
 *
 * ولا يُستعمَلُ داخلَ حلقةِ الرحلاتِ بل عندَ حدودِ الكُتَلِ وحدَها: أربعُ قراءاتٍ
 * لا ثلاثونَ، فكلفةُ التزامُنِ معلومةٌ ومحدودةٌ.
 */
export async function settleEngineWork(sql: Sql): Promise<EngineWork> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  await Bun.sleep(SETTLE_GRACE_MS);
  let previous = await readEngineWork(sql);
  let stable = 0;
  for (;;) {
    await Bun.sleep(SETTLE_INTERVAL_MS);
    const current = await readEngineWork(sql);
    if (
      current.rowsScanned === previous.rowsScanned &&
      current.blocksTouched === previous.blocksTouched
    ) {
      stable += 1;
      if (stable >= SETTLE_STABLE_READS) return current;
    } else {
      stable = 0;
    }
    previous = current;
    if (Date.now() > deadline) {
      throw new Error(
        `لم تسكُنْ عدّاداتُ المحرِّكِ خلالَ ${String(SETTLE_TIMEOUT_MS)}ms — ` +
          "ثمّةَ عملٌ آخرُ على القاعدةِ نفسِها، فالقياسُ لا يخُصُّ هذا الاختبارَ وحدَه.",
      );
    }
  }
}
