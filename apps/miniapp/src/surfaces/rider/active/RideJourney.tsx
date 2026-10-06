/**
 * الغرض: سكّةُ الرحلةِ (`UiRail`) وشريطُ حقيقتِها (`UiTruth`) في R6/R7 — عرضٌ لِما يشتقُّه
 *   `ride-journey.ts` من قراءةِ الخادم، بلا حالةٍ ولا شبكةٍ ولا مؤقّت.
 * الحالة: منفّذ فعلياً — UI-3 / PR 4 (ADR 0237).
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/active
 * يُستخدم من: `search/SearchScreen.tsx` (السكّةُ وحدَها) · `active/ActiveRideScreen.tsx` (السكّةُ والشريط).
 */

import {
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/core.ts";
import { TRUTH_SOURCE_KEYS } from "../../../system/truth.ts";
import { UiRail, UiTruth } from "../../../system/ui/index.tsx";
import {
  journeyRail,
  RIDE_JOURNEY_LABEL_KEY,
  RIDE_JOURNEY_STATE_KEYS,
  type RideJourneyStage,
  type RideTruth,
} from "./ride-journey.ts";

export interface RideJourneyProps {
  readonly language: MiniAppLanguage;
  /** `null` = لا مرحلةَ يقولُها الخادمُ — فلا سكّةَ تُرسَم. */
  readonly stage: RideJourneyStage | null;
  /** `null` = لا شريطَ (شاشةُ البحثِ تقولُ طورَها بسطرِها). */
  readonly truth: RideTruth | null;
}

export function RideJourney({ language, stage, truth }: RideJourneyProps) {
  const t = miniAppTranslator(language);
  return (
    <>
      {/* UI-8: الطورُ من سجلِّ الرحلةِ في الخادم — يُختَمُ بمصدرِه. */}
      {truth === null ? null : (
        <UiTruth text={t(truth.key)} tone={truth.tone} seal={t(TRUTH_SOURCE_KEYS.server_record)} />
      )}
      {stage === null ? null : (
        <UiRail
          label={t(RIDE_JOURNEY_LABEL_KEY)}
          steps={journeyRail(stage).map((step) => ({
            id: step.id,
            label: t(step.labelKey),
            state: step.state,
          }))}
          stateText={{
            done: t(RIDE_JOURNEY_STATE_KEYS.done),
            current: t(RIDE_JOURNEY_STATE_KEYS.current),
            pending: t(RIDE_JOURNEY_STATE_KEYS.pending),
          }}
        />
      )}
    </>
  );
}
