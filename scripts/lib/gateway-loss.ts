/**
 * الغرض: الحَكَمُ الخالصُ لفقدانِ البوّابةِ (`F11-01` · الشقُّ المملوكُ للمستودَعِ ·
 *   ADR 0202): يُثبِتُ أنَّ موتَ البوّابةِ **بلا إنذارٍ** أثناءَ رحلةٍ جاريةٍ لا
 *   يُفقدُ تحديثاً ولا يُعيدُ حواراً من الصفرِ ولا يُوقفُ رحلةً: التحديثُ المودَعُ
 *   في الطابورِ الصامدِ قبلَ الموتِ (`ADR 0057`) تُعالِّجُهُ البوّابةُ البديلةُ
 *   مرّةً واحدةً، والجلسةُ في Redis باقيةٌ، والرحلةُ تكتملُ عبرَ البديلِ.
 * الحالة: مُنفَّذ · مُختبَر (سالباتٌ مبذورةٌ لكلِّ قاعدةٍ في
 *   tests/unit/gateway-loss-judge.test.ts — القاعدةُ ح-7).
 * ينتمي إلى: scripts/lib
 * يُتوقَّع أن يستخدمه لاحقاً: tests/real-redis/gateway-loss-continuity-real.test.ts.
 * ملاحظات مستقبلية: لا يُحكَمُ ههنا على تعدُّدِ مثيلاتٍ متزامنٍ (مقفلٌ بـ`R-17` ·
 *   ADR 0050 §٨) ولا على حملٍ (`DEC-17`) ولا على تصريفٍ SIGTERM (مقيسٌ في `F5-06`).
 */

/**
 * مدخلُ الحَكَمِ. كلُّ الحقولِ اختياريّةٌ عمداً: الغيابُ نفسُهُ مُخالفةٌ تُدانُ
 * (`timing`-style honesty)، فالاختبارُ الذي «نجحَ» بلا قياسٍ يُطعِمُ الحَكَمَ
 * نصفَ الحقيقةِ فيُدينُهُ.
 */
export interface GatewayLossInput {
  /** موتُ العمليةِ الأُولى كما رصدها الاختبارُ. */
  readonly kill?: {
    /** إشارةُ القتلِ كما عادت من `proc.exited` — المفروضُ `SIGKILL`. */
    readonly signal?: string;
    /** هل خرجتِ العمليةُ فعلاً؟ */
    readonly exited?: boolean;
  };
  /** طلبٌ أُرسِلَ في أثناءِ الموتِ (قبلَ إقلاعِ البديلِ). */
  readonly downtime?: {
    /** فشلَ على مستوى الشبكةِ (رفضُ اتصالٍ) لا جواباً من خادمٍ حيٍّ. */
    readonly refusedAtNetworkLevel?: boolean;
    /** جاءَه جوابُ HTTP ناجحٌ (200) من عمليةٍ ميتةٍ — كذبٌ إن صحَّ. */
    readonly answeredOk?: boolean;
  };
  /** جهوزيّةُ البوّابةِ البديلةِ. */
  readonly replacement?: {
    /** رمزُ حالةِ `/ready` على البديلِ. */
    readonly readyStatus?: number;
  };
  /** التحديثُ المودَعُ قبلَ الموتِ (مفتاحُ قياسِ الصمودِ). */
  readonly durableUpdate?: {
    /** حالتُهُ في `telegram_update_jobs` لحظةَ موتِ الأُولى — المفروضُ `pending`. */
    readonly statusAtDeath?: string;
    /** حالتُهُ بعدَ إقلاعِ البديلِ — المفروضُ `done`. */
    readonly statusAfterReplacement?: string;
    /** عددُ صفوفِ الوظيفةِ لهذا `update_id` — المفروضُ واحدٌ لا أكثر. */
    readonly jobRows?: number;
  };
  /** الجلسةُ في Redis (مفتاحُ الحوارِ) قبلَ الموتِ وبعدَ إقلاعِ البديلِ. */
  readonly session?: {
    readonly existedBeforeDeath?: boolean;
    readonly existsAfterReplacement?: boolean;
    /** true = بعدَ البديلِ عادتِ الجلسةُ إلى الحالةِ الابتدائيّةِ (`idle`) — بُنيتْ من جديدٍ لا بقيتْ. */
    readonly resetToInitialState?: boolean;
  };
  /** الرحلةُ التي كانت جاريةً عندَ الموتِ. */
  readonly ride?: {
    /** عددُ صفوفِ الطلبِ لراكبِنا — المفروضُ واحدٌ (لا ازدواجَ عبرَ الموتِ). */
    readonly orderRows?: number;
    /** حالتُهُ النهائيّةُ بعدَ أوامرَ مرَّتْ عبرَ البديلِ. */
    readonly finalStatus?: string;
    /** السائقُ عادَ متاحاً بعدَ إكمالِ الرحلةِ. */
    readonly driverAvailableAgain?: boolean;
  };
}

