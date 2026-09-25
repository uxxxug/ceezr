/**
 * الغرض: حَكَمٌ نقيٌّ لقرارِ المالكِ `DEC-19` (2026-09-24) — الصفوفُ 3–5 من القسمِ 9.9
 *   على **مسارِ راكبِ تيليجرام المُختبَرِ** وعلى ملفِّ Chromium «Slow 4G» بقيمِه الحرفيّةِ.
 *   والقياسُ في `scripts/measure-tti.ts`؛ وهذهِ الوحدةُ تحكمُ على حقائقَ مصنوعةٍ أو مقيسةٍ
 *   سواءً، فتُختبَرُ سوالبُها بلا متصفّحٍ (`ح-7`).
 * الحالة: منفّذ فعلياً — `DEC-19` · `ADR 0185`. والبوّابةُ **تقريرٌ لا حاجزٌ** حتى تُستوفى
 *   الحدودُ الثلاثةُ؛ و`F1-09` يبقى `[~]`.
 * ينتمي إلى: scripts/lib
 * يُتوقع أن يستخدمه لاحقاً: scripts/measure-tti.ts · tests/unit
 *
 * **المسارُ المحكومُ** يحاكي مسارَ راكبِ تيليجرام: `initData` موقَّعةٌ ببروتوكولِ تيليجرام،
 * ومستخدمٌ راكبٌ نشطٌ مزروعٌ، وتبادلُ جلسةٍ، و`GET /v1/me`، وسطحُ `rider` — على بوّابةٍ
 * و`PostgreSQL` حقيقيّينِ في CI. وشاشةُ «افتح من تيليجرام» **ليست** مسارَ قبولٍ لهذهِ الصفوفِ.
 *
 * **نقطةُ البدءِ لكلِّ المقاييسِ**: `performance.timeOrigin` لمستندِ التطبيقِ المصغَّرِ. ولا
 * يدخلُ ما قبلَها (فتحُ تيليجرام وتجهيزُ نافذتِه).
 *
 * **ولماذا «تقريرٌ» لا حاجزٌ اليومَ، وكيفَ لا يبقى تقريراً إلى الأبدِ**: القياسُ عندَ القرارِ
 * فوقَ الحدودِ الثلاثةِ، وحاجزٌ أحمرُ عمداً يُعطِّلُ كلَّ دمجٍ فيُدفَعُ إلى الإسكاتِ. فالحدُّ
 * يُطبَعُ ولا يُسقِطُ — **إلّا** أن تُستوفى الحدودُ الثلاثةُ والوضعُ ما زالَ تقريراً، فحينَها
 * يُسقِطُ البناءَ (`READY_TO_BLOCK`) حتى يُحوَّلَ `SLOW_4G_GATE_MODE` إلى `blocking` في الدفعةِ
 * نفسِها. فالتحوُّلُ مفروضٌ آليّاً لا متروكٌ لذاكرةٍ. وشرطُ الحياةِ حاجزٌ في الوضعَينِ.
 */

import type { NetworkProfile } from "./first-paint-budget.ts";
import { type InteractiveRun, interactiveLivenessProblems, median } from "./interactive-budget.ts";

/**
 * Chromium DevTools `Slow4GConditions` حرفاً (`front_end/core/sdk/NetworkManager.ts`):
 * تأخيرٌ `150 * 3.75` ms يُضافُ إلى كلِّ طلبٍ (`targetLatency` = 150 ms) · تنزيلٌ
 * `1.6 * 1000 * 1000 / 8 * .9` · رفعٌ `750 * 1000 / 8 * .9` بايتاً في الثانيةِ. وكانَ اسمُه
 * «Fast 3G» حتى مايو 2024 ثمَّ أُعيدَت تسميتُه ليطابقَ Lighthouse. والمعالجُ ×4 كالقياسِ السابقِ.
 */
export const SLOW_4G: NetworkProfile = {
  id: "chromium-slow-4g",
  source: "Chromium DevTools `Slow4GConditions` (NetworkManager.ts) · CPU ×4 — DEC-19",
  latencyMs: 150 * 3.75,
  downloadBytesPerSecond: ((1.6 * 1000 * 1000) / 8) * 0.9,
  uploadBytesPerSecond: ((750 * 1000) / 8) * 0.9,
  cpuSlowdown: 4,
};

/** حدودُ القسمِ 9.9 بحرفِها — لا تُخفَّضُ (`DEC-19`). */
export const RIDER_SURFACE_LIMITS = {
  fcpMs: 1_800,
  lcpMs: 2_500,
  surfaceRenderedMs: 2_000,
} as const;

export type GateMode = "report-only" | "blocking";

