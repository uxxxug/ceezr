/**
 * الغرض: الحَكَمُ الخالصُ لتبديلِ النسخةِ المُعلَنِ (`F11-08` · الشقُّ المملوكُ
 *   للمستودَعِ · ADR 0203): يُثبِتُ أنَّ إشارةَ النشرِ (`SIGTERM` — التصريفُ
 *   الرشيقُ في `F5-05`/`CAP-008`) لا تُفقدُ بياناتٍ: التحديثُ المودَعُ قبلَ
 *   الإشارةِ لا يضيعُ ولا يُعالَجُ مرّتَين، والجلسةُ في Redis لا تُبنى من جديدٍ،
 *   والرحلةُ الجاريةُ تكتملُ عبرَ البديلِ.
 *
 *   الفرقُ عن `F11-01` (`gateway-loss.ts`): ذاكَ موتٌ **بلا إنذارٍ** (`SIGKILL`)
 *   فيُقاسُ أنَّ التحديثَ المودَعَ قبلَ الموتِ تُعالِّجُهُ البديلةُ مرّةً واحدةً.
 *   وهذا **تصريفٌ مُعلَنٌ** (`SIGTERM`): يُقاسُ أنَّ النافذةَ التي يراها المُوجّهُ
 *   (`announceMs`: `/ready` = 503 «مُصرِّف» والخادمُ ما زالَ يستقبلُ) حقيقيةٌ،
 *   وأنَّ الخروجَ رشيقٌ (رمزُ `0`)، وأنَّ ما قُبِلَ قبلَ الإشارةِ (200) لم يضِعْ
 *   عبرَ التبديلِ — لا واحدٌ منهُ ولا ازدواجاً فيهِ.
 *
 *   ولماذا لا يُحكَمُ ههنا على «الوظيفةُ تكتملُ قبلَ الخروجِ»؟ لأنَّ التصميمَ
 *   المُعلَنَ (`ADR 0057` · سقفُ الشوطِ في `F6-06`) يقولُ: ما بقيَ في الطابورِ
 *   **لا يُفقَدُ** — الصفوفُ صامدةٌ في القاعدةِ والبديلُ يلتقطُها؛ و`stop()` ينتظرُ
 *   الشوطَ **الجاري** فيُختمُ ما حُجِزَ، وما لم يُحجَزْ بعدُ يبقى `pending` بلا فقدٍ.
 *   فالحكمُ على الحالةِ عندَ الخروجِ هو «ليستَ عالقةً `claimed`» — لا «لازمًا
 *   `done`» — ثمَّ `done` بعدَ البديلِ هو البرهانُ على عدمِ الفقدِ.
 *
 * الحالة: مُنفَّذ · مُختبَر (سالباتٌ مبذورةٌ لكلِّ قاعدةٍ في
 *   tests/unit/deploy-swap-judge.test.ts — القاعدةُ ح-7).
 * ينتمي إلى: scripts/lib
 * يُتوقَّع أن يستخدمه لاحقاً: tests/real-redis/deploy-swap-continuity-real.test.ts.
 * ملاحظات مستقبلية: لا يُحكَمُ ههنا على حملٍ (`DEC-17`) ولا على تعدُّدِ مثيلاتٍ
 *   متزامنٍ (`R-17`) ولا على السقفِ المُعلَنِ (`graceMs`) — ذاكَ قرارُ تشغيلٍ
 *   لا قرارُ اختبارٍ.
 */

/**
 * مدخلُ الحَكَمِ. كلُّ الحقولِ اختياريّةٌ عمداً: الغيابُ نفسُهُ مُخالفةٌ تُدانُ
 * (`timing`-style honesty)، فالاختبارُ الذي «نجحَ» بلا قياسٍ يُطعِمُ الحَكَمَ
 * نصفَ الحقيقةِ فيُدينُهُ.
 */
