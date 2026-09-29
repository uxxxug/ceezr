/**
 * الغرض: يحوّلُ هدفَ الهبوطِ (`offer_<id>` · `job` · …) إلى أوّلِ شاشةٍ في سطحِ السائقِ
 *   (`ADR 0213`). دالّةٌ خالصةٌ تُختبَرُ وحدَها.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver
 */

import { decodeMiniAppTarget } from "../../../../../packages/shared/miniapp-link/index.ts";

export type DriverEntryView =
  | { readonly kind: "offers" }
  | { readonly kind: "offer"; readonly offerId: string }
  | { readonly kind: "job" }
  | { readonly kind: "activity" }
  | { readonly kind: "subscription" }
  | { readonly kind: "vehicle" }
  | { readonly kind: "documents" }
  | { readonly kind: "support" }
  | { readonly kind: "account" }
  | { readonly kind: "summary"; readonly orderId: string };

/** هدفٌ مجهولٌ أو لجمهورٍ آخرَ ⇒ لوحُ العروضِ، الشاشةُ الأولى كما كانت. */
export function driverEntryView(raw: string | null | undefined): DriverEntryView {
  const target = decodeMiniAppTarget(raw, "driver");
  if (target === null || target.audience !== "driver") return { kind: "offers" };
  if ("id" in target) {
    return target.screen === "offer"
      ? { kind: "offer", offerId: target.id }
      : { kind: "summary", orderId: target.id };
  }
  return { kind: target.screen };
}
