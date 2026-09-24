/**
 * الغرض: معرّفُ عنصرِ قياسِ «زمنِ بلوغِ سطحِ الراكبِ المرسومِ» (`DEC-19` · قرارُ المالكِ 2026-09-24 ·
 *   `ADR 0185`) — مصدرٌ واحدٌ يقرؤُه السطحُ و`scripts/measure-tti.ts` وحاجزُ
 *   `scripts/check-rider-surface-timing.ts`.
 * الحالة: منفّذ فعلياً — `F1-09` الصفوفُ 3–5 (`[~]`).
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/welcome
 *
 * العنصرُ نصٌّ مرئيٌّ في **الحالةِ الجاهزةِ** لشاشةِ الترحيبِ — أوّلِ شاشةِ سطحِ الراكبِ — لا في حالةِ
 * التحميلِ، فيسجّلُ المتصفّحُ `renderTime` لحظةَ عرضِ السطحِ بمحتواه لا لحظةَ الهيكلِ المؤقّتِ.
 */

export const RIDER_SURFACE_TIMING_ID = "waslah-rider-surface";

/**
 * السمةُ كما تُنشَرُ على العنصرِ. `elementtiming` سمةُ HTML لا تعرفُها أنواعُ React، فتُمرَّرُ نشراً؛
 * وReact 19 يُمرِّرُ السماتِ ذواتِ الأحرفِ الصغيرةِ إلى DOM كما هيَ.
 */
export const riderSurfaceTimingAttribute = { elementtiming: RIDER_SURFACE_TIMING_ID } as const;