export interface GatewayLossRule {
  readonly id: string;
  readonly violated: boolean;
}

export interface GatewayLossVerdict {
  readonly verdict: "ok" | "violation";
  readonly violations: readonly string[];
  readonly rules: readonly GatewayLossRule[];
}

/**
 * القواعدُ الثماني:
 * - `gateway.really-killed`: الموتُ حقيقيٌّ — إشارةُ `SIGKILL` وعمليةٌ خرجَتْ.
 *   موتٌ مُدَّعى بلا إشارةٍ لا يُثبِتُ فقداناً بل يُثبِتُ إعادةَ تشغيلٍ.
 * - `gateway.downtime-honest`: الطلبُ في أثناءِ الموتِ يُرفَضُ على السِلكِ، ولا
 *   يأتيهِ 200 كاذبٌ من شيءٍ ما زالَ يسمعُ.
 * - `gateway.replacement-ready`: البديلُ أجابَ `/ready` بـ200 — بديلٌ لم يُقلِعْ
 *   لا يُكملُ رحلةً.
 * - `update.pending-at-death`: التحديثُ كانَ في الطابورِ (`pending`) لحظةَ الموتِ —
 *   هذا شرطُ الصمودِ لا نتيجتَه: تحديثٌ عولجَ قبلَ الموتِ لا يقيسُ عبورَ الموتِ.
 * - `update.survives-death`: وصلَ إلى `done` بعدَ إقلاعِ البديلِ — الموتُ لم
 *   يُبتلِعْهُ.
 * - `update.exactly-once`: صفُّ وظيفةٍ واحدٌ لهذا التحديثِ — لا ازدواجَ عبرَ
 *   الموتِ والبديلِ.
 * - `session.survives-in-redis`: الجلسةُ كانت في Redis قبلَ الموتِ وبقيتْ بعدَ
 *   البديلِ ولم تُعَدْ إلى الحالةِ الابتدائيّةِ — الحوارُ لا يبدأُ من الصفرِ.
 * - `ride.completes-via-replacement`: طلبٌ واحدٌ اكتملَ (`completed`) والسائقُ
 *   عادَ متاحاً — الرحلةُ لم تتعطّلْ بموتِ البوّابةِ.
 */
export function judgeGatewayLoss(input: GatewayLossInput): GatewayLossVerdict {
  const rules: GatewayLossRule[] = [];

  rules.push({
    id: "gateway.really-killed",
    violated: !(input.kill?.signal === "SIGKILL" && input.kill.exited === true),
  });

  if (input.downtime !== undefined) {
    rules.push({
      id: "gateway.downtime-honest",
      violated: !(
        input.downtime.refusedAtNetworkLevel === true && input.downtime.answeredOk !== true
      ),
    });
  }

  if (input.replacement !== undefined) {
    rules.push({
      id: "gateway.replacement-ready",
      violated: !(input.replacement.readyStatus === 200),
    });
  }

  if (input.durableUpdate !== undefined) {
    rules.push({
      id: "update.pending-at-death",
      violated: !(input.durableUpdate.statusAtDeath === "pending"),
    });
    rules.push({
      id: "update.survives-death",
      violated: !(input.durableUpdate.statusAfterReplacement === "done"),
    });
    rules.push({
      id: "update.exactly-once",
      violated: !(input.durableUpdate.jobRows === 1),
    });
  }

  if (input.session !== undefined) {
    rules.push({
      id: "session.survives-in-redis",
      violated: !(
        input.session.existedBeforeDeath === true &&
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

  const violations = rules.filter((rule) => rule.violated).map((rule) => rule.id);
  return { verdict: violations.length === 0 ? "ok" : "violation", violations, rules };
}

/** زمنُ تعطُّلِ البوّابةِ بين موتِ الأُولى وجهوزيّةِ البديلِ (للتوثيقِ لا للحكمِ). */
export function downtimeMs(deadAtMs: number, replacementReadyAtMs: number): number {
  return Math.max(0, replacementReadyAtMs - deadAtMs);
}