export interface DeploySwapInput {
  /** إشارةُ النشرِ كما رصدها الاختبارُ. */
  readonly signal?: {
    /** اسمُ الإشارةِ — المفروضُ `SIGTERM` (إشارةُ النشرِ لا القتلِ القاسيِّ). */
    readonly name?: string;
    /** رمزُ الخروجِ — المفروضُ `0`: تصريفٌ رشيقٌ لا انهيارٌ. */
    readonly exitCode?: number | null;
  };
  /** نافذةُ الإعلانِ (`announceMs`) كما رصدها الاختبارُ بعدَ الإشارةِ. */
  readonly announce?: {
    /** رمزُ حالةِ `/ready` في النافذةِ — المفروضُ `503`. */
    readonly readyStatus?: number;
    /** قيمةُ `status` في جسمِ الجوابِ — المفروضُ `draining`. */
    readonly statusBody?: string;
    /** الخادمُ ما زالَ يستقبلُ: طلبٌ تجاريٌّ في النافذةِ جاءَهُ جوابُ HTTP (لا رفضُ اتصالٍ). */
    readonly stillAccepting?: boolean;
  };
  /** التحديثُ المودَعُ قبلَ الإشارةِ (مفتاحُ قياسِ عدمِ الفقدِ). */
  readonly durableUpdate?: {
    /** ما رآهُ الاختبارُ قبلَ إرسالِ الإشارةِ — المفروضُ `pending` (شرطُ القياسِ لا نتيجتُه). */
    readonly statusObservedBeforeSignal?: string;
    /** حالتُهُ بعدَ خروجِ الأُولى وقبلَ إقلاعِ البديلِ — المفروضُ `pending` أو `done` لا `claimed` عالقةً. */
    readonly statusAtExit?: string;
    /** حالتُهُ بعدَ إقلاعِ البديلِ — المفروضُ `done`. */
    readonly statusAfterReplacement?: string;
    /** عددُ صفوفِ الوظيفةِ لهذا التحديثِ — المفروضُ واحدٌ لا أكثر. */
    readonly jobRows?: number;
  };
  /**
   * كلُّ تحديثٍ قُبِلَ بـ200 عبرَ الاختبارِ كلِّهِ (جولاتُ اللحاقِ قبلَ الإشارةِ
   * والتحقيقُ نفسُهُ) — كنسٌ للفقدِ لا تحقيقٌ واحدٌ: البندُ يقيسُ «بلا فقدانِ
   * بياناتٍ» لا «تحقيقٌ نجا».
   */
  readonly acceptedUpdates?: {
    /** عددُ التحديثاتِ المقبولةِ (200). */
    readonly count?: number;
    /** كم منها صارَ `done` بعدَ التبديلِ — المفروضُ كلُّها. */
    readonly doneAfterSwap?: number;
    /** كم منها لهُ صفُّ وظيفةٍ واحدٌ بالضبطِ — المفروضُ كلُّها. */
    readonly exactlyOnce?: number;
  };
  /** الجلسةُ في Redis قبلَ الإشارةِ وبعدَ إقلاعِ البديلِ. */
  readonly session?: {
    readonly existedBeforeSignal?: boolean;
    readonly existsAfterReplacement?: boolean;
    /** true = بعدَ البديلِ عادتِ الجلسةُ إلى الحالةِ الابتدائيّةِ — بُنيتْ من جديدٍ. */
    readonly resetToInitialState?: boolean;
  };
  /** الرحلةُ التي كانت جاريةً عندَ الإشارةِ. */
  readonly ride?: {
    /** عددُ صفوفِ الطلبِ لراكبِنا — المفروضُ واحدٌ (لا ازدواجَ عبرَ التبديلِ). */
    readonly orderRows?: number;
    /** حالتُهُ النهائيّةُ بعدَ أوامرَ مرَّتْ عبرَ البديلِ. */
    readonly finalStatus?: string;
    /** السائقُ عادَ متاحاً بعدَ إكمالِ الرحلةِ. */
    readonly driverAvailableAgain?: boolean;
  };
  /** البديلُ — يُقلَعُ **بعدَ** خروجِ الأُولى لا معَهُ (`R-17`). */
  readonly replacement?: {
    /** رمزُ حالةِ `/ready` على البديلِ — المفروضُ `200`. */
    readonly readyStatus?: number;
    /** أُقلِعَ بعدَ خروجِ الأُولى لا قبلهُ — تعدُّدُ مثيلاتٍ متزامنٍ مقفلٌ (`R-17`). */
    readonly startedAfterOldExit?: boolean;
  };
}

export interface DeploySwapRule {
  readonly id: string;
  readonly violated: boolean;
}

export interface DeploySwapVerdict {
  readonly verdict: "ok" | "violation";
  readonly violations: readonly string[];
  readonly rules: readonly DeploySwapRule[];
}