/**
 * وضعُ البوّابةِ على `main`. **لا يُحوَّلُ إلى `blocking` قبلَ استيفاءِ الحدودِ**، ويجبُ أن
 * يُحوَّلَ متى استُوفيَت (`READY_TO_BLOCK`). والإغلاقُ بعدَها ثلاثُ جولاتٍ خضراءَ (`ح-4`).
 */
// 2026-09-25 (`F1-09` · `D-34`): استُوفيَت الحدودُ الثلاثةُ على Slow 4G في CI (وسيطُ السطحِ 1,924 ms ·
// run 36075503975) فأسقطَ `READY_TO_BLOCK` البناءَ؛ فحُوِّلَ الوضعُ كما يفرضُ `ADR 0185` بموافقةِ المالكِ الصريحةِ (2026-09-25).
export const SLOW_4G_GATE_MODE: GateMode = "blocking";

export type RiderSurfaceMetric = "fcp" | "lcp" | "surface-rendered";

export interface RiderSurfaceRun extends InteractiveRun {
  /** آخرُ مُدخَلِ `largest-contentful-paint` رصدَه المراقبُ حتى توقُّفِ القياسِ — `null` إن لم يُرصَدْ. */
  readonly lcpMs: number | null;
}

export interface RiderSurfaceProblem {
  readonly rule:
    | ReturnType<typeof interactiveLivenessProblems>[number]["rule"]
    | "WRONG_SURFACE"
    | "NO_LCP"
    | "LIMIT_NOT_MET"
    | "READY_TO_BLOCK";
  readonly detail: string;
}

export interface RiderSurfaceMetricResult {
  readonly metric: RiderSurfaceMetric;
  readonly medianMs: number | null;
  readonly limitMs: number;
  readonly met: boolean;
}

export interface RiderSurfaceVerdict {
  /** مشكلاتٌ **حاجزةٌ** في الوضعِ المُمرَّرِ — أيُّها يُسقِطُ البناءَ. */
  readonly problems: readonly RiderSurfaceProblem[];
  readonly metrics: readonly RiderSurfaceMetricResult[];
  readonly allMet: boolean;
}

export function evaluateRiderSurface(input: {
  readonly runs: readonly RiderSurfaceRun[];
  readonly mode: GateMode;
  readonly profileId: string;
}): RiderSurfaceVerdict {
  const problems: RiderSurfaceProblem[] = [];
  input.runs.forEach((run, i) => {
    const label = `${input.profileId} #${i + 1}`;
    problems.push(...interactiveLivenessProblems(run, label));
    if (run.surface !== null && run.surface !== "rider") {
      problems.push({
        rule: "WRONG_SURFACE",
        detail: `${label}: السطحُ ${run.surface} لا rider — المسارُ المحكومُ مسارُ الراكبِ`,
      });
    }
    if (run.lcpMs === null) {
      problems.push({
        rule: "NO_LCP",
        detail: `${label}: لم يُرصَدْ largest-contentful-paint — القياسُ لم يُجرَ`,
      });
    }
  });

  const pick = (f: (r: RiderSurfaceRun) => number | null): number | null => {
    const values = input.runs.map(f).filter((v): v is number => v !== null);
    return values.length > 0 && values.length === input.runs.length ? median(values) : null;
  };
  const table: Array<[RiderSurfaceMetric, number | null, number]> = [
    ["fcp", pick((r) => r.fcpMs), RIDER_SURFACE_LIMITS.fcpMs],
    ["lcp", pick((r) => r.lcpMs), RIDER_SURFACE_LIMITS.lcpMs],
    ["surface-rendered", pick((r) => r.surfaceRenderedMs), RIDER_SURFACE_LIMITS.surfaceRenderedMs],
  ];
  const metrics = table.map(([metric, medianMs, limitMs]) => ({
    metric,
    medianMs,
    limitMs,
    met: medianMs !== null && medianMs <= limitMs,
  }));
  const allMet = input.runs.length > 0 && metrics.every((m) => m.met);

  if (input.runs.length === 0) {
    problems.push({ rule: "NO_RUNS", detail: "لا تشغيلَ على الملفِّ — لا حكمَ على رقمٍ لم يُقَسْ" });
  } else if (input.mode === "blocking") {
    for (const m of metrics.filter((x) => !x.met)) {
      problems.push({
        rule: "LIMIT_NOT_MET",
        detail: `${m.metric} = ${m.medianMs === null ? "—" : Math.round(m.medianMs)} ms > ${m.limitMs} ms على ${input.profileId}`,
      });
    }
  } else if (allMet) {
    problems.push({
      rule: "READY_TO_BLOCK",
      detail: `الحدودُ الثلاثةُ مستوفاةٌ على ${input.profileId} والبوّابةُ ما زالَت تقريراً — حوِّلْ SLOW_4G_GATE_MODE إلى blocking (DEC-19)`,
    });
  }
  return { problems, metrics, allMet };
}
