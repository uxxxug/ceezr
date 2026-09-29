/**
 * الغرض: يحوّلُ هدفَ الهبوطِ (`ride_<id>` · `history` · …) إلى الحالةِ الأولى لموجِّهِ سطحِ
 *   الراكبِ (`ADR 0213`). دالّةٌ خالصةٌ تُختبَرُ وحدَها.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider
 *
 * الهبوطُ **بعدَ** شاشةِ الترحيبِ لا بدلَها: الموافقاتُ بوّابةٌ لا يتخطّاها رابطٌ (`F2-01`)؛ فمن
 * فتحَ «تابع رحلتك» يمرُّ بالترحيبِ ثمّ يجدُ رحلتَه لا الشاشةَ الرئيسةَ.
 */

import { decodeMiniAppTarget } from "../../../../../packages/shared/miniapp-link/index.ts";

export interface RiderEntryState {
  readonly followed: string | null;
  readonly summarized: string | null;
  readonly browsed: boolean;
  readonly notificationsOpen: boolean;
  readonly account: boolean;
  readonly support: { readonly orderId: string | null } | null;
  readonly sosOpen: boolean;
}

const HOME: RiderEntryState = {
  followed: null,
  summarized: null,
  browsed: false,
  notificationsOpen: false,
  account: false,
  support: null,
  sosOpen: false,
};

export function riderEntryState(raw: string | null | undefined): RiderEntryState {
  const target = decodeMiniAppTarget(raw, "rider");
  if (target === null || target.audience !== "rider") return HOME;
  if ("id" in target) {
    return target.screen === "ride"
      ? { ...HOME, followed: target.id }
      : { ...HOME, summarized: target.id };
  }
  switch (target.screen) {
    case "history":
      return { ...HOME, browsed: true };
    case "notifications":
      return { ...HOME, notificationsOpen: true };
    case "account":
      return { ...HOME, account: true };
    case "support":
      return { ...HOME, support: { orderId: null } };
    case "sos":
      return { ...HOME, sosOpen: true };
    default:
      return HOME;
  }
}
