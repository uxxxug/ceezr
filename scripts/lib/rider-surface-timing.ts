/**
 * الغرض: حَكَمٌ نقيٌّ على **موضعِ** عنصرِ قياسِ «زمنِ بلوغِ سطحِ الراكبِ المرسومِ» (`DEC-19` ·
 *   `ADR 0185`): عنصرٌ واحدٌ بالضبطِ، في أوّلِ شاشةِ سطحِ الراكبِ، في حالتِها الجاهزةِ لا حالةِ التحميلِ.
 * الحالة: منفّذ فعلياً — `F1-09` الصفوفُ 3–5 (`[~]`).
 * ينتمي إلى: scripts/lib
 * يُتوقع أن يستخدمه لاحقاً: scripts/check-rider-surface-timing.ts · tests/unit
 *
 * **لماذا حاجزٌ ساكنٌ فوقَ القياسِ**: القياسُ في المتصفّحِ يرى ما رُسِمَ في تشغيلٍ واحدٍ فقط؛ والحاجزُ
 * يمنعُ أن ينتقلَ العنصرُ إلى حالةِ التحميلِ أو أن يتكرّرَ في شاشةٍ أخرى فيلتقطَ القياسُ رسماً غيرَ
 * المتّفقِ عليه — وهوَ صنفُ الخطأِ الذي لا يُسقِطُ القياسَ بل يُحسِّنُ رقمَه كذباً.
 */

export const TIMING_MODULE = "apps/miniapp/src/surfaces/rider/welcome/surface-timing.ts";
export const FIRST_SCREEN = "apps/miniapp/src/surfaces/rider/welcome/WelcomeScreen.tsx";
export const RIDER_ROOT = "apps/miniapp/src/surfaces/rider/RiderRoot.tsx";
/** بدايةُ فرعِ الحالةِ الجاهزةِ في `WelcomeScreen` — ما قبلَه فروعُ التحميلِ والخطأِ. */
export const READY_ANCHOR = "const rows = consentRows(state.status);";
export const SPREAD = "{...riderSurfaceTimingAttribute}";

export type TimingRule =
  | "NO_TIMING_ELEMENT"
  | "DUPLICATE_TIMING_ELEMENT"
  | "OUTSIDE_FIRST_SCREEN"
  | "RAW_ELEMENTTIMING"
  | "NOT_IN_READY_BRANCH"
  | "NO_READY_ANCHOR"
  | "FIRST_SCREEN_MOVED";

export interface TimingProblem {
  readonly rule: TimingRule;
  readonly detail: string;
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** `sources`: مسارٌ نسبيٌّ ← نصٌّ، لكلِّ ملفِّ مصدرٍ في `apps/miniapp/src` عدا الاختباراتِ. */
export function evaluateRiderSurfaceTiming(sources: ReadonlyMap<string, string>): TimingProblem[] {
  const problems: TimingProblem[] = [];
  let total = 0;
  for (const [path, text] of sources) {
    if (path === TIMING_MODULE) continue;
    if (/\belementtiming\b/.test(text)) {
      problems.push({
        rule: "RAW_ELEMENTTIMING",
        detail: `${path}: «elementtiming» مكتوبٌ حرفاً — السمةُ من ${TIMING_MODULE} وحدَه`,
      });
    }
    const n = count(text, SPREAD);
    total += n;
    if (n > 0 && path !== FIRST_SCREEN) {
      problems.push({
        rule: "OUTSIDE_FIRST_SCREEN",
        detail: `${path}: عنصرُ القياسِ خارجَ أوّلِ شاشةِ سطحِ الراكبِ (${FIRST_SCREEN})`,
      });
    }
  }
  if (total === 0) {
    problems.push({
      rule: "NO_TIMING_ELEMENT",
      detail: `لا عنصرَ قياسٍ (${SPREAD}) — القياسُ لن يجدَ ما يقيسُه`,
    });
  } else if (total > 1) {
    problems.push({
      rule: "DUPLICATE_TIMING_ELEMENT",
      detail: `${total} عناصرِ قياسٍ والمطلوبُ واحدٌ`,
    });
  }

  const screen = sources.get(FIRST_SCREEN) ?? "";
  const anchor = screen.indexOf(READY_ANCHOR);
  const at = screen.indexOf(SPREAD);
  if (anchor < 0) {
    problems.push({
      rule: "NO_READY_ANCHOR",
      detail: `${FIRST_SCREEN}: لا «${READY_ANCHOR}» — تعذّرَ إثباتُ الفرعِ الجاهزِ`,
    });
  } else if (at >= 0 && at < anchor) {
    problems.push({
      rule: "NOT_IN_READY_BRANCH",
      detail: `${FIRST_SCREEN}: عنصرُ القياسِ قبلَ الفرعِ الجاهزِ — قد يلتقطُ رسمَ التحميلِ لا السطحَ`,
    });
  }

  const root = sources.get(RIDER_ROOT) ?? "";
  if (
    !root.includes("const [proceeded, setProceeded] = useState(false);") ||
    !root.includes("if (!proceeded) {") ||
    !root.includes("return <WelcomeScreen {...welcomeProps} />;")
  ) {
    problems.push({
      rule: "FIRST_SCREEN_MOVED",
      detail: `${RIDER_ROOT}: لم تَعُد شاشةُ الترحيبِ أوّلَ شاشةٍ لسطحِ الراكبِ — انقلْ عنصرَ القياسِ وحدِّث الحاجزَ`,
    });
  }
  return problems;
}
