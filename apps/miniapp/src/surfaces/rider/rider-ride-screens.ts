/**
 * الغرض: مدخلُ حزمةِ `rider-ride` (القسم 9.4 · `F1-09` · `D-30`) — شاشاتُ الرحلةِ عندَ الطلبِ: البحثُ عن سائقٍ،
 *   والرحلةُ النشطةُ بقناتِها الحيّةِ (`socket.io`)، والملخّصُ والتقييمُ. يُستورَدُ **ديناميكيّاً** من `RiderRoot`
 *   وحدَه؛ واستيرادُه ثابتاً يُعيدُ القناةَ إلى حِملِ السطحِ الأوّلِ ويُسقِطُه حاجزُ `assert-rider-first-surface`.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: surfaces/rider
 */

import { createElement } from "react";
import {
  productionChannelBaseUrl,
  productionRideChannelTransport,
  productionSessionReader,
} from "../../services/production-ride-channel.ts";
import { ActiveRideScreen } from "./active/ActiveRideScreen.tsx";

export { SearchScreen } from "./search/SearchScreen.tsx";
export { RideSummaryScreen } from "./summary/RideSummaryScreen.tsx";

type ActiveRideProps = Parameters<typeof ActiveRideScreen>[0];

/** الرحلةُ النشطةُ مربوطةً بقناةِ الإنتاجِ — الربطُ هنا كي تبقى القناةُ داخلَ `rider-ride`. */
export function ActiveRideScreenWithChannel(
  props: Omit<ActiveRideProps, "channelTransport" | "sessionReader" | "channelBaseUrl">,
) {
  return createElement(ActiveRideScreen, {
    ...props,
    channelTransport: productionRideChannelTransport,
    sessionReader: productionSessionReader,
    channelBaseUrl: productionChannelBaseUrl(),
  } as ActiveRideProps);
}
