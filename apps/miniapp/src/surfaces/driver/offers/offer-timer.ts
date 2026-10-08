/**
 * الغرض: خصائصُ `UiTimer` لمهلةِ العرضِ (D2–D3 · UI-4 · §11 PR 6 «مؤقّتُ CSS + بطاقةُ عرض»).
 * الحالة: منفّذ فعلياً — UI-4 (ADR 0236).
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/offers
 *
 * **لا ساعةَ ههنا ولا لحظةُ انتهاء** (`ADR 0117`): الدالّةُ تتلقّى الباقيَ محسوباً من
 * `seconds_left` الذي قالَه الخادمُ ومن فارقِ قراءتَين بساعةٍ واحدة، ولا تُركِّبُ موعداً
 * مطلقاً يُقارَنُ بساعةِ الجهاز. والشريطُ يُفرَغُ بحركةِ CSS لا بعقربٍ (`§9`: لا `setInterval`)،
 * والنصُّ يقولُ **ما بقيَ لحظةَ العرضِ** صراحةً فلا يُقرأُ عدّاً حيّاً يتجمّد.
 *
 * المقامُ (`totalSeconds`) هوَ الباقي لحظةَ قراءةِ العرضِ لا مهلةُ الجولةِ كلِّها: المهلةُ
 * سياسةٌ في القاعدةِ لا تُنشَرُ في هذا العقد، فلا تُخترَعُ ههنا.
 */

import type { UiTimerProps } from "../../../system/ui/index.tsx";
import { type CountdownTone, countdownLabel, countdownTone } from "./offers-view.ts";

const TIMER_TONE: Readonly<Record<CountdownTone, UiTimerProps["tone"]>> = {
  calm: "neutral",
  urgent: "amber",
  elapsed: "bad",
};

export function offerTimerProps(input: {
  /** الباقي لحظةَ الرسمِ (`countdownSeconds`). */
  readonly secondsRemaining: number;
  /** `seconds_left` كما قالَه الخادمُ لحظةَ القراءة. */
  readonly secondsLeftAtRead: number;
  readonly t: (key: string) => string;
}): UiTimerProps {
  const remaining = Number.isFinite(input.secondsRemaining)
    ? Math.max(0, input.secondsRemaining)
    : 0;
  const atRead = Number.isFinite(input.secondsLeftAtRead)
    ? Math.max(0, input.secondsLeftAtRead)
    : 0;
  const tone = TIMER_TONE[countdownTone(remaining)];
  return {
    label: input.t("driver.offers.timer.label"),
    deadlineText:
      remaining > 0
        ? input.t("driver.offers.timer.leftAtRender").replace("{value}", countdownLabel(remaining))
        : input.t("driver.offers.timer.elapsed"),
    remainingSeconds: remaining,
    totalSeconds: Math.max(atRead, remaining),
    tone,
  };
}
