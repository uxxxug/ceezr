/**
 * الغرض: سكّةُ الرحلةِ وشريطُ حقيقتِها (UI-3 / PR 4 · §11 «سكّة + شريط حقيقة + SOS») — دالّاتٌ نقيّةٌ
 *   تشتقُّ مرحلةَ الرحلةِ من **الحالةِ المقروءةِ من الخادمِ وحدَها**، بلا JSX وبلا شبكةٍ وبلا ساعة.
 * الحالة: منفّذ فعلياً — UI-3 / PR 4 (ADR 0237).
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/active
 * يُستخدم من: `RideJourney.tsx` (R6 البحثُ عن سائق · R7 الرحلةُ النشطة).
 *
 * ## ما لا يفعلُه عن قصد
 *
 *   ــ **لا يخترعُ مرحلةً:** طورٌ أو حالةٌ خارجَ الجدولِ (`closed` · `cancelled` · `failed` · مجهول) لا
 *      سكّةَ لها — `null` — لأنَّ وضعَها على مرحلةٍ ما ادّعاءٌ لم يقُلْه الخادم.
 *   ــ **لا يتقدّمُ بالوقت:** لا مؤقّتَ ولا تخمينَ لِما بعدَ القراءة؛ السكّةُ تتغيّرُ بقراءةٍ جديدةٍ فقط.
 *   ــ **لا يصوغُ نصّاً:** المفاتيحُ وحدَها، والنصُّ في القاموس.
 */

import type { UiRailState, UiTone } from "../../../system/ui/index.tsx";
import { activePhaseKey } from "./active-ride-view.ts";

/** مراحلُ الرحلةِ بترتيبِها — أطوارُ `phase` في عقدِ الرحلةِ النشطةِ حرفاً. */
export const RIDE_JOURNEY_STAGES = [
  "searching",
  "driver_assigned",
  "driver_arrived",
  "on_trip",
  "completed",
] as const;

export type RideJourneyStage = (typeof RIDE_JOURNEY_STAGES)[number];

export const RIDE_JOURNEY_LABEL_KEYS: Readonly<Record<RideJourneyStage, string>> = {
  searching: "rider.active.journey.searching",
  driver_assigned: "rider.active.journey.driverAssigned",
  driver_arrived: "rider.active.journey.driverArrived",
  on_trip: "rider.active.journey.onTrip",
  completed: "rider.active.journey.completed",
};

export const RIDE_JOURNEY_STATE_KEYS: Readonly<Record<UiRailState, string>> = {
  done: "rider.active.journey.state.done",
  current: "rider.active.journey.state.current",
  pending: "rider.active.journey.state.pending",
};

export const RIDE_JOURNEY_LABEL_KEY = "rider.active.journey.label";

function isStage(value: string): value is RideJourneyStage {
  return (RIDE_JOURNEY_STAGES as readonly string[]).includes(value);
}

/** R7: طورُ الرحلةِ النشطةِ (`phase`) ⇒ مرحلةُ السكّة، أو `null` لِما لا مرحلةَ له. */
export function journeyFromActivePhase(phase: string): RideJourneyStage | null {
  return isStage(phase) ? phase : null;
}

const SEARCH_STATUS_STAGE: Readonly<Record<string, RideJourneyStage>> = {
  searching: "searching",
  matched: "driver_assigned",
  in_progress: "on_trip",
  completed: "completed",
};

/** R6: حالةُ الطلبِ في شاشةِ البحث (`status`) ⇒ مرحلةُ السكّة، أو `null` (ملغاةٌ · متعذّرةٌ · مجهولة). */
export function journeyFromSearchStatus(status: string): RideJourneyStage | null {
  return SEARCH_STATUS_STAGE[status] ?? null;
}

export interface RideJourneyStep {
  readonly id: RideJourneyStage;
  readonly labelKey: string;
  readonly state: UiRailState;
}

/** خطواتُ السكّة: ما قبلَ المرحلةِ تمَّ، وهيَ الآن، وما بعدَها لاحق — والانتهاءُ كلُّه «تمّ». */
export function journeyRail(stage: RideJourneyStage): readonly RideJourneyStep[] {
  const at = RIDE_JOURNEY_STAGES.indexOf(stage);
  const finished = stage === "completed";
  return RIDE_JOURNEY_STAGES.map((id, index) => ({
    id,
    labelKey: RIDE_JOURNEY_LABEL_KEYS[id],
    state: finished || index < at ? "done" : index === at ? "current" : "pending",
  }));
}

const PHASE_TONE: Readonly<Record<RideJourneyStage, UiTone>> = {
  searching: "amber",
  driver_assigned: "brand",
  driver_arrived: "brand",
  on_trip: "brand",
  completed: "ok",
};

export interface RideTruth {
  readonly key: string;
  readonly tone: UiTone | "unknown";
}

/**
 * R7: جملةُ الحقيقةِ الحاليّةُ — طورُ الرحلةِ كما قرأَه الخادم (`activePhaseKey` نفسُه، لا جدولٌ ثانٍ).
 * وما لا مرحلةَ له يُقالُ بنغمةِ `unknown` (الصمتُ المُصمَّم §10.9) لا بلونِ نجاحٍ أو خطر.
 */
export function activeRideTruth(phase: string): RideTruth {
  const stage = journeyFromActivePhase(phase);
  return { key: activePhaseKey(phase), tone: stage === null ? "unknown" : PHASE_TONE[stage] };
}
