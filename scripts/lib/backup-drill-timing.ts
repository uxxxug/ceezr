/**
 * الغرض: الحَكَمُ الخالصُ لتمرينِ استعادةِ النسخةِ الاحتياطيّةِ المُوثَّقِ بالزمنِ
 *   الفعليِّ (`F11-10` · `OPS-008` · ADR 0201): يُثبِتُ أنَّ الأزمنةَ المقيسةَ
 *   موجودةٌ وموجبةٌ ومتّسقةٌ ومسجَّلةٌ في `db_backups` — لا مجرَّدَ نجاحِ
 *   الاستعادةِ. فالاستعادةُ بلا زمنٍ تُثبِتُ القابليّةَ لا «التدريبَ الموثَّقَ
 *   بالزمنِ» الذي يطلبُهُ البندُ.
 * الحالة: مُنفَّذ · مُختبَر (سالباتٌ مبذورةٌ لكلِّ قاعدةٍ في
 *   tests/unit/backup-drill-timing.test.ts — القاعدةُ ح-7).
 * ينتمي إلى: scripts/lib
 * يُتوقَّع أن يستخدمه لاحقاً: tests/integration/backup-restore-verification.test.ts
 *   وكلُّ من يقرأُ زمنَ تمرينٍ ويريدُ تمييزَ الصادقِ من المزعومِ.
 * ملاحظات مستقبلية: لا يُحكَمُ هنا على سقفِ زمنٍ (لا `RTO`) — ذاكَ مؤجَّلٌ إلى
 *   بيئةٍ شبيهةٍ بالإنتاجِ (ADR 0047 §٣)، والحَكَمُ يُثبِتُ القياسَ لا يدَّعي
 *   حدودَه.
 */

/**
 * مدخلُ الحَكَمِ. كلُّ الحقولِ اختياريّةٌ عمداً: الغيابُ نفسُهُ مُخالفةٌ تُدانُ،
 * لا خطأَ إدخالٍ يُرمى — فالتمرينُ الذي «نجح» بلا زمنٍ هوَ عينُ ما تُمسِكُهُ
 * القاعدةُ `timing.recorded`.
 */
export interface DrillTimingInput {
  /** أزمنةُ أطوارِ الاستعادةِ كما أعادَها `verifyBackupRestore`. */
  readonly timings?: {
    readonly sourceFingerprintMs?: number;
    readonly restoreMs?: number;
    readonly restoredFingerprintMs?: number;
  };
  /** مدّةُ تفريغِ المصدرِ (`pg_dump`) إن كانَ التمرينُ يُوثِّقُها. */
  readonly dumpMs?: number;
  /** الزمنُ الكلّيُّ لجولةِ التمرينِ إن وُثِّقَ. */
  readonly totalMs?: number;
  /** ما سُجِّلَ في `db_backups.restore_verification_detail` (jsonb مُفكوكٌ). */
  readonly detail?: {
    readonly timings?: {
      readonly sourceFingerprintMs?: number;
      readonly restoreMs?: number;
      readonly restoredFingerprintMs?: number;
    };
  };
}

export interface DrillTimingRule {
  readonly id: string;
  readonly violated: boolean;
}

export interface DrillTimingVerdict {
  readonly verdict: "ok" | "violation";
  readonly violations: readonly string[];
  readonly rules: readonly DrillTimingRule[];
}

/** قيمةٌ عدديةٌ موجبةٌ منتهيةٌ — لا صفرٌ ولا سالبٌ ولا `NaN` ولا `Infinity`. */
function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * القواعدُ:
 * - `timing.recorded`: الأطوارُ الثلاثةُ موجودةٌ كلُّها؛ غيابُ طورٍ = تمرينٌ
 *   يُدَّعى لا يُوثَّقُ.
 * - `timing.source-fingerprint-positive` · `timing.restore-positive` ·
 *   `timing.restored-fingerprint-positive`: كلُّ طورٍ عددٌ منتهٍ موجبٌ.
 * - `timing.dump-positive` و`timing.total-positive` (شرطيّتانِ): إن وُثِّقَ
 *   التفريغُ أو الزمنُ الكلّيُّ فليكنْ موجباً منتهياً، ومن غابَ عنهُ لم يُدانْ —
 *   فالتمرينُ الأدنى يطلبُ أطوارَ الاستعادةِ، والتفريغُ والكلِّيُّ زيادةٌ.
 * - `timing.total-covers-phases` (شرطيّةٌ): الزمنُ الكلّيُّ لا يقلُّ عن مجموعِ
 *   الأطوارِ الموثَّقةِ — كلٌّ أقلَّ منهُ يعني زمناً كلّيًّاً مُختلَقاً.
 * - `timing.detail-persisted` (شرطيّةٌ): ما سُجِّلَ في `db_backups` يطابقُ
 *   أزمنةَ النتيجةِ — سجلٌّ يخالفُها توثيقٌ كاذبٌ لا أثرٌ.
 */
export function judgeDrillTimings(input: DrillTimingInput): DrillTimingVerdict {
  const rules: DrillTimingRule[] = [];

  const recorded =
    input.timings !== undefined &&
    input.timings.sourceFingerprintMs !== undefined &&
    input.timings.restoreMs !== undefined &&
    input.timings.restoredFingerprintMs !== undefined;
  rules.push({ id: "timing.recorded", violated: !recorded });

  if (input.timings !== undefined) {
    rules.push({
      id: "timing.source-fingerprint-positive",
      violated: !positiveFinite(input.timings.sourceFingerprintMs),
    });
    rules.push({
      id: "timing.restore-positive",
      violated: !positiveFinite(input.timings.restoreMs),
    });
    rules.push({
      id: "timing.restored-fingerprint-positive",
      violated: !positiveFinite(input.timings.restoredFingerprintMs),
    });
  }

  if (input.dumpMs !== undefined) {
    rules.push({ id: "timing.dump-positive", violated: !positiveFinite(input.dumpMs) });
  }
  if (input.totalMs !== undefined) {
    rules.push({ id: "timing.total-positive", violated: !positiveFinite(input.totalMs) });
  }

  if (input.totalMs !== undefined && recorded) {
    const phases = input.dumpMs !== undefined && positiveFinite(input.dumpMs) ? input.dumpMs : 0;
    const sum =
      phases +
      input.timings.sourceFingerprintMs +
      input.timings.restoreMs +
      input.timings.restoredFingerprintMs;
    // هامشُ نصفِ مليّثانيةٍ لتقريبِ العومِ: `performance.now()` كسريٌّ والجمعُ
    // يُقارَّنُ بقيمةٍ مُخزَّنةٍ قد تُدارُ إلى أقلَّ بمقدارٍ ضئيلٍ لا معنى لهُ.
    rules.push({
      id: "timing.total-covers-phases",
      violated: input.totalMs + 0.5 < sum,
    });
  }

  if (input.detail !== undefined) {
    const stored = input.detail.timings;
    rules.push({
      id: "timing.detail-persisted",
      violated: !(
        stored !== undefined &&
        stored.sourceFingerprintMs === input.timings?.sourceFingerprintMs &&
        stored.restoreMs === input.timings?.restoreMs &&
        stored.restoredFingerprintMs === input.timings?.restoredFingerprintMs
      ),
    });
  }

  const violations = rules.filter((rule) => rule.violated).map((rule) => rule.id);
  return { verdict: violations.length === 0 ? "ok" : "violation", violations, rules };
}