/**
 * القواعدُ الحاديَ عشرةَ:
 * - `signal.graceful`: الإشارةُ `SIGTERM` والخروجُ برمزِ `0` — نشرٌ مُعلَنٌ رشيقٌ
 *   لا انهيارٌ ولا قتلٌ قاسٍ (ذاكَ مِلكُ `F11-01`).
 * - `announce.seen-by-router`: نافذةُ الإعلانِ رأتها الحياةُ — `/ready` ردَّ `503`
 *   بحالةِ `draining` **والخادمُ لا يزالُ يستقبلُ** (طلبٌ تجاريٌّ جاءَهُ جوابُ HTTP
 *   لا رفضَ اتصالٍ). إعلانٌ لا يراهُ أحدٌ ليسَ إعلاناً.
 * - `update.pending-observed-before-signal`: التحديثُ رُئيَ `pending` قبلَ إرسالِ
 *   الإشارةِ — شرطُ الصمودِ لا نتيجتُه: تحديثٌ عُولِجَ قبلَ الإشارةِ لا يقيسُ
 *   عبورَ التبديلِ.
 * - `update.not-claimed-at-exit`: عندَ الخروجِ الوظيفةُ `pending` أو `done` — لا
 *   `claimed` عالقةً: فـ`stop()` ينتظرُ الشوطَ الجاري، فحجزٌ بلا ختمٍ عندَ الخروجِ
 *   يعني أنَّ الانتظارَ كذِبٌ.
 * - `update.survives-swap`: وصلَ إلى `done` بعدَ إقلاعِ البديلِ — التبديلُ لم
 *   يُبتلِعْهُ.
 * - `update.exactly-once`: صفُّ وظيفةٍ واحدٌ لهذا التحديثِ — لا ازدواجَ عبرَ
 *   الإشارةِ والبديلِ.
 * - `updates.all-accepted-survive`: كلُّ ما قُبِلَ بـ200 صارَ `done` بصفٍّ واحدٍ
 *   لكلِّ تحديثٍ — الفقدُ يُقاسُ على المجموعةِ لا على تحقيقٍ مختارٍ.
 * - `session.survives-swap`: الجلسةُ في Redis باقيةٌ قبلَ الإشارةِ وبعدَ البديلِ
 *   ولم تُعَدْ إلى الحالةِ الابتدائيّةِ — الحوارُ لا يبدأُ من الصفرِ.
 * - `ride.completes-via-replacement`: طلبٌ واحدٌ اكتملَ (`completed`) والسائقُ عادَ
 *   متاحاً — الرحلةُ لم تتعطّلْ بتبديلِ النسخةِ.
 * - `replacement.ready`: البديلُ أجابَ `/ready` بـ200 — بديلٌ لم يُقلِعْ لا يُكملُ
 *   رحلةً.
 * - `replacement.after-old-exit`: البديلُ أُقلِعَ **بعدَ** خروجِ الأُولى لا معَهُ —
 *   تعدُّدُ مثيلاتٍ متزامنٍ مقفلٌ (`R-17`).
 */
export function judgeDeploySwap(input: DeploySwapInput): DeploySwapVerdict {
  const rules: DeploySwapRule[] = [];

  rules.push({
    id: "signal.graceful",
    violated: !(input.signal?.name === "SIGTERM" && input.signal?.exitCode === 0),
  });

  if (input.announce !== undefined) {
    rules.push({
      id: "announce.seen-by-router",
      violated: !(
        input.announce.readyStatus === 503 &&
        input.announce.statusBody === "draining" &&
        input.announce.stillAccepting === true
      ),
    });
  }

  if (input.durableUpdate !== undefined) {
    rules.push({
      id: "update.pending-observed-before-signal",
      violated: !(input.durableUpdate.statusObservedBeforeSignal === "pending"),
    });
    rules.push({
      id: "update.not-claimed-at-exit",
      violated: !(
        input.durableUpdate.statusAtExit === "pending" ||
        input.durableUpdate.statusAtExit === "done"
      ),
    });
    rules.push({
      id: "update.survives-swap",
      violated: !(input.durableUpdate.statusAfterReplacement === "done"),
    });
    rules.push({
      id: "update.exactly-once",
      violated: !(input.durableUpdate.jobRows === 1),
    });
  }

  if (input.acceptedUpdates !== undefined) {
    rules.push({
      id: "updates.all-accepted-survive",
      violated: !(
        input.acceptedUpdates.count !== undefined &&
        input.acceptedUpdates.count > 0 &&
        input.acceptedUpdates.doneAfterSwap === input.acceptedUpdates.count &&
        input.acceptedUpdates.exactlyOnce === input.acceptedUpdates.count
      ),
    });
  }

  if (input.session !== undefined) {
    rules.push({
      id: "session.survives-swap",
      violated: !(
        input.session.existedBeforeSignal === true &&
        input.session.existsAfterReplacement === true &&
        input.session.resetToInitialState !== true
      ),
    });
  }

  if (input.ride !== undefined) {
    rules.push({
      id: "ride.completes-via-replacement",
      violated: !(
        input.ride.orderRows === 1 &&
        input.ride.finalStatus === "completed" &&
        input.ride.driverAvailableAgain === true
      ),
    });
  }

  if (input.replacement !== undefined) {
    rules.push({
      id: "replacement.ready",
      violated: !(input.replacement.readyStatus === 200),
    });
    rules.push({
      id: "replacement.after-old-exit",
      violated: !(input.replacement.startedAfterOldExit === true),
    });
  }

  const violations = rules.filter((rule) => rule.violated).map((rule) => rule.id);
  return { verdict: violations.length === 0 ? "ok" : "violation", violations, rules };
}

/** زمنُ التعطُّلِ بين خروجِ الأُولى وجهوزيّةِ البديلِ (للتوثيقِ لا للحكمِ). */
export function swapDowntimeMs(oldExitAtMs: number, replacementReadyAtMs: number): number {
  return Math.max(0, replacementReadyAtMs - oldExitAtMs);
}
